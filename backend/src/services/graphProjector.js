// Projects MongoDB documents into the Neo4j graph with idempotent MERGE statements.
// Used by both the change-stream sync (one doc at a time) and reconciliation (bulk, UNWIND batches).
// This module never deletes anything, so the planted second PRODUCED edge survives reconciliation.
const neo = require('../config/neo4j');
const { LABEL_BY_TYPE, TYPE_BY_LABEL } = require('../models/constants');

const CHUNK = 1000;

// Timestamps stay ISO strings in Neo4j (compare with datetime(...)); date-only fields stay YYYY-MM-DD.
function iso(d) {
  if (!d) return null;
  const s = (d instanceof Date ? d : new Date(d)).toISOString();
  return s.endsWith('.000Z') ? `${s.slice(0, -5)}Z` : s;
}
const isoDate = (d) => (d ? iso(d).slice(0, 10) : null);

function labelFor(entityType) {
  const label = LABEL_BY_TYPE[entityType];
  if (!label) throw new Error(`Unknown entity_type "${entityType}"`);
  return label;
}

// Recall affected_entities[].entity_type is an array of labels (["Pharmacy"]); validate against the whitelist.
function labelFromLabels(labels) {
  const arr = Array.isArray(labels) ? labels : [labels];
  const label = arr.find((l) => TYPE_BY_LABEL[l]) || arr.map((l) => LABEL_BY_TYPE[l]).find(Boolean);
  if (!label) throw new Error(`Unknown entity labels ${JSON.stringify(labels)}`);
  return label;
}

function chunks(arr, n = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

async function ensureConstraints() {
  const stmts = [
    ...Object.values(LABEL_BY_TYPE).map((l) => `CREATE CONSTRAINT ${l.toLowerCase()}_id IF NOT EXISTS FOR (n:${l}) REQUIRE n.entity_id IS UNIQUE`),
    'CREATE CONSTRAINT batch_id IF NOT EXISTS FOR (n:Batch) REQUIRE n.batch_id IS UNIQUE',
    'CREATE CONSTRAINT shipment_id IF NOT EXISTS FOR (n:Shipment) REQUIRE n.shipment_id IS UNIQUE',
    'CREATE CONSTRAINT recall_id IF NOT EXISTS FOR (n:Recall) REQUIRE n.recall_id IS UNIQUE',
  ];
  for (const s of stmts) await neo.run(s);
}

// ---------- entities ----------
async function projectEntities(docs) {
  const byType = groupBy(docs, (d) => d.entity_type);
  for (const [type, rows] of byType) {
    const label = labelFor(type);
    for (const part of chunks(rows)) {
      await neo.write(
        `UNWIND $rows AS row
         MERGE (n:${label} {entity_id: row.entity_id})
         SET n.name = row.name, n.city = row.city, n.country = row.country, n.license_number = row.license_number`,
        { rows: part.map((d) => ({ entity_id: d._id, name: d.name, city: d.city, country: d.country, license_number: d.license_number })) },
      );
    }
  }
}

// ---------- batches ----------
async function projectBatches(docs) {
  for (const part of chunks(docs)) {
    await neo.write(
      `UNWIND $rows AS row
       MERGE (b:Batch {batch_id: row.batch_id})
       SET b.product_name = row.product_name, b.manufacture_date = row.manufacture_date,
           b.expiry_date = row.expiry_date, b.status = row.status
       WITH b, row
       MATCH (m:Manufacturer {entity_id: row.manufacturer_id})
       MERGE (m)-[:PRODUCED]->(b)`,
      {
        rows: part.map((d) => ({
          batch_id: d._id,
          product_name: d.product_name,
          manufacture_date: isoDate(d.manufacture_date),
          expiry_date: isoDate(d.expiry_date),
          status: d.status,
          manufacturer_id: d.manufacturer_id,
        })),
      },
    );
  }
}

// ---------- shipments ----------
async function projectShipments(docs) {
  // Group by (sender label, receiver label) so every MATCH uses a labelled, indexed lookup.
  const byPair = groupBy(docs, (d) => `${labelFor(d.from_entity.entity_type)}|${labelFor(d.to_entity.entity_type)}`);
  for (const [pair, rows] of byPair) {
    const [fromLabel, toLabel] = pair.split('|');
    for (const part of chunks(rows)) {
      await neo.write(
        `UNWIND $rows AS row
         MERGE (b:Batch {batch_id: row.batch_id})
         MERGE (s:Shipment {shipment_id: row.shipment_id})
         SET s.dispatch_timestamp = row.dispatch_timestamp, s.quantity = row.quantity, s.status = row.status
         MERGE (b)-[:PART_OF]->(s)
         WITH s, row
         MATCH (sender:${fromLabel} {entity_id: row.from_id})
         MATCH (receiver:${toLabel} {entity_id: row.to_id})
         MERGE (s)-[:FROM]->(sender)
         MERGE (s)-[:TO]->(receiver)`,
        {
          rows: part.map((d) => ({
            shipment_id: d._id,
            batch_id: d.batch_id,
            dispatch_timestamp: iso(d.dispatch_timestamp),
            quantity: d.quantity,
            status: d.status,
            from_id: d.from_entity.entity_id,
            to_id: d.to_entity.entity_id,
          })),
        },
      );
    }
  }
}

// ---------- recalls ----------
async function projectRecalls(docs) {
  for (const part of chunks(docs, 200)) {
    await neo.write(
      `UNWIND $rows AS row
       MERGE (r:Recall {recall_id: row.recall_id})
       SET r.reason = row.reason, r.recall_class = row.recall_class, r.initiated_at = row.initiated_at, r.status = row.status
       WITH r, row
       UNWIND row.batch_ids AS bid
       MATCH (b:Batch {batch_id: bid})
       MERGE (r)-[:AFFECTS]->(b)`,
      {
        rows: part.map((d) => ({
          recall_id: d._id, reason: d.reason, recall_class: d.recall_class,
          initiated_at: iso(d.initiated_at), status: d.status, batch_ids: d.batch_ids,
        })),
      },
    );
  }
  const notified = docs.flatMap((d) => (d.affected_entities || []).map((a) => ({
    recall_id: d._id, entity_id: a.entity_id, status: a.status, updated_at: iso(a.updated_at), label: labelFromLabels(a.entity_type),
  })));
  for (const [label, rows] of groupBy(notified, (n) => n.label)) {
    for (const part of chunks(rows)) {
      await neo.write(
        `UNWIND $rows AS row
         MATCH (r:Recall {recall_id: row.recall_id})
         MATCH (e:${label} {entity_id: row.entity_id})
         MERGE (r)-[n:NOTIFIED]->(e)
         SET n.status = row.status, n.updated_at = row.updated_at`,
        { rows: part },
      );
    }
  }
}

const PROJECTORS = { entities: projectEntities, batches: projectBatches, shipments: projectShipments, recalls: projectRecalls };
const PROJECTED_COLLECTIONS = Object.keys(PROJECTORS);

async function projectDocs(collection, docs) {
  const fn = PROJECTORS[collection];
  if (!fn || !docs.length) return;
  await fn(docs);
}

/** Full idempotent re-projection of every synced collection (startup without a resume token, or seed). */
async function reconcileAll(db, log = console) {
  const t0 = Date.now();
  await ensureConstraints();
  const counts = {};
  // Order matters: entities before batches (PRODUCED), batches before shipments/recalls.
  for (const coll of ['entities', 'batches', 'shipments', 'recalls']) {
    const docs = await db.collection(coll).find({}).toArray();
    await projectDocs(coll, docs);
    counts[coll] = docs.length;
  }
  log.info(`[sync] reconciliation projected ${JSON.stringify(counts)} in ${Date.now() - t0} ms`);
  return counts;
}

/** Graph-side counts for the sync-health page. */
async function graphCounts() {
  const [row] = await neo.read(
    `CALL { MATCH (n) WHERE n:Manufacturer OR n:Distributor OR n:Wholesaler OR n:Pharmacy RETURN count(n) AS entities }
     CALL { MATCH (n:Batch) RETURN count(n) AS batches }
     CALL { MATCH (n:Shipment) RETURN count(n) AS shipments }
     CALL { MATCH (n:Recall) RETURN count(n) AS recalls }
     CALL { MATCH ()-[r:PRODUCED]->() RETURN count(r) AS produced }
     CALL { MATCH ()-[r:PRODUCED {planted: true}]->() RETURN count(r) AS produced_planted }
     RETURN entities, batches, shipments, recalls, produced, produced_planted`,
  );
  return row;
}

module.exports = {
  ensureConstraints, projectDocs, reconcileAll, graphCounts, PROJECTED_COLLECTIONS, iso, isoDate, labelFor, labelFromLabels,
};
