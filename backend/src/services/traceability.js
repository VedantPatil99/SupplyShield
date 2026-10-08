// Forward / backward traceability over the Neo4j projection.
const neo = require('../config/neo4j');
const { TYPE_BY_LABEL } = require('../models/constants');

const MAX_HOPS = 10;

const typeOf = (labels) => TYPE_BY_LABEL[(labels || []).find((l) => TYPE_BY_LABEL[l])] || null;

/** Producers + every shipment edge of one batch, in dispatch order. Small per batch (tens of rows). */
async function batchGraph(batchId) {
  const rows = await neo.read(
    `MATCH (b:Batch {batch_id: $batchId})
     OPTIONAL MATCH (m:Manufacturer)-[p:PRODUCED]->(b)
     WITH b, collect(DISTINCT {entity_id: m.entity_id, name: m.name, planted: coalesce(p.planted, false)}) AS producers
     OPTIONAL MATCH (b)-[:PART_OF]->(s:Shipment)-[:FROM]->(a), (s)-[:TO]->(c)
     WITH b, producers, s, a, c ORDER BY s.dispatch_timestamp
     RETURN b {.batch_id, .product_name, .manufacture_date, .expiry_date, .status} AS batch, producers,
            collect(CASE WHEN s IS NULL THEN NULL ELSE {
              shipment_id: s.shipment_id, dispatch_timestamp: s.dispatch_timestamp, quantity: s.quantity, status: s.status,
              from_id: a.entity_id, from_name: a.name, from_labels: labels(a),
              to_id: c.entity_id, to_name: c.name, to_labels: labels(c)
            } END) AS edges`,
    { batchId },
  );
  if (!rows.length) return null;
  const { batch, producers, edges } = rows[0];
  return {
    batch,
    producers: producers.filter((p) => p.entity_id),
    edges: edges.filter(Boolean).map((e) => ({
      shipment_id: e.shipment_id,
      dispatch_timestamp: e.dispatch_timestamp,
      quantity: e.quantity,
      status: e.status,
      from: { entity_id: e.from_id, name: e.from_name, entity_type: typeOf(e.from_labels) },
      to: { entity_id: e.to_id, name: e.to_name, entity_type: typeOf(e.to_labels) },
    })),
  };
}

/** FR-4 forward trace: every movement of the batch and the distinct set of recipients. */
async function forwardTrace(batchId) {
  const t0 = process.hrtime.bigint();
  const g = await batchGraph(batchId);
  const query_ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!g) return null;
  const recipients = new Map();
  for (const e of g.edges) {
    if (!recipients.has(e.to.entity_id)) {
      recipients.set(e.to.entity_id, { ...e.to, first_received: e.dispatch_timestamp, shipments: 0, quantity: 0 });
    }
    const r = recipients.get(e.to.entity_id);
    r.shipments++;
    r.quantity += e.quantity || 0;
  }
  const depth = maxDepth(g);
  return { ...g, recipients: [...recipients.values()], hops: depth, query_ms: Math.round(query_ms * 100) / 100 };
}

function maxDepth(g) {
  const producerIds = new Set(g.producers.map((p) => p.entity_id));
  const out = new Map();
  for (const e of g.edges) {
    if (!out.has(e.from.entity_id)) out.set(e.from.entity_id, []);
    out.get(e.from.entity_id).push(e.to.entity_id);
  }
  let best = 0;
  const walk = (id, d, seen) => {
    best = Math.max(best, d);
    if (d >= MAX_HOPS) return;
    for (const nxt of out.get(id) || []) if (!seen.has(nxt)) walk(nxt, d + 1, new Set([...seen, nxt]));
  };
  for (const p of producerIds) walk(p, 0, new Set([p]));
  return best;
}

/**
 * FR-4 backward trace / authenticity check for one holder of a batch.
 * Every inbound shipment to the entity must chain back, hop by hop and in time order, to a producing
 * manufacturer within MAX_HOPS. A hop "A -> B" at time t is valid only if A produced the batch or
 * A itself received it in an earlier shipment. verified = at least one inbound shipment, every inbound
 * shipment has a complete chain, and exactly one manufacturer claims the batch.
 */
async function backwardTrace(batchId, entityId) {
  const t0 = process.hrtime.bigint();
  const g = await batchGraph(batchId);
  const query_ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!g) return null;

  const producerIds = new Set(g.producers.map((p) => p.entity_id));
  const inboundTo = new Map();
  for (const e of g.edges) {
    if (!inboundTo.has(e.to.entity_id)) inboundTo.set(e.to.entity_id, []);
    inboundTo.get(e.to.entity_id).push(e);
  }
  const ts = (e) => Date.parse(e.dispatch_timestamp);

  // Returns the chain [shipment edges from manufacturer ... to `edge`] or null.
  function chainFor(edge, depth, seen) {
    const sender = edge.from.entity_id;
    if (producerIds.has(sender)) return [edge];
    if (depth >= MAX_HOPS) return null;
    for (const prev of inboundTo.get(sender) || []) {
      if (ts(prev) >= ts(edge) || seen.has(prev.shipment_id)) continue;
      const sub = chainFor(prev, depth + 1, new Set([...seen, prev.shipment_id]));
      if (sub) return [...sub, edge];
    }
    return null;
  }

  const reasons = [];
  let chains = [];
  if (producerIds.has(entityId)) {
    chains = [{ shipment_id: null, verified: true, path: [], note: 'Entity is the producing manufacturer' }];
  } else {
    const inbound = inboundTo.get(entityId) || [];
    if (!inbound.length) reasons.push(`${entityId} has no recorded inbound shipment of ${batchId}`);
    chains = inbound.map((edge) => {
      const chain = chainFor(edge, 1, new Set([edge.shipment_id]));
      if (chain) {
        return { shipment_id: edge.shipment_id, verified: true, hops: chain.length, path: chain };
      }
      // Show how far back the chain goes before it breaks.
      const broken = [edge];
      let cur = edge;
      for (let i = 0; i < MAX_HOPS; i++) {
        const prev = (inboundTo.get(cur.from.entity_id) || []).find((p) => ts(p) < ts(cur));
        if (!prev) break;
        broken.unshift(prev);
        cur = prev;
      }
      const breakAt = broken[0].from;
      reasons.push(`${edge.shipment_id}: sender chain breaks at ${breakAt.entity_id} (${breakAt.name || 'unknown'}), which never produced or received ${batchId} before shipping it`);
      return { shipment_id: edge.shipment_id, verified: false, breaks_at: breakAt, path: broken };
    });
  }
  if (g.producers.length > 1) {
    reasons.push(`${g.producers.length} manufacturers claim to have produced ${batchId} (${g.producers.map((p) => p.entity_id).join(', ')}): conflicting provenance`);
  }
  if (!g.producers.length) reasons.push(`No manufacturer is recorded as producing ${batchId}`);

  const verified = chains.length > 0 && chains.every((c) => c.verified) && g.producers.length === 1;
  return {
    batch: g.batch,
    entity_id: entityId,
    producers: g.producers,
    verified,
    reasons,
    chains,
    query_ms: Math.round(query_ms * 100) / 100,
  };
}

/**
 * The part of a batch's movement one company is entitled to see: every shipment on the way to it
 * (where its stock came from) and every shipment onward from it (where it sent stock). Not its competitors' deliveries.
 */
function neighbourhood(edges, entityId) {
  const keep = new Set();
  // Breadth-first walk: from `start`, follow edges whose `near` end is the current company to their `far` end.
  const walk = (start, near, far) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const e of edges) {
        if (near(e) !== cur) continue;
        keep.add(e.shipment_id);
        if (!seen.has(far(e))) { seen.add(far(e)); queue.push(far(e)); }
      }
    }
  };
  walk(entityId, (e) => e.to.entity_id, (e) => e.from.entity_id); // upstream
  walk(entityId, (e) => e.from.entity_id, (e) => e.to.entity_id); // downstream
  return edges.filter((e) => keep.has(e.shipment_id));
}

/** Distinct downstream recipients of a set of batches (recall impact, before the Recall node exists). */
async function recipientsOfBatches(batchIds) {
  return neo.read(
    `MATCH (b:Batch)-[:PART_OF]->(s:Shipment)-[:TO]->(e)
     WHERE b.batch_id IN $batchIds
     WITH e, collect(DISTINCT b.batch_id) AS batches, count(s) AS shipments
     RETURN e.entity_id AS entity_id, e.name AS name, labels(e) AS entity_type, batches, shipments
     ORDER BY entity_id`,
    { batchIds },
  );
}

/** Recall impact via the Recall node (handoff section 8 query). */
async function recallImpact(recallId) {
  return neo.read(
    `MATCH (r:Recall {recall_id: $recallId})-[:AFFECTS]->(b:Batch)
     MATCH (b)-[:PART_OF]->(:Shipment)-[:TO]->(entity)
     RETURN DISTINCT entity.entity_id AS affected_entity, labels(entity) AS entity_type
     ORDER BY affected_entity`,
    { recallId },
  );
}

module.exports = { forwardTrace, backwardTrace, recipientsOfBatches, recallImpact, batchGraph, neighbourhood, MAX_HOPS };
