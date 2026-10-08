// Data scoping helpers: which batches a user may see.
const { Batch, Inventory, Shipment } = require('../models');
const { isOversight } = require('../middleware/rbac');
const config = require('../config/env');

/** Returns null for "all batches" (regulator/admin), otherwise the array of visible batch ids. */
async function visibleBatchIds(user) {
  if (isOversight(user)) return null;
  if (!user.entity_id) return [];
  if (user.role === 'manufacturer') {
    return (await Batch.find({ manufacturer_id: user.entity_id }, { _id: 1 }).lean()).map((b) => b._id);
  }
  const [inv, out, inb] = await Promise.all([
    Inventory.distinct('batch_id', { entity_id: user.entity_id }),
    Shipment.distinct('batch_id', { 'from_entity.entity_id': user.entity_id }),
    Shipment.distinct('batch_id', { 'to_entity.entity_id': user.entity_id }),
  ]);
  return [...new Set([...inv, ...out, ...inb])];
}

async function canSeeBatch(user, batchId) {
  const ids = await visibleBatchIds(user);
  return ids === null || ids.includes(batchId);
}

/** Expiry is flagged at read time against APP_NOW, never rewritten in the DB. */
function decorateBatch(b) {
  return { ...b, is_expired: b.expiry_date ? new Date(b.expiry_date) < config.today() : false };
}

module.exports = { visibleBatchIds, canSeeBatch, decorateBatch };
