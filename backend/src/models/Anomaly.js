const { Schema, model } = require('mongoose');
const { ANOMALY_TYPES, ANOMALY_STATUS, SEVERITY } = require('./constants');

const AnomalySchema = new Schema({
  _id: String, // deterministic: ANOM|<type>|<batch_id>|<discriminator> -> re-runs upsert instead of duplicating
  batch_id: { type: String, required: true, index: true },
  type: { type: String, enum: ANOMALY_TYPES, required: true },
  discriminator: { type: String, required: true },
  severity: { type: String, enum: SEVERITY, required: true },
  summary: String,
  details: Schema.Types.Mixed,
  status: { type: String, enum: ANOMALY_STATUS, default: 'open', index: true },
  detected_at: { type: Date, default: Date.now },
  last_seen_at: { type: Date, default: Date.now },
  reviewed_by: String,
  reviewed_at: Date,
  review_note: String,
}, { versionKey: false, collection: 'anomalies' });

AnomalySchema.index({ type: 1, batch_id: 1, discriminator: 1 }, { unique: true });

module.exports = model('Anomaly', AnomalySchema);
