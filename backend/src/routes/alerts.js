const router = require('express').Router();
const config = require('../config/env');
const { Recall, Anomaly, Batch, Shipment, Inventory } = require('../models');
const { isOversight } = require('../middleware/rbac');
const { ah } = require('../utils/errors');

// Plain names for the automatic checks (kept in step with public/js/copy.jsx).
const CHECK_TITLE = {
  provenance_gap: 'Stock from an unknown source',
  multi_manufacturer_batch: 'Two makers claim the same batch',
  duplicate_batch_fanin: 'Same batch arrived from two suppliers at once',
  abnormal_fanout: 'Unusually wide distribution burst',
  reentrant_distribution: 'Same batch received twice, including unverified stock',
};
const NEXT_STEP = {
  notified: 'please confirm you have seen it',
  acknowledged: 'next, set the stock aside',
  quarantined: 'next, return the stock',
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Derived alerts for the signed-in user (nothing is stored).
router.get('/', ah(async (req, res) => {
  const u = req.user;
  const alerts = [];
  if (isOversight(u)) {
    const [openAnoms, openRecalls] = await Promise.all([
      Anomaly.find({ status: 'open' }, { batch_id: 1, type: 1, severity: 1, summary: 1 }).lean(),
      Recall.find({ status: 'in_progress' }).lean(),
    ]);
    const batches = new Set(openAnoms.map((a) => a.batch_id));
    if (openAnoms.length) {
      alerts.push({ kind: 'anomaly', severity: openAnoms.some((a) => a.severity === 'high') ? 'high' : 'medium',
        title: `${plural(openAnoms.length, 'suspicious finding', 'suspicious findings')} on ${plural(batches.size, 'batch', 'batches')} to review`,
        detail: 'Found by the automatic checks. Each one is a warning to investigate, not proof.', link: 'anomalies' });
    }
    if (openRecalls.length) {
      const waiting = openRecalls.reduce((n, r) => n + r.affected_entities.filter((a) => a.status === 'notified').length, 0);
      alerts.push({ kind: 'recall', severity: openRecalls.some((r) => r.recall_class === 'Class I') ? 'high' : 'medium',
        title: `${plural(openRecalls.length, 'recall is', 'recalls are')} in progress`,
        detail: waiting ? `${plural(waiting, 'company has', 'companies have')} not responded yet.` : 'Every company has responded.', link: 'recalls' });
    }
    return res.json({ items: alerts });
  }

  const e = u.entity_id;
  const recalls = await Recall.find({ status: 'in_progress', 'affected_entities.entity_id': e }).lean();
  const names = Object.fromEntries((await Batch.find({ _id: { $in: recalls.flatMap((r) => r.batch_ids) } }, { product_name: 1 }).lean()).map((b) => [b._id, b.product_name]));
  for (const r of recalls) {
    const mine = r.affected_entities.find((a) => a.entity_id === e);
    if (mine.status !== 'returned') {
      const what = r.batch_ids.map((b) => (names[b] ? `${names[b]} (${b})` : b)).join(', ');
      alerts.push({
        kind: 'recall', severity: r.recall_class === 'Class I' ? 'high' : 'medium', recall_id: r._id, status: mine.status,
        title: `Recall: ${what}. Stop selling or shipping it; ${NEXT_STEP[mine.status]}.`, detail: `Reason: ${r.reason}`, link: 'recalls',
      });
    }
  }
  if (u.role === 'manufacturer') {
    const own = (await Batch.find({ manufacturer_id: e }, { _id: 1, product_name: 1 }).lean());
    const pname = Object.fromEntries(own.map((b) => [b._id, b.product_name]));
    const anoms = await Anomaly.find({ batch_id: { $in: own.map((b) => b._id) }, status: 'open' }).lean();
    for (const a of anoms) {
      alerts.push({ kind: 'anomaly', severity: a.severity, batch_id: a.batch_id,
        title: `${CHECK_TITLE[a.type]}: your batch ${pname[a.batch_id] || ''} (${a.batch_id})`, detail: a.summary, link: 'anomalies' });
    }
  }
  if (u.role !== 'manufacturer') {
    const pending = await Shipment.countDocuments({ 'to_entity.entity_id': e, status: { $ne: 'delivered' } });
    if (pending) {
      alerts.push({ kind: 'shipment', severity: 'low', title: `${plural(pending, 'delivery is', 'deliveries are')} on the way to you`,
        detail: 'Press "Confirm received" when it arrives so the stock is added to your inventory.', link: 'shipments' });
    }
  }
  const held = await Inventory.find({ entity_id: e, quantity_on_hand: { $gt: 0 } }, { batch_id: 1 }).lean();
  if (held.length) {
    const expired = await Batch.countDocuments({ _id: { $in: held.map((h) => h.batch_id) }, expiry_date: { $lt: config.today() } });
    if (expired) alerts.push({ kind: 'expiry', severity: 'medium', title: `${plural(expired, 'batch', 'batches')} in your stock ${expired === 1 ? 'is' : 'are'} past expiry`, detail: 'Do not sell or ship expired stock.', link: 'inventory' });
  }
  return res.json({ items: alerts });
}));

module.exports = router;
