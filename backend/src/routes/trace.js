const router = require('express').Router();
const { Batch } = require('../models');
const { ID } = require('../models/constants');
const { requireRole } = require('../middleware/rbac');
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
