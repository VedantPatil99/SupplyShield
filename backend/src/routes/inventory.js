const router = require('express').Router();
const { Inventory, Batch, Recall } = require('../models');
const { isOversight } = require('../middleware/rbac');
const { ah, forbidden } = require('../utils/errors');
const { decorateBatch } = require('../services/scope');
const v = require('../utils/validate');

// FR-3 inventory view. Own entity only; regulator/admin may pass ?entity_id=.
router.get('/', ah(async (req, res) => {
  const { limit, skip } = v.pageParams(req.query, { defLimit: 100, maxLimit: 1000 });
  const filter = {};
  if (isOversight(req.user)) {
    if (req.query.entity_id) filter.entity_id = String(req.query.entity_id);
  } else {
    if (req.query.entity_id && req.query.entity_id !== req.user.entity_id) throw forbidden('You can only view your own inventory');
    filter.entity_id = req.user.entity_id;
  }
  if (req.query.batch_id) filter.batch_id = String(req.query.batch_id);
  if (req.query.in_stock === 'true') filter.quantity_on_hand = { $gt: 0 };
  const [items, total] = await Promise.all([
    Inventory.find(filter).sort({ last_updated: -1 }).skip(skip).limit(limit).lean(),
    Inventory.countDocuments(filter),
  ]);
  const batchIds = [...new Set(items.map((i) => i.batch_id))];
  const [batches, recalls] = await Promise.all([
    Batch.find({ _id: { $in: batchIds } }, { product_name: 1, expiry_date: 1, status: 1, manufacturer_id: 1 }).lean(),
    Recall.find({ batch_ids: { $in: batchIds }, status: 'in_progress' }).lean(),
  ]);
  const bmap = Object.fromEntries(batches.map((b) => [b._id, decorateBatch(b)]));
  res.json({
    items: items.map((i) => {
      // Recall flag via join: an open recall on this batch that notified this holder.
      const rec = recalls.find((r) => r.batch_ids.includes(i.batch_id) && r.affected_entities.some((a) => a.entity_id === i.entity_id));
      const mine = rec && rec.affected_entities.find((a) => a.entity_id === i.entity_id);
      const b = bmap[i.batch_id] || {};
      return {
        ...i,
        product_name: b.product_name || null,
        expiry_date: b.expiry_date || null,
        is_expired: !!b.is_expired,
        batch_status: b.status || null,
        active_recall: rec ? { recall_id: rec._id, recall_class: rec.recall_class, my_status: mine.status } : null,
      };
    }),
    total, limit, skip,
  });
}));

module.exports = router;
