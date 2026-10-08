const router = require('express').Router();
const { Entity } = require('../models');
const { ENTITY_TYPES } = require('../models/constants');
const { ah, notFound } = require('../utils/errors');
const v = require('../utils/validate');

// Entity directory (names for the UI). Public business identities, so any authenticated role may read it.
router.get('/', ah(async (req, res) => {
  const filter = {};
  const type = v.oneOf(req.query.type, 'type', ENTITY_TYPES, { required: false });
  if (type) filter.entity_type = type;
  if (req.query.q) {
    const q = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 50);
    filter.$or = [{ _id: new RegExp(q, 'i') }, { name: new RegExp(q, 'i') }, { city: new RegExp(q, 'i') }];
  }
  const items = await Entity.find(filter).sort({ _id: 1 }).lean();
  res.json({ items, total: items.length });
}));

router.get('/:id', ah(async (req, res) => {
  const e = await Entity.findById(req.params.id).lean();
  if (!e) throw notFound('Entity not found');
  res.json(e);
}));

module.exports = router;
