// Change-stream sync service: MongoDB (system of record) -> Neo4j (graph projection).
// Runs in the same Node process as Express (a separate worker would be the production-hardening step).
const { EventEmitter } = require('events');
const mongoose = require('mongoose');
const { SyncState } = require('../models');
const projector = require('./graphProjector');
const { sleep } = require('../utils/retry');

const STATE_ID = 'graph-sync';
const MAX_ATTEMPTS = 3;

class SyncService extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.stream = null;
    this.running = false;
    this.stats = {
      started_at: null,
      status: 'stopped',
      mode: null, // "resumed" | "reconciled"
      last_event_at: null, // Mongo wallTime of the last projected change
      last_projected_at: null,
      last_lag_ms: null,
      avg_lag_ms: null,
      max_lag_ms: null,
      events_processed: 0,
      error_count: 0,
      last_error: null,
    };
    this._lagSum = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stats.started_at = new Date();
    const db = mongoose.connection.db;
    const state = await SyncState.findById(STATE_ID).lean();
    if (state) {
      this.stats.events_processed = state.events_processed || 0;
      this.stats.error_count = state.error_count || 0;
    }

    let token = state && state.resume_token;
    if (token) {
      try {
        this._open(db, token);
        this.stats.mode = 'resumed';
        this.log.info('[sync] resuming change stream from stored token');
      } catch (err) {
        this.log.warn(`[sync] could not resume (${err.message}); reconciling instead`);
        token = null;
      }
    }
    if (!token) {
      // Open the stream *before* reconciling so changes made during reconciliation are not lost
      // (they are replayed afterwards; MERGE makes the replay harmless).
      this._open(db, null);
      await projector.reconcileAll(db, this.log);
      await SyncState.updateOne({ _id: STATE_ID }, { $set: { last_reconciled_at: new Date() } }, { upsert: true });
      this.stats.mode = 'reconciled';
    }
    this.stats.status = 'running';
    this._loop(db).catch((err) => this.log.error('[sync] loop crashed', err));
  }

  _open(db, resumeAfter) {
    const pipeline = [
      { $match: { 'ns.coll': { $in: projector.PROJECTED_COLLECTIONS }, operationType: { $in: ['insert', 'update', 'replace'] } } },
    ];
    const opts = { fullDocument: 'updateLookup' };
    if (resumeAfter) opts.resumeAfter = resumeAfter;
    this.stream = db.watch(pipeline, opts);
  }

  async _loop(db) {
    while (this.running) {
      try {
        // eslint-disable-next-line no-restricted-syntax
        for await (const change of this.stream) {
          if (!this.running) break;
          await this._handle(change);
        }
        if (!this.running) return;
      } catch (err) {
        if (!this.running) return;
        this.stats.error_count++;
        this.stats.last_error = `stream: ${err.message}`;
        this.log.error(`[sync] change stream error: ${err.message}`);
        // Resume token no longer in the oplog (or other unrecoverable stream error): rebuild from scratch.
        const historyLost = err.code === 286 || err.codeName === 'ChangeStreamHistoryLost' || err.code === 280;
        await sleep(1000);
        try {
          if (historyLost) {
            await SyncState.updateOne({ _id: STATE_ID }, { $unset: { resume_token: 1 } });
            this._open(db, null);
            await projector.reconcileAll(db, this.log);
            this.stats.mode = 'reconciled';
          } else {
            const st = await SyncState.findById(STATE_ID).lean();
            this._open(db, st && st.resume_token);
          }
        } catch (e2) {
          this.log.error(`[sync] reopen failed: ${e2.message}`);
        }
      }
    }
  }

  async _handle(change) {
    const coll = change.ns.coll;
    const doc = change.fullDocument;
    if (doc) {
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await projector.projectDocs(coll, [doc]);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          await sleep(200 * attempt);
        }
      }
      if (lastErr) {
        this.stats.error_count++;
        this.stats.last_error = `${coll}/${doc._id}: ${lastErr.message}`;
        this.log.error(`[sync] failed to project ${coll}/${doc._id}: ${lastErr.message}`);
      }
    }
    const now = new Date();
    const wall = change.wallTime ? new Date(change.wallTime) : now;
    const lag = now - wall;
    this.stats.events_processed++;
    this.stats.last_event_at = wall;
    this.stats.last_projected_at = now;
    this.stats.last_lag_ms = lag;
    this._lagSum += lag;
    this._lagCount = (this._lagCount || 0) + 1;
    this.stats.avg_lag_ms = Math.round(this._lagSum / this._lagCount);
    this.stats.max_lag_ms = Math.max(this.stats.max_lag_ms || 0, lag);
    await SyncState.updateOne(
      { _id: STATE_ID },
      { $set: { resume_token: change._id, last_event_at: wall, events_processed: this.stats.events_processed, error_count: this.stats.error_count } },
      { upsert: true },
    );
    this.emit('projected', { collection: coll, id: doc && doc._id, operationType: change.operationType });
  }

  async stop() {
    this.running = false;
    this.stats.status = 'stopped';
    if (this.stream) {
      try { await this.stream.close(); } catch (_) { /* already closed */ }
      this.stream = null;
    }
  }
}

module.exports = { SyncService, STATE_ID };
