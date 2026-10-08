const { Schema, model } = require('mongoose');

const SyncStateSchema = new Schema({
  _id: String, // "graph-sync"
  resume_token: Schema.Types.Mixed,
  last_event_at: Date,
  last_reconciled_at: Date,
  events_processed: { type: Number, default: 0 },
  error_count: { type: Number, default: 0 },
}, { versionKey: false, collection: 'sync_state' });

module.exports = model('SyncState', SyncStateSchema);
