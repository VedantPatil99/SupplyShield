const router = require('express').Router();
const { Batch, Recall, Inventory, Anomaly } = require('../models');
const { ID } = require('../models/constants');
const { requireRole, isOversight } = require('../middleware/rbac');
const { canSeeBatch, decorateBatch } = require('../services/scope');
const { ah, notFound, forbidden, badRequest } = require('../utils/errors');
const trace = require('../services/traceability');

// FR-4 forward trace (Neo4j): manufacturer (own batches), regulator, admin.
router.get('/forward/:batchId', requireRole('manufacturer', 'regulator', 'admin'), ah(async (req, res) => {
  const { batchId } = req.params;
  if (req.user.role === 'manufacturer') {
    const b = await Batch.findById(batchId, { manufacturer_id: 1 }).lean();
    if (!b) throw notFound(`Batch ${batchId} not found`);
    if (b.manufacturer_id !== req.user.entity_id) throw forbidden('You can only trace your own batches');
  }
  const result = await trace.forwardTrace(batchId);
  if (!result) throw notFound(`Batch ${batchId} not found in the graph`);
  res.json(result);
}));

// Network map of one batch for the visual page. Everyone who can see the batch may open it:
// regulator/admin and the batch's manufacturer get the whole map; other companies get their own neighbourhood.
router.get('/map/:batchId', ah(async (req, res) => {
  const { batchId } = req.params;
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound(`Batch ${batchId} not found`);
  if (!(await canSeeBatch(req.user, batchId))) throw forbidden('This batch is outside your scope');
  const g = await trace.batchGraph(batchId);
  if (!g) throw notFound(`Batch ${batchId} not found in the graph`);

  const full = isOversight(req.user) || req.user.entity_id === batch.manufacturer_id;
  const edges = full ? g.edges : trace.neighbourhood(g.edges, req.user.entity_id);
  const visible = new Set([...g.producers.map((p) => p.entity_id), ...edges.flatMap((e) => [e.from.entity_id, e.to.entity_id])]);

  const recall = await Recall.findOne({ batch_ids: batchId }).sort({ status: -1, initiated_at: -1 }).lean(); // in_progress sorts first
  const holdings = await Inventory.find({ batch_id: batchId, ...(full ? {} : { entity_id: req.user.entity_id }) }).lean();
  const anomalies = full ? await Anomaly.find({ batch_id: batchId }).lean() : [];

  res.json({
    batch: decorateBatch(batch),
    view: full ? 'full' : 'neighbourhood',
    producers: g.producers,
    edges,
    recall: recall ? {
      recall_id: recall._id, recall_class: recall.recall_class, reason: recall.reason, status: recall.status, initiated_at: recall.initiated_at,
      statuses: Object.fromEntries(recall.affected_entities.filter((a) => visible.has(a.entity_id)).map((a) => [a.entity_id, a.status])),
      total: recall.affected_entities.length,
      returned: recall.affected_entities.filter((a) => a.status === 'returned').length,
    } : null,
    holdings: Object.fromEntries(holdings.map((h) => [h.entity_id, h.quantity_on_hand])),
    anomalies: anomalies.map((a) => ({ type: a.type, discriminator: a.discriminator, severity: a.severity, status: a.status, summary: a.summary })),
  });
}));

// FR-4 backward trace / authenticity: pharmacy (own entity only), regulator, admin (?entity_id=).
router.get('/backward/:batchId', requireRole('pharmacy', 'regulator', 'admin'), ah(async (req, res) => {
  const { batchId } = req.params;
  let entityId = req.query.entity_id ? String(req.query.entity_id) : null;
  if (req.user.role === 'pharmacy') {
    if (entityId && entityId !== req.user.entity_id) throw forbidden('Pharmacies can only verify stock at their own entity');
    entityId = req.user.entity_id;
  }
  if (!entityId || !ID.entity.test(entityId)) throw badRequest('entity_id query parameter is required (e.g. PHARM-IN-00023)');
  const result = await trace.backwardTrace(batchId, entityId);
  if (!result) {
    // Unknown batch id: fails verification by definition. 404 so clients can tell "fabricated" from "broken chain".
    return res.status(404).json({
      error: `Batch ${batchId} does not exist in the supply-chain graph`,
      batch_id: batchId, entity_id: entityId, verified: false,
      reasons: [`No manufacturer has registered ${batchId}: the batch id is unknown (possibly fabricated)`],
    });
  }
  return res.json(result);
}));

module.exports = router;
