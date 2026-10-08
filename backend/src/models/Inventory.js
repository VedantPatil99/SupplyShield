const { Schema, model } = require('mongoose');
const { ENTITY_TYPES, INVENTORY_RECALL_STATUS } = require('./constants');

const InventorySchema = new Schema({
  _id: String, // INV-<entity id without dashes>-<batch id without dashes>
  entity_id: { type: String, required: true },
  entity_type: { type: String, enum: ENTITY_TYPES, required: true },
  batch_id: { type: String, required: true, index: true },
  quantity_on_hand: { type: Number, required: true, min: 0 },
  location: { city: String, country: String },
  recall_status: { type: String, enum: INVENTORY_RECALL_STATUS, default: 'none' },
  last_updated: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'inventory' });

InventorySchema.index({ entity_id: 1, batch_id: 1 }, { unique: true });

InventorySchema.statics.idFor = (entityId, batchId) => `INV-${entityId.replace(/-/g, '')}-${batchId.replace(/-/g, '')}`;

module.exports = model('Inventory', InventorySchema);
