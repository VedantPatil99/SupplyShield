const router = require('express').Router();
const { Recall, Batch } = require('../models');
const { ID, RECALL_CLASSES, RECALL_STATUS } = require('../models/constants');
const { requireRole, isOversight } = require('../middleware/rbac');
const { ah, badRequest, notFound, forbidden } = require('../utils/errors');
const recallSvc = require('../services/recall');
const v = require('../utils/validate');

const INITIATORS = ['manufacturer', 'regulator', 'admin']; // distributor/wholesaler/pharmacy -> 403

function parseBatchIds(raw) {
  const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!ids.length) throw badRequest('batch_ids must be a non-empty array');
  if (ids.length > 50) throw badRequest('At most 50 batches per recall');
  for (const id of ids) if (typeof id !== 'string' || !ID.batch.test(id)) throw badRequest(`Invalid batch id: ${id}`);
  return [...new Set(ids)];
}

async function scopeFilter(user) {
  if (isOversight(user)) return {};
  if (user.role === 'manufacturer') {
    const own = (await Batch.find({ manufacturer_id: user.entity_id }, { _id: 1 }).lean()).map((b) => b._id);
    return { $or: [{ initiated_by: user.entity_id }, { batch_ids: { $in: own } }, { 'affected_entities.entity_id': user.entity_id }] };
  }
  return { 'affected_entities.entity_id': user.entity_id };
}

// Preview the affected entities (graph traversal) before committing a recall. Read-only.
router.post('/preview', requireRole(...INITIATORS), ah(async (req, res) => {
  const batchIds = parseBatchIds(req.body.batch_ids);
  await recallSvc.loadBatchesForRecall(batchIds, req.user);
  res.json({ batch_ids: batchIds, ...(await recallSvc.previewImpact(batchIds)) });
}));

// FR-6 initiate a recall.
router.post('/', requireRole(...INITIATORS), ah(async (req, res) => {
  const batchIds = parseBatchIds(req.body.batch_ids);
  const reason = v.str(req.body.reason, 'reason', { max: 500 });
  const recallClass = v.oneOf(req.body.recall_class, 'recall_class', RECALL_CLASSES);
  const recall = await recallSvc.initiateRecall({ batchIds, reason, recallClass }, req.user);
  res.locals.resourceId = recall._id;
  res.locals.auditDetails = { affected_count: recall.affected_entities.length };
  res.status(201).json(await recallSvc.withNames(recall));
}));

// FR-7 list with progress.
router.get('/', ah(async (req, res) => {
  const filter = await scopeFilter(req.user);
  const status = v.oneOf(req.query.status, 'status', RECALL_STATUS, { required: false });
  if (status) filter.status = status;
  const items = await Recall.find(filter).sort({ initiated_at: -1 }).lean();
  res.json({
    items: items.map((r) => {
      const mine = r.affected_entities.find((a) => a.entity_id === req.user.entity_id);
      return {
        _id: r._id, batch_ids: r.batch_ids, initiated_by: r.initiated_by, reason: r.reason, recall_class: r.recall_class,
        status: r.status, initiated_at: r.initiated_at, updated_at: r.updated_at,
        progress: recallSvc.progress(r), my_status: mine ? mine.status : null,
      };
    }),
    total: items.length,
  });
}));

router.get('/:id', ah(async (req, res) => {
  const filter = { ...(await scopeFilter(req.user)), _id: req.params.id };
  const r = await Recall.findOne(filter).lean();
  if (!r) {
    if (await Recall.exists({ _id: req.params.id })) throw forbidden('This recall is outside your scope');
    throw notFound('Recall not found');
  }
  const out = await recallSvc.withNames(r);
  // Non-oversight entities see only their own row of the affected list (other holders are not their business).
  if (!isOversight(req.user) && req.user.role !== 'manufacturer') {
    out.affected_entities = out.affected_entities.filter((a) => a.entity_id === req.user.entity_id);
  }
  res.json(out);
}));

// Affected entity acknowledges / quarantines / returns (or admin on their behalf).
router.patch('/:id/entities/:entityId', ah(async (req, res) => {
  const status = v.str(req.body.status, 'status');
  const updated = await recallSvc.updateEntityStatus(req.params.id, req.params.entityId, status, req.user);
  res.locals.resourceId = req.params.id;
  res.locals.auditDetails = { entity_id: req.params.entityId, new_status: status, recall_status: updated.status };
  res.json(await recallSvc.withNames(updated));
}));

module.exports = router;
