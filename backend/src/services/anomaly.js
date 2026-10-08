// FR-5 anomaly detection: deterministic graph-pattern heuristics over Neo4j (not machine learning).
// Findings are upserted into MongoDB `anomalies` with deterministic ids, so re-runs are idempotent and
// never reset a reviewed/dismissed status back to open.
const neo = require('../config/neo4j');
const config = require('../config/env');
const { Anomaly } = require('../models');
const { TYPE_BY_LABEL } = require('../models/constants');

const typeOf = (labels) => TYPE_BY_LABEL[(labels || []).find((l) => TYPE_BY_LABEL[l])] || null;
const anomalyId = (type, batchId, disc) => `ANOM|${type}|${batchId}|${disc}`;

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const result = await fn();
  return { result, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100 };
}

// #5 provenance_gap: the sender neither produced the batch nor received it before dispatching it.
async function detectProvenanceGap() {
  const rows = await neo.read(
    `MATCH (b:Batch)-[:PART_OF]->(s:Shipment)-[:FROM]->(a)
     WHERE NOT EXISTS { MATCH (a)-[:PRODUCED]->(b) }
       AND NOT EXISTS {
         MATCH (b)-[:PART_OF]->(prev:Shipment)-[:TO]->(a)
         WHERE datetime(prev.dispatch_timestamp) < datetime(s.dispatch_timestamp)
       }
     MATCH (s)-[:TO]->(r)
     WITH b, a, s, r ORDER BY s.dispatch_timestamp
     RETURN b.batch_id AS batch_id, a.entity_id AS sender, a.name AS sender_name, labels(a) AS sender_labels,
            collect({shipment_id: s.shipment_id, dispatch_timestamp: s.dispatch_timestamp, quantity: s.quantity,
                     receiver: r.entity_id}) AS shipments
     ORDER BY batch_id, sender`,
  );
  return rows.map((r) => ({
    type: 'provenance_gap',
    batch_id: r.batch_id,
    discriminator: r.sender,
    severity: 'high',
    summary: `${r.sender} shipped ${r.batch_id} ${r.shipments.length} time(s) without ever producing or receiving it`,
    details: {
      sender: r.sender, sender_name: r.sender_name, sender_type: typeOf(r.sender_labels),
      shipment_count: r.shipments.length, shipments: r.shipments,
    },
  }));
}

// #2 multi_manufacturer_batch: more than one PRODUCED edge into the same batch.
async function detectMultiManufacturer() {
  const rows = await neo.read(
    `MATCH (m:Manufacturer)-[p:PRODUCED]->(b:Batch)
     WITH b, collect(DISTINCT {entity_id: m.entity_id, name: m.name, planted: coalesce(p.planted, false), source: p.source}) AS mfgs
     WHERE size(mfgs) > 1
     RETURN b.batch_id AS batch_id, b.product_name AS product_name, mfgs ORDER BY batch_id`,
  );
  return rows.map((r) => {
    const ids = r.mfgs.map((m) => m.entity_id).sort();
    return {
      type: 'multi_manufacturer_batch',
      batch_id: r.batch_id,
      discriminator: ids.join(','),
      severity: 'high',
      summary: `${r.batch_id} is claimed by ${ids.length} manufacturers: ${ids.join(', ')}`,
      details: { product_name: r.product_name, manufacturers: r.mfgs },
    };
  });
}

// #1 duplicate_batch_fanin: same batch into the same receiver from different senders within the window.
async function detectFanIn(windowHours) {
  const rows = await neo.read(
    `MATCH (b:Batch)-[:PART_OF]->(s1:Shipment)-[:TO]->(r)<-[:TO]-(s2:Shipment)<-[:PART_OF]-(b)
     WHERE s1.shipment_id < s2.shipment_id
     MATCH (s1)-[:FROM]->(a), (s2)-[:FROM]->(c)
     WITH b, r, a, c, s1, s2,
          abs(duration.inSeconds(datetime(s1.dispatch_timestamp), datetime(s2.dispatch_timestamp)).seconds) AS gapSec
     WHERE a <> c AND gapSec < $windowSec
     RETURN b.batch_id AS batch_id, r.entity_id AS receiver, r.name AS receiver_name,
            collect({senders: [a.entity_id, c.entity_id], shipments: [s1.shipment_id, s2.shipment_id],
                     timestamps: [s1.dispatch_timestamp, s2.dispatch_timestamp], gap_hours: gapSec / 3600.0}) AS pairs
     ORDER BY batch_id, receiver`,
    { windowSec: windowHours * 3600 },
  );
  return rows.map((r) => {
    const senders = [...new Set(r.pairs.flatMap((p) => p.senders))].sort();
    const minGap = Math.min(...r.pairs.map((p) => p.gap_hours));
    return {
      type: 'duplicate_batch_fanin',
      batch_id: r.batch_id,
      discriminator: r.receiver,
      severity: 'high',
      summary: `${r.receiver} received ${r.batch_id} from ${senders.length} different senders ${minGap.toFixed(1)} h apart`,
      details: { receiver: r.receiver, receiver_name: r.receiver_name, senders, window_hours: windowHours, pairs: r.pairs },
    };
  });
}

// #3 reentrant_distribution (narrowed): repeat receipt of a batch by one receiver, spread at least the
// fan-in window apart (otherwise it is a fan-in hit), and involving at least one provenance-gap shipment.
async function detectReentrant(windowHours, provenanceGapShipmentIds) {
  const rows = await neo.read(
    `MATCH (b:Batch)-[:PART_OF]->(s:Shipment)-[:TO]->(r)
     WITH b, r, collect(s) AS ss WHERE size(ss) > 1
     WITH b, r, ss, [x IN ss | datetime(x.dispatch_timestamp).epochSeconds] AS ts
     WITH b, r, ss,
          reduce(m = ts[0], t IN ts | CASE WHEN t < m THEN t ELSE m END) AS tMin,
          reduce(m = ts[0], t IN ts | CASE WHEN t > m THEN t ELSE m END) AS tMax
     WHERE tMax - tMin >= $windowSec
       AND any(x IN ss WHERE x.shipment_id IN $gapIds)
     UNWIND ss AS s
     MATCH (s)-[:FROM]->(a)
     WITH b, r, tMax - tMin AS spanSec, s, a ORDER BY s.dispatch_timestamp
     RETURN b.batch_id AS batch_id, r.entity_id AS receiver, r.name AS receiver_name, spanSec,
            collect({shipment_id: s.shipment_id, sender: a.entity_id, dispatch_timestamp: s.dispatch_timestamp,
                     provenance_gap: s.shipment_id IN $gapIds}) AS shipments
     ORDER BY batch_id, receiver`,
    { windowSec: windowHours * 3600, gapIds: provenanceGapShipmentIds },
  );
  return rows.map((r) => ({
    type: 'reentrant_distribution',
    batch_id: r.batch_id,
    discriminator: r.receiver,
    severity: 'medium',
    summary: `${r.receiver} received ${r.batch_id} ${r.shipments.length} times over ${(r.spanSec / 3600).toFixed(1)} h, including stock with no provenance`,
    details: { receiver: r.receiver, receiver_name: r.receiver_name, span_hours: r.spanSec / 3600, shipments: r.shipments },
  }));
}

// #4 abnormal_fanout: rolling window of distinct receivers per sender vs. the network baseline.
async function detectFanOut({ windowHours, multiplier, minThreshold }) {
  const [base] = await neo.read(
    `MATCH (s:Shipment)-[:FROM]->(a), (s)-[:TO]->(r)
     WITH a, date(datetime(s.dispatch_timestamp)) AS day, count(DISTINCT r) AS n
     RETURN avg(n) AS baseline, count(*) AS sender_days`,
  );
  const baseline = base && base.baseline ? base.baseline : 0;
  const threshold = Math.max(multiplier * baseline, minThreshold);

  const rows = await neo.read(
    `MATCH (s:Shipment)-[:FROM]->(a)
     WITH a, s, datetime(s.dispatch_timestamp) AS t0
     MATCH (s2:Shipment)-[:FROM]->(a), (s2)-[:TO]->(r), (b:Batch)-[:PART_OF]->(s2)
     WHERE datetime(s2.dispatch_timestamp) >= t0
       AND datetime(s2.dispatch_timestamp) < t0 + duration({hours: $windowHours})
     WITH a, s, count(DISTINCT r) AS fanout,
          collect({shipment_id: s2.shipment_id, receiver: r.entity_id, batch_id: b.batch_id, dispatch_timestamp: s2.dispatch_timestamp}) AS window
     ORDER BY fanout DESC, s.dispatch_timestamp ASC
     WITH a, collect({start: s.dispatch_timestamp, fanout: fanout, window: window}) AS wins
     WITH a, wins[0] AS top, wins[1..] AS rest
     RETURN a.entity_id AS sender, a.name AS sender_name, labels(a) AS sender_labels, top,
            CASE WHEN size(rest) > 0 THEN rest[0].fanout ELSE 0 END AS next_window
     ORDER BY top.fanout DESC`,
    { windowHours },
  );
  const hits = [];
  let nextHighest = 0;
  for (const r of rows) {
    if (r.top.fanout <= threshold) {
      nextHighest = Math.max(nextHighest, r.top.fanout);
      continue;
    }
    const win = [...r.top.window].sort((x, y) => x.dispatch_timestamp.localeCompare(y.dispatch_timestamp));
    const freq = {};
    for (const w of win) freq[w.batch_id] = (freq[w.batch_id] || 0) + 1;
    const dominant = Object.entries(freq).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    hits.push({
      type: 'abnormal_fanout',
      batch_id: dominant,
      discriminator: r.sender,
      severity: r.top.fanout >= 2 * threshold ? 'high' : 'medium',
      summary: `${r.sender} shipped to ${r.top.fanout} distinct receivers within ${windowHours} h (threshold ${threshold.toFixed(2)})`,
      details: {
        sender: r.sender, sender_name: r.sender_name, sender_type: typeOf(r.sender_labels),
        distinct_receivers: r.top.fanout, window_start: win[0].dispatch_timestamp, window_end: win[win.length - 1].dispatch_timestamp,
        window_hours: windowHours, baseline_per_sender_day: baseline, threshold, multiplier,
        batches_in_window: freq, shipments: win,
      },
    });
  }
  return { hits, baseline, threshold, next_highest_sender_fanout: nextHighest };
}

let inflight = null;

/** Run all five detectors and upsert the results. Concurrent callers share one run. */
function runDetection(opts = {}) {
  if (!inflight) {
    inflight = doRun(opts).finally(() => { inflight = null; });
  }
  return inflight;
}

async function doRun({ trigger = 'manual' } = {}) {
  const a = config.anomaly;
  const t0 = Date.now();
  const timings = {};

  const gap = await timed(detectProvenanceGap);
  timings.provenance_gap = gap.ms;
  const gapIds = gap.result.flatMap((x) => x.details.shipments.map((s) => s.shipment_id));

  const multi = await timed(detectMultiManufacturer);
  timings.multi_manufacturer_batch = multi.ms;
  const fanin = await timed(() => detectFanIn(a.fanInWindowHours));
  timings.duplicate_batch_fanin = fanin.ms;
  const reent = await timed(() => detectReentrant(a.fanInWindowHours, gapIds));
  timings.reentrant_distribution = reent.ms;
  const fanout = await timed(() => detectFanOut({ windowHours: a.fanOutWindowHours, multiplier: a.fanOutMultiplier, minThreshold: a.fanOutMinThreshold }));
  timings.abnormal_fanout = fanout.ms;

  const findings = [...multi.result, ...fanin.result, ...fanout.result.hits, ...reent.result, ...gap.result];
  const now = new Date();
  let inserted = 0;
  if (findings.length) {
    const res = await Anomaly.bulkWrite(findings.map((f) => ({
      updateOne: {
        filter: { _id: anomalyId(f.type, f.batch_id, f.discriminator) },
        update: {
          $set: { type: f.type, batch_id: f.batch_id, discriminator: f.discriminator, severity: f.severity, summary: f.summary, details: f.details, last_seen_at: now },
          $setOnInsert: { status: 'open', detected_at: now },
        },
        upsert: true,
      },
    })));
    inserted = res.upsertedCount;
  }
  const byType = {};
  for (const f of findings) byType[f.type] = (byType[f.type] || 0) + 1;
  return {
    trigger,
    ran_at: now,
    duration_ms: Date.now() - t0,
    detector_ms: timings,
    findings: findings.length,
    new_findings: inserted,
    by_type: byType,
    fanout: { baseline_per_sender_day: fanout.result.baseline, threshold: fanout.result.threshold, next_highest_sender_fanout: fanout.result.next_highest_sender_fanout },
    provenance_gap_shipments: gapIds.length,
    total_in_collection: await Anomaly.countDocuments(),
  };
}

module.exports = {
  runDetection, detectProvenanceGap, detectMultiManufacturer, detectFanIn, detectReentrant, detectFanOut, anomalyId,
};
