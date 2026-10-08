const { Schema, model } = require('mongoose');
const { RECALL_STATUS, RECALL_CLASSES, AFFECTED_STATUS } = require('./constants');

const Affected = new Schema({
  entity_id: { type: String, required: true },
  entity_type: [String], // array of Neo4j labels, e.g. ["Pharmacy"] (dataset convention, kept as-is)
  status: { type: String, enum: AFFECTED_STATUS, default: 'notified' },
  updated_at: { type: Date, default: Date.now },
}, { _id: false });

const RecallSchema = new Schema({
  _id: String,
  batch_ids: { type: [String], required: true, index: true },
  initiated_by: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  recall_class: { type: String, enum: RECALL_CLASSES, required: true },
  affected_entities: [Affected],
  status: { type: String, enum: RECALL_STATUS, default: 'in_progress', index: true },
  initiated_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'recalls' });

RecallSchema.index({ 'affected_entities.entity_id': 1 });

module.exports = model('Recall', RecallSchema);
