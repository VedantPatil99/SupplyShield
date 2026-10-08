const { Schema, model } = require('mongoose');
const appendOnly = require('./appendOnly');

const AuditLogSchema = new Schema({
  ts: { type: Date, default: Date.now, index: true },
  user_id: String,
  username: String,
  role: String,
  entity_id: String,
  action: { type: String, required: true }, // e.g. "POST /api/shipments"
  resource: String,
  resource_id: String,
  status_code: Number,
  ip: String,
  details: Schema.Types.Mixed,
}, { versionKey: false, collection: 'audit_log' });

AuditLogSchema.plugin(appendOnly, { name: 'audit_log' });

module.exports = model('AuditLog', AuditLogSchema);
