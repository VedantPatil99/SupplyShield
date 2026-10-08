const { Schema, model } = require('mongoose');
const { ENTITY_TYPES, SHIPMENT_STATUS } = require('./constants');

const Party = new Schema({
  entity_id: { type: String, required: true },
  entity_type: { type: String, enum: ENTITY_TYPES, required: true },
  city: String,
}, { _id: false });

const ShipmentSchema = new Schema({
  _id: String,
  batch_id: { type: String, required: true, index: true },
  quantity: { type: Number, required: true, min: 1 },
  from_entity: { type: Party, required: true },
  to_entity: { type: Party, required: true },
  dispatch_timestamp: { type: Date, required: true, index: true },
  actual_arrival: Date,
  transport_mode: { type: String, enum: ['road', 'air', 'rail', 'sea'], default: 'road' },
  tracking_number: String,
  status: { type: String, enum: SHIPMENT_STATUS, default: 'dispatched' },
}, { versionKey: false, collection: 'shipments', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

ShipmentSchema.index({ 'from_entity.entity_id': 1 });
ShipmentSchema.index({ 'to_entity.entity_id': 1 });

module.exports = model('Shipment', ShipmentSchema);
