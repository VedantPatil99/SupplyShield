const router = require('express').Router();
const { Anomaly, Batch } = require('../models');
const { ANOMALY_TYPES, ANOMALY_STATUS, SEVERITY } = require('../models/constants');
const { requireRole, isOversight } = require('../middleware/rbac');
const { ah, notFound, badRequest } = require('../utils/errors');
const { runDetection } = require('../services/anomaly');
const v = require('../utils/validate');

// FR-5 run the five graph-pattern detectors on demand.
router.post('/run', requireRole('regulator', 'admin'), ah(async (req, res) => {
  const summary = await runDetection({ trigger: `manual:${req.user.username}` });
  res.locals.auditDetails = { findings: summary.findings, new_findings: summary.new_findings };
  res.json(summary);
}));

router.get('/', requireRole('regulator', 'admin', 'manufacturer'), ah(async (req, res) => {
  const filter = {};
  if (!isOversight(req.user)) {
    filter.batch_id = { $in: (await Batch.find({ manufacturer_id: req.user.entity_id }, { _id: 1 }).lean()).map((b) => b._id) };
  }
  const status = v.oneOf(req.query.status, 'status', ANOMALY_STATUS, { required: false });
  if (status) filter.status = status;
  const type = v.oneOf(req.query.type, 'type', ANOMALY_TYPES, { required: false });
  if (type) filter.type = type;
  const severity = v.oneOf(req.query.severity, 'severity', SEVERITY, { required: false });
  if (severity) filter.severity = severity;
  if (req.query.batch_id) {
    const b = String(req.query.batch_id);
    if (filter.batch_id && !filter.batch_id.$in.includes(b)) filter.batch_id = { $in: [] };
    else filter.batch_id = b;
  }
  const items = await Anomaly.find(filter).sort({ batch_id: 1, type: 1, discriminator: 1 }).lean();
  const batches = await Batch.find({ _id: { $in: [...new Set(items.map((a) => a.batch_id))] } }, { product_name: 1, manufacturer_id: 1 }).lean();
  const bmap = Object.fromEntries(batches.map((b) => [b._id, b]));
  res.json({
    items: items.map((a) => ({ ...a, product_name: (bmap[a.batch_id] || {}).product_name || null, manufacturer_id: (bmap[a.batch_id] || {}).manufacturer_id || null })),
    total: items.length,
  });
}));

router.patch('/:id', requireRole('regulator', 'admin'), ah(async (req, res) => {
  const status = v.oneOf(req.body.status, 'status', ANOMALY_STATUS);
  const note = v.str(req.body.note, 'note', { required: false, max: 1000 });
  if (!req.params.id.startsWith('ANOM|')) throw badRequest('Invalid anomaly id');
  const doc = await Anomaly.findByIdAndUpdate(
    req.params.id,
    { $set: { status, reviewed_by: req.user.username, reviewed_at: new Date(), ...(note !== undefined ? { review_note: note } : {}) } },
    { new: true, lean: true },
  );
  if (!doc) throw notFound('Anomaly not found');
  res.locals.resourceId = doc._id;
  res.json(doc);
}));

module.exports = router;
