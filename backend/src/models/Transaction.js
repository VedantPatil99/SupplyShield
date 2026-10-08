const { Schema, model } = require('mongoose');
const { TXN_TYPES } = require('./constants');
const appendOnly = require('./appendOnly');

const TransactionSchema = new Schema({
  _id: String,
  type: { type: String, enum: TXN_TYPES, required: true },
  batch_id: { type: String, required: true, index: true },
  shipment_id: { type: String, default: null },
  recall_id: { type: String, default: null },
  from_entity_id: String,
  to_entity_id: String,
  quantity: Number,
  timestamp: { type: Date, required: true, index: true },
  verified_by: String,
  signature_hash: String,
  details: Schema.Types.Mixed,
}, { versionKey: false, collection: 'transactions' });

TransactionSchema.index({ from_entity_id: 1 });
TransactionSchema.index({ to_entity_id: 1 });
TransactionSchema.plugin(appendOnly, { name: 'transactions' });

module.exports = model('Transaction', TransactionSchema);
