const router = require('express').Router();
const mongoose = require('mongoose');
const config = require('../config/env');
const { Shipment, Batch, Inventory, Entity, Transaction } = require('../models');
const { ID, TIER, SHIPMENT_STATUS } = require('../models/constants');
const { requireRole, isOversight } = require('../middleware/rbac');
const { ah, badRequest, notFound, forbidden, conflict } = require('../utils/errors');
const { uniqueId, signature, hex6 } = require('../utils/ids');
const v = require('../utils/validate');

// FR-2 record a shipment. The sender is the JWT entity (admin may name one). Stock leaves the sender at dispatch.
router.post('/', requireRole('manufacturer', 'distributor', 'wholesaler', 'admin'), ah(async (req, res) => {
  const b = req.body || {};
  const fromId = req.user.role === 'admin' ? v.str(b.from_entity_id, 'from_entity_id', { pattern: ID.entity }) : req.user.entity_id;
  const batchId = v.str(b.batch_id, 'batch_id', { pattern: ID.batch });
  const toId = v.str(b.to_entity_id, 'to_entity_id', { pattern: ID.entity });
  const qty = v.posInt(b.quantity, 'quantity');
  const mode = v.oneOf(b.transport_mode || 'road', 'transport_mode', ['road', 'air', 'rail', 'sea']);
  if (fromId === toId) throw badRequest('Sender and receiver must differ');

  const [from, to, batch] = await Promise.all([Entity.findById(fromId).lean(), Entity.findById(toId).lean(), Batch.findById(batchId).lean()]);
  if (!from) throw badRequest(`Unknown sender ${fromId}`);
  if (!to) throw badRequest(`Unknown receiver ${toId}`);
  if (!batch) throw notFound(`Batch ${batchId} not found`);
  if (TIER[to.entity_type] <= TIER[from.entity_type]) {
    throw badRequest(`A ${from.entity_type} can only ship downstream (not to a ${to.entity_type})`);
  }
  if (batch.status !== 'active') throw conflict(`Batch is ${batch.status}; it cannot be shipped`);
  if (new Date(batch.expiry_date) < config.today()) throw conflict('Batch is past its expiry date; it cannot be shipped');

  const invId = Inventory.idFor(fromId, batchId);
  const now = new Date();
  const shipId = await uniqueId(Shipment, (h) => `SHIP-${h}`);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Conditional decrement: fails if the sender lacks stock (also guards against concurrent shipments).
      const dec = await Inventory.updateOne(
        { _id: invId, quantity_on_hand: { $gte: qty }, recall_status: 'none' },
        { $inc: { quantity_on_hand: -qty }, $set: { last_updated: now } },
        { session },
      );
      if (dec.modifiedCount !== 1) {
        const inv = await Inventory.findById(invId).session(session).lean();
        if (!inv) throw badRequest(`${fromId} holds no stock of ${batchId}`);
        if (inv.recall_status !== 'none') throw conflict(`Stock is ${inv.recall_status} under a recall`);
        throw badRequest(`Insufficient stock: ${fromId} has ${inv.quantity_on_hand} of ${batchId}, requested ${qty}`);
      }
      await Shipment.create([{
        _id: shipId,
        batch_id: batchId,
        quantity: qty,
        from_entity: { entity_id: fromId, entity_type: from.entity_type, city: from.city },
        to_entity: { entity_id: toId, entity_type: to.entity_type, city: to.city },
        dispatch_timestamp: now,
        actual_arrival: null,
        transport_mode: mode,
        tracking_number: `TRK-${hex6()}`,
        status: 'dispatched',
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  res.locals.resourceId = shipId;
  res.status(201).json(await Shipment.findById(shipId).lean());
}));

// FR-2/FR-3 confirm receipt: delivered, receiver inventory upserted, ownership_transfer transaction written.
router.patch('/:id/receive', requireRole('distributor', 'wholesaler', 'pharmacy', 'admin'), ah(async (req, res) => {
  const ship = await Shipment.findById(req.params.id).lean();
  if (!ship) throw notFound('Shipment not found');
  if (req.user.role !== 'admin' && ship.to_entity.entity_id !== req.user.entity_id) throw forbidden('Only the receiver can confirm this shipment');
  if (ship.status === 'delivered') throw conflict('Shipment already delivered');

  const now = new Date();
  const to = await Entity.findById(ship.to_entity.entity_id).lean();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const upd = await Shipment.updateOne(
        { _id: ship._id, status: { $ne: 'delivered' } },
        { $set: { status: 'delivered', actual_arrival: now } },
        { session },
      );
      if (upd.modifiedCount !== 1) throw conflict('Shipment already delivered');
      await Inventory.updateOne(
        { _id: Inventory.idFor(ship.to_entity.entity_id, ship.batch_id) },
        {
          $inc: { quantity_on_hand: ship.quantity },
          $set: { last_updated: now },
          $setOnInsert: {
            entity_id: ship.to_entity.entity_id, entity_type: ship.to_entity.entity_type, batch_id: ship.batch_id,
            location: { city: to ? to.city : ship.to_entity.city, country: to ? to.country : 'IN' }, recall_status: 'none',
          },
        },
        { upsert: true, session },
      );
      await Transaction.create([{
        _id: await uniqueId(Transaction, (h) => `TXN-${h}`),
        type: 'ownership_transfer', batch_id: ship.batch_id, shipment_id: ship._id,
        from_entity_id: ship.from_entity.entity_id, to_entity_id: ship.to_entity.entity_id, quantity: ship.quantity,
        timestamp: now, verified_by: req.user.username,
        signature_hash: signature(ship._id, ship.batch_id, ship.from_entity.entity_id, ship.to_entity.entity_id, ship.quantity, now.toISOString()),
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  res.locals.resourceId = ship._id;
  res.json(await Shipment.findById(ship._id).lean());
}));

router.get('/', ah(async (req, res) => {
  const { limit, skip } = v.pageParams(req.query);
  const filter = {};
  const dir = v.oneOf(req.query.direction, 'direction', ['inbound', 'outbound', 'all'], { required: false }) || 'all';
  if (isOversight(req.user)) {
    if (req.query.entity_id) {
      const e = String(req.query.entity_id);
      if (dir === 'inbound') filter['to_entity.entity_id'] = e;
      else if (dir === 'outbound') filter['from_entity.entity_id'] = e;
      else filter.$or = [{ 'from_entity.entity_id': e }, { 'to_entity.entity_id': e }];
    }
  } else {
    const e = req.user.entity_id;
    if (dir === 'inbound') filter['to_entity.entity_id'] = e;
    else if (dir === 'outbound') filter['from_entity.entity_id'] = e;
    else filter.$or = [{ 'from_entity.entity_id': e }, { 'to_entity.entity_id': e }];
  }
  if (req.query.batch_id) filter.batch_id = String(req.query.batch_id);
  const status = v.oneOf(req.query.status, 'status', SHIPMENT_STATUS, { required: false });
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    Shipment.find(filter).sort({ dispatch_timestamp: -1 }).skip(skip).limit(limit).lean(),
    Shipment.countDocuments(filter),
  ]);
  const ids = [...new Set(items.flatMap((s) => [s.from_entity.entity_id, s.to_entity.entity_id]))];
  const names = Object.fromEntries((await Entity.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((e) => [e._id, e.name]));
  const batches = Object.fromEntries((await Batch.find({ _id: { $in: [...new Set(items.map((s) => s.batch_id))] } }, { product_name: 1 }).lean()).map((x) => [x._id, x.product_name]));
  res.json({
    items: items.map((s) => ({
      ...s,
      product_name: batches[s.batch_id] || null,
      from_entity: { ...s.from_entity, name: names[s.from_entity.entity_id] || null },
      to_entity: { ...s.to_entity, name: names[s.to_entity.entity_id] || null },
    })),
    total, limit, skip,
  });
}));

router.get('/:id', ah(async (req, res) => {
  const s = await Shipment.findById(req.params.id).lean();
  if (!s) throw notFound('Shipment not found');
  const mine = [s.from_entity.entity_id, s.to_entity.entity_id].includes(req.user.entity_id);
  if (!isOversight(req.user) && !mine) {
    const b = await Batch.findById(s.batch_id, { manufacturer_id: 1 }).lean();
    if (!b || b.manufacturer_id !== req.user.entity_id) throw forbidden('This shipment is outside your scope');
  }
  res.json(s);
}));

module.exports = router;
