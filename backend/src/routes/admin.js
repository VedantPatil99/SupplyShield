const router = require('express').Router();
const mongoose = require('mongoose');
const { User, Entity, AuditLog, Batch, Shipment, Recall } = require('../models');
const { ROLES, ENTITY_TYPES, ID } = require('../models/constants');
const { requireRole } = require('../middleware/rbac');
const { ah, badRequest, notFound, conflict } = require('../utils/errors');
const projector = require('../services/graphProjector');
const v = require('../utils/validate');

const pub = (u) => ({ id: String(u._id), username: u.username, role: u.role, entity_id: u.entity_id, display_name: u.display_name, created_at: u.created_at });

async function checkEntityForRole(role, entityId) {
  if (ENTITY_TYPES.includes(role)) {
    if (!entityId || !ID.entity.test(entityId)) throw badRequest(`entity_id is required for role ${role}`);
    const e = await Entity.findById(entityId).lean();
    if (!e) throw badRequest(`Unknown entity ${entityId}`);
    if (e.entity_type !== role) throw badRequest(`${entityId} is a ${e.entity_type}, not a ${role}`);
    return entityId;
  }
  return null; // regulator/admin are not tied to an entity
}

// ---- users (admin only) ----
router.get('/users', requireRole('admin'), ah(async (req, res) => {
  const users = await User.find({}).sort({ role: 1, username: 1 }).lean();
  res.json({ items: users.map(pub), total: users.length });
}));

router.post('/users', requireRole('admin'), ah(async (req, res) => {
  const username = v.str(req.body.username, 'username', { max: 40, pattern: /^[a-z0-9_.-]{3,40}$/i });
  const password = v.str(req.body.password, 'password', { max: 128 });
  if (password.length < 8) throw badRequest('password must be at least 8 characters');
  const role = v.oneOf(req.body.role, 'role', ROLES);
  const entityId = await checkEntityForRole(role, req.body.entity_id);
  if (await User.exists({ username })) throw conflict('Username already exists');
  const u = await User.create({
    username, role, entity_id: entityId, password_hash: await User.hashPassword(password),
    display_name: v.str(req.body.display_name, 'display_name', { required: false, max: 80 }) || username,
  });
  res.locals.resourceId = username;
  res.status(201).json(pub(u));
}));

router.patch('/users/:id', requireRole('admin'), ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('User not found');
  const u = await User.findById(req.params.id);
  if (!u) throw notFound('User not found');
  if (req.body.role !== undefined || req.body.entity_id !== undefined) {
    const role = v.oneOf(req.body.role !== undefined ? req.body.role : u.role, 'role', ROLES);
    if (String(u._id) === req.user.id && role !== 'admin') throw conflict('You cannot remove your own admin role');
    u.entity_id = await checkEntityForRole(role, req.body.entity_id !== undefined ? req.body.entity_id : u.entity_id);
    u.role = role;
  }
  if (req.body.display_name !== undefined) u.display_name = v.str(req.body.display_name, 'display_name', { max: 80 });
  if (req.body.password !== undefined) {
    const pw = v.str(req.body.password, 'password', { max: 128 });
    if (pw.length < 8) throw badRequest('password must be at least 8 characters');
    u.password_hash = await User.hashPassword(pw);
  }
  await u.save();
  res.locals.resourceId = u.username;
  res.json(pub(u));
}));

router.delete('/users/:id', requireRole('admin'), ah(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('User not found');
  if (req.params.id === req.user.id) throw conflict('You cannot delete your own account');
  const u = await User.findByIdAndDelete(req.params.id).lean();
  if (!u) throw notFound('User not found');
  res.locals.resourceId = u.username;
  res.json({ deleted: u.username });
}));

// ---- sync health (admin) ----
router.get('/sync-health', requireRole('admin'), ah(async (req, res) => {
  const sync = req.app.locals.sync;
  const [mongo, graph] = await Promise.all([
    (async () => ({
      entities: await Entity.estimatedDocumentCount(),
      batches: await Batch.estimatedDocumentCount(),
      shipments: await Shipment.estimatedDocumentCount(),
      recalls: await Recall.estimatedDocumentCount(),
    }))(),
    projector.graphCounts(),
  ]);
  const comparison = ['entities', 'batches', 'shipments', 'recalls'].map((k) => ({ collection: k, mongo: mongo[k], neo4j: graph[k], in_sync: mongo[k] === graph[k] }));
  const stats = sync ? sync.stats : { status: 'not running' };
  res.json({
    sync: { ...stats, lag_since_last_event_ms: stats.last_event_at ? Date.now() - new Date(stats.last_event_at) : null },
    counts: comparison,
    produced_edges: { total: graph.produced, planted: graph.produced_planted, note: 'One planted PRODUCED edge (MFG-IN-00013 -> BATCH-2026-B64675) is injected by the seed; it has no Mongo counterpart.' },
    all_in_sync: comparison.every((c) => c.in_sync),
    checked_at: new Date(),
  });
}));

// ---- audit log (admin, regulator). Read-only: there is no route that mutates audit_log. ----
router.get('/audit', requireRole('admin', 'regulator'), ah(async (req, res) => {
  const { limit, skip } = v.pageParams(req.query, { defLimit: 100, maxLimit: 500 });
  const filter = {};
  if (req.query.username) filter.username = String(req.query.username);
  if (req.query.resource) filter.resource = String(req.query.resource);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ ts: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, limit, skip });
}));

module.exports = router;
