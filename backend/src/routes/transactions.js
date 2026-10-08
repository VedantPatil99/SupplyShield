const router = require('express').Router();
const { Transaction, Batch } = require('../models');
const { TXN_TYPES } = require('../models/constants');
const { isOversight } = require('../middleware/rbac');
const { ah } = require('../utils/errors');
const v = require('../utils/validate');

// Read-only ledger. There are deliberately no mutation routes (the model is append-only too).
router.get('/', ah(async (req, res) => {
  const { limit, skip } = v.pageParams(req.query);
  const filter = {};
  if (!isOversight(req.user)) {
    const e = req.user.entity_id;
    const or = [{ from_entity_id: e }, { to_entity_id: e }];
    if (req.user.role === 'manufacturer') {
      or.push({ batch_id: { $in: (await Batch.find({ manufacturer_id: e }, { _id: 1 }).lean()).map((b) => b._id) } });
    }
    filter.$or = or;
  }
  if (req.query.batch_id) filter.batch_id = String(req.query.batch_id);
  const type = v.oneOf(req.query.type, 'type', TXN_TYPES, { required: false });
  if (type) filter.type = type;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    Transaction.countDocuments(filter),
  ]);
  res.json({ items, total, limit, skip });
}));

module.exports = router;
