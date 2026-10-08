const router = require('express').Router();
const config = require('../config/env');
const { Recall, Anomaly, Batch, Shipment, Inventory } = require('../models');
const { isOversight } = require('../middleware/rbac');
const { ah } = require('../utils/errors');

// Derived alerts for the signed-in user (nothing is stored).
router.get('/', ah(async (req, res) => {
  const u = req.user;
  const alerts = [];
  if (isOversight(u)) {
    const [openAnoms, openRecalls] = await Promise.all([
      Anomaly.find({ status: 'open' }, { batch_id: 1, type: 1, severity: 1, summary: 1 }).lean(),
      Recall.find({ status: 'in_progress' }, { _id: 1, recall_class: 1 }).lean(),
    ]);
    const batches = new Set(openAnoms.map((a) => a.batch_id));
    if (openAnoms.length) {
      alerts.push({ kind: 'anomaly', severity: openAnoms.some((a) => a.severity === 'high') ? 'high' : 'medium',
        title: `${openAnoms.length} open anomaly finding(s) across ${batches.size} batch(es)`, link: 'anomalies' });
    }
    if (openRecalls.length) {
      alerts.push({ kind: 'recall', severity: openRecalls.some((r) => r.recall_class === 'Class I') ? 'high' : 'medium',
        title: `${openRecalls.length} recall(s) in progress`, link: 'recalls' });
    }
    return res.json({ items: alerts });
  }

  const e = u.entity_id;
  const recalls = await Recall.find({ status: 'in_progress', 'affected_entities.entity_id': e }).lean();
  for (const r of recalls) {
    const mine = r.affected_entities.find((a) => a.entity_id === e);
    if (mine.status !== 'returned') {
      alerts.push({
        kind: 'recall', severity: r.recall_class === 'Class I' ? 'high' : 'medium', recall_id: r._id, status: mine.status,
        title: `${r.recall_class} recall ${r._id} (${r.batch_ids.join(', ')}): your status is "${mine.status}"`, detail: r.reason, link: 'recalls',
      });
    }
  }
  if (u.role === 'manufacturer') {
    const own = (await Batch.find({ manufacturer_id: e }, { _id: 1 }).lean()).map((b) => b._id);
    const anoms = await Anomaly.find({ batch_id: { $in: own }, status: 'open' }).lean();
    for (const a of anoms) {
      alerts.push({ kind: 'anomaly', severity: a.severity, batch_id: a.batch_id, title: `${a.type.replace(/_/g, ' ')} on ${a.batch_id}`, detail: a.summary, link: 'anomalies' });
    }
  }
  if (u.role !== 'manufacturer') {
    const pending = await Shipment.countDocuments({ 'to_entity.entity_id': e, status: { $ne: 'delivered' } });
    if (pending) alerts.push({ kind: 'shipment', severity: 'low', title: `${pending} inbound shipment(s) awaiting receipt confirmation`, link: 'shipments' });
  }
  const held = await Inventory.find({ entity_id: e, quantity_on_hand: { $gt: 0 } }, { batch_id: 1 }).lean();
  if (held.length) {
    const expired = await Batch.countDocuments({ _id: { $in: held.map((h) => h.batch_id) }, expiry_date: { $lt: config.today() } });
    if (expired) alerts.push({ kind: 'expiry', severity: 'medium', title: `${expired} batch(es) in your stock are past expiry`, link: 'inventory' });
  }
  return res.json({ items: alerts });
}));

module.exports = router;
