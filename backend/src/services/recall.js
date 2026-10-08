// FR-6 / FR-7 recall workflow. Writes go to MongoDB only; the sync service projects them into Neo4j.
const mongoose = require('mongoose');
const { Batch, Recall, Inventory, Transaction, Entity } = require('../models');
const { AFFECTED_STATUS, LABEL_BY_TYPE } = require('../models/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { uniqueId, signature } = require('../utils/ids');
const trace = require('./traceability');

/** Affected entities for a set of batches, from graph traversal (the Recall node does not exist yet). */
async function previewImpact(batchIds) {
  const t0 = Date.now();
  const rows = await trace.recipientsOfBatches(batchIds);
  const inv = await Inventory.find({ batch_id: { $in: batchIds }, entity_id: { $in: rows.map((r) => r.entity_id) } }).lean();
  const onHand = {};
  for (const i of inv) onHand[i.entity_id] = (onHand[i.entity_id] || 0) + i.quantity_on_hand;
  return {
    graph_ms: Date.now() - t0,
    affected: rows.map((r) => ({
      entity_id: r.entity_id, name: r.name, entity_type: r.entity_type, batches: r.batches, shipments: r.shipments,
      quantity_on_hand: onHand[r.entity_id] || 0,
    })),
  };
}

async function loadBatchesForRecall(batchIds, user) {
  const batches = await Batch.find({ _id: { $in: batchIds } }).lean();
  const missing = batchIds.filter((id) => !batches.some((b) => b._id === id));
  if (missing.length) throw notFound(`Unknown batch(es): ${missing.join(', ')}`);
  if (user.role === 'manufacturer') {
    const foreign = batches.filter((b) => b.manufacturer_id !== user.entity_id);
    if (foreign.length) throw forbidden(`Manufacturers can only recall their own batches (${foreign.map((b) => b._id).join(', ')})`);
  }
  return batches;
}

async function initiateRecall({ batchIds, reason, recallClass }, user) {
  await loadBatchesForRecall(batchIds, user);
  const open = await Recall.findOne({ batch_ids: { $in: batchIds }, status: 'in_progress' }).lean();
  if (open) throw conflict(`Batch already has an open recall: ${open._id}`);

  const { affected } = await previewImpact(batchIds);
  const now = new Date();
  const initiator = user.entity_id || user.username;
  const recallId = await uniqueId(Recall, (h) => `RECALL-${now.getUTCFullYear()}-${h}`);
  const recall = {
    _id: recallId,
    batch_ids: batchIds,
    initiated_by: initiator,
    reason,
    recall_class: recallClass,
    affected_entities: affected.map((a) => ({ entity_id: a.entity_id, entity_type: a.entity_type, status: 'notified', updated_at: now })),
    status: affected.length ? 'in_progress' : 'completed',
    initiated_at: now,
    updated_at: now,
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Recall.create([recall], { session });
      await Batch.updateMany({ _id: { $in: batchIds } }, { $set: { status: 'recalled' } }, { session });
      // Initiation only flags; inventory becomes quarantined/returned when the holder acts.
      const txns = [];
      for (const bid of batchIds) {
        txns.push({
          _id: await uniqueId(Transaction, (h) => `TXN-${h}`),
          type: 'recall_action', batch_id: bid, recall_id: recallId, from_entity_id: initiator, to_entity_id: null,
          quantity: 0, timestamp: now, verified_by: user.username, signature_hash: signature(recallId, bid, 'initiated', now.toISOString()),
          details: { action: 'initiated', recall_class: recallClass, affected_count: affected.length },
        });
      }
      await Transaction.insertMany(txns, { session });
    });
  } finally {
    await session.endSession();
  }
  return Recall.findById(recallId).lean();
}

const ORDER = Object.fromEntries(AFFECTED_STATUS.map((s, i) => [s, i]));

/** An affected entity moves forward: notified -> acknowledged -> quarantined -> returned. */
async function updateEntityStatus(recallId, entityId, newStatus, user) {
  if (!['acknowledged', 'quarantined', 'returned'].includes(newStatus)) {
    throw badRequest('status must be one of: acknowledged, quarantined, returned');
  }
  if (user.role !== 'admin' && user.entity_id !== entityId) throw forbidden('You can only update your own recall status');
  const recall = await Recall.findById(recallId).lean();
  if (!recall) throw notFound('Recall not found');
  if (recall.status !== 'in_progress') throw conflict(`Recall is ${recall.status}`);
  const entry = recall.affected_entities.find((a) => a.entity_id === entityId);
  if (!entry) throw notFound(`${entityId} is not affected by ${recallId}`);
  if (ORDER[newStatus] <= ORDER[entry.status]) {
    throw conflict(`Status can only move forward (currently "${entry.status}")`);
  }

  const now = new Date();
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      updated = await Recall.findOneAndUpdate(
        { _id: recallId, 'affected_entities.entity_id': entityId },
        { $set: { 'affected_entities.$.status': newStatus, 'affected_entities.$.updated_at': now, updated_at: now } },
        { new: true, session, lean: true },
      );
      if (newStatus === 'quarantined' || newStatus === 'returned') {
        await Inventory.updateMany(
          { entity_id: entityId, batch_id: { $in: recall.batch_ids } },
          { $set: { recall_status: newStatus, last_updated: now } },
          { session },
        );
      }
      const txns = [];
      for (const bid of recall.batch_ids) {
        txns.push({
          _id: await uniqueId(Transaction, (h) => `TXN-${h}`),
          type: 'recall_action', batch_id: bid, recall_id: recallId, from_entity_id: entityId, to_entity_id: recall.initiated_by,
          quantity: 0, timestamp: now, verified_by: user.username, signature_hash: signature(recallId, bid, entityId, newStatus, now.toISOString()),
          details: { action: newStatus },
        });
      }
      await Transaction.insertMany(txns, { session });
      if (updated.affected_entities.every((a) => a.status === 'returned')) {
        updated = await Recall.findByIdAndUpdate(recallId, { $set: { status: 'completed', updated_at: now } }, { new: true, session, lean: true });
      }
    });
  } finally {
    await session.endSession();
  }
  return updated;
}

/** FR-7 progress figures for one recall. */
function progress(recall) {
  const total = recall.affected_entities.length;
  const by = Object.fromEntries(AFFECTED_STATUS.map((s) => [s, 0]));
  for (const a of recall.affected_entities) by[a.status] = (by[a.status] || 0) + 1;
  return {
    total,
    by_status: by,
    returned_pct: total ? Math.round((by.returned / total) * 100) : 100,
    actioned_pct: total ? Math.round(((total - by.notified) / total) * 100) : 100,
  };
}

async function withNames(recall) {
  const ids = [...new Set([recall.initiated_by, ...recall.affected_entities.map((a) => a.entity_id)])];
  const ents = await Entity.find({ _id: { $in: ids } }).lean();
  const name = Object.fromEntries(ents.map((e) => [e._id, e.name]));
  return {
    ...recall,
    initiated_by_name: name[recall.initiated_by] || null,
    affected_entities: recall.affected_entities.map((a) => ({ ...a, name: name[a.entity_id] || null })),
    progress: progress(recall),
  };
}

module.exports = { previewImpact, initiateRecall, updateEntityStatus, progress, withNames, loadBatchesForRecall, LABEL_BY_TYPE };
