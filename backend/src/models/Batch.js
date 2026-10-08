const { Schema, model } = require('mongoose');
const { BATCH_STATUS } = require('./constants');

const BatchSchema = new Schema({
  _id: String,
  product_name: { type: String, required: true },
  product_code: { type: String, required: true },
  manufacturer_id: { type: String, required: true, index: true },
  manufacture_date: { type: Date, required: true },
  expiry_date: { type: Date, required: true },
  quantity_produced: { type: Number, required: true, min: 1 },
  unit: { type: String, default: 'units' },
  storage_conditions: {
    temperature_range_c: [Number],
    requires_cold_chain: Boolean,
  },
  regulatory: { approval_number: String, country_of_origin: String },
  quality_control: { qc_passed: Boolean, qc_certificate_id: String },
  status: { type: String, enum: BATCH_STATUS, default: 'active', index: true },
}, { versionKey: false, collection: 'batches', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = model('Batch', BatchSchema);
