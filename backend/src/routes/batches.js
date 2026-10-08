const router = require('express').Router();
const mongoose = require('mongoose');
const { Batch, Inventory, Entity, Recall, Anomaly, Transaction } = require('../models');
const { BATCH_STATUS, ID } = require('../models/constants');
const { requireRole, isOversight } = require('../middleware/rbac');
const { ah, badRequest, notFound, forbidden } = require('../utils/errors');
const { uniqueId, signature } = require('../utils/ids');
const { visibleBatchIds, canSeeBatch, decorateBatch } = require('../services/scope');
const v = require('../utils/validate');

// FR-1 register a batch. Manufacturer id comes from the JWT; admin must name the manufacturer.
router.post('/', requireRole('manufacturer', 'admin'), ah(async (req, res) => {
  const b = req.body || {};
  let manufacturerId = req.user.entity_id;
  if (req.user.role === 'admin') manufacturerId = v.str(b.manufacturer_id, 'manufacturer_id', { pattern: ID.entity });
  const mfg = await Entity.findById(manufacturerId).lean();
  if (!mfg || mfg.entity_type !== 'manufacturer') throw badRequest(`${manufacturerId} is not a manufacturer`);

  const manufactureDate = v.date(b.manufacture_date, 'manufacture_date');
  const expiryDate = v.date(b.expiry_date, 'expiry_date');
  if (expiryDate <= manufactureDate) throw badRequest('expiry_date must be after manufacture_date');
  const qty = v.posInt(b.quantity_produced, 'quantity_produced');
  const sc = b.storage_conditions || {};
  const range = Array.isArray(sc.temperature_range_c) ? sc.temperature_range_c.map(Number) : [15, 25];
  if (range.length !== 2 || range.some(Number.isNaN) || range[0] > range[1]) throw badRequest('storage_conditions.temperature_range_c must be [min, max]');

  const now = new Date();
  const id = await uniqueId(Batch, (h) => `BATCH-${manufactureDate.getUTCFullYear()}-${h}`);
  const doc = {
    _id: id,
    product_name: v.str(b.product_name, 'product_name', { max: 120 }),
    product_code: v.str(b.product_code, 'product_code', { max: 40, pattern: /^[A-Z0-9-]+$/i }).toUpperCase(),
    manufacturer_id: manufacturerId,
    manufacture_date: manufactureDate,
    expiry_date: expiryDate,
    quantity_produced: qty,
    unit: v.str(b.unit, 'unit', { required: false, max: 20 }) || 'units',
    storage_conditions: { temperature_range_c: range, requires_cold_chain: !!sc.requires_cold_chain },
    regulatory: {
      approval_number: v.str(b.regulatory && b.regulatory.approval_number, 'regulatory.approval_number', { required: false, max: 60 }) || null,
      country_of_origin: (b.regulatory && b.regulatory.country_of_origin) || mfg.country || 'IN',
    },
    quality_control: {
      qc_passed: b.quality_control ? b.quality_control.qc_passed !== false : true,
      qc_certificate_id: (b.quality_control && b.quality_control.qc_certificate_id) || null,
    },
    status: 'active',
  };

  // Batch + the manufacturer's opening stock + a quality_check transaction, atomically.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Batch.create([doc], { session });
      await Inventory.create([{
        _id: Inventory.idFor(manufacturerId, id), entity_id: manufacturerId, entity_type: 'manufacturer', batch_id: id,
        quantity_on_hand: qty, location: { city: mfg.city, country: mfg.country }, recall_status: 'none', last_updated: now,
      }], { session });
      await Transaction.create([{
        _id: await uniqueId(Transaction, (h) => `TXN-${h}`), type: 'quality_check', batch_id: id, shipment_id: null,
        from_entity_id: manufacturerId, to_entity_id: manufacturerId, quantity: qty, timestamp: now, verified_by: req.user.username,
        signature_hash: signature(id, manufacturerId, qty, now.toISOString()), details: { action: 'batch_registered', qc_passed: doc.quality_control.qc_passed },
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  res.locals.resourceId = id;
  res.status(201).json(decorateBatch(await Batch.findById(id).lean()));
}));

router.get('/', ah(async (req, res) => {
  const { limit, skip } = v.pageParams(req.query);
  const filter = {};
  const ids = await visibleBatchIds(req.user);
  if (ids) filter._id = { $in: ids };
  const status = v.oneOf(req.query.status, 'status', BATCH_STATUS, { required: false });
  if (status) filter.status = status;
  if (req.query.manufacturer_id && isOversight(req.user)) filter.manufacturer_id = String(req.query.manufacturer_id);
  if (req.query.q) {
    const q = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 50);
    const rx = new RegExp(q, 'i');
    filter.$or = [{ _id: rx }, { product_name: rx }, { product_code: rx }];
  }
  const [items, total] = await Promise.all([
    Batch.find(filter).sort({ manufacture_date: -1, _id: 1 }).skip(skip).limit(limit).lean(),
    Batch.countDocuments(filter),
  ]);
  const mfgs = await Entity.find({ _id: { $in: [...new Set(items.map((b) => b.manufacturer_id))] } }, { name: 1 }).lean();
  const mName = Object.fromEntries(mfgs.map((m) => [m._id, m.name]));
  res.json({ items: items.map((b) => ({ ...decorateBatch(b), manufacturer_name: mName[b.manufacturer_id] || null })), total, limit, skip });
}));

router.get('/:id', ah(async (req, res) => {
  const batch = await Batch.findById(req.params.id).lean();
  if (!batch) throw notFound('Batch not found');
  if (!(await canSeeBatch(req.user, batch._id))) throw forbidden('This batch is outside your scope');
  const [mfg, recalls, anomalies, holders] = await Promise.all([
    Entity.findById(batch.manufacturer_id).lean(),
    Recall.find({ batch_ids: batch._id }).sort({ initiated_at: -1 }).lean(),
    (isOversight(req.user) || req.user.entity_id === batch.manufacturer_id)
      ? Anomaly.find({ batch_id: batch._id }).lean() : Promise.resolve(undefined),
    isOversight(req.user) || req.user.entity_id === batch.manufacturer_id
      ? Inventory.find({ batch_id: batch._id, quantity_on_hand: { $gt: 0 } }).lean() : Promise.resolve(undefined),
  ]);
  res.json({
    ...decorateBatch(batch),
    manufacturer_name: mfg ? mfg.name : null,
    recalls: recalls.map((r) => ({ _id: r._id, status: r.status, recall_class: r.recall_class, initiated_at: r.initiated_at })),
    ...(anomalies ? { anomalies } : {}),
    ...(holders ? { holders } : {}),
  });
}));

module.exports = router;
