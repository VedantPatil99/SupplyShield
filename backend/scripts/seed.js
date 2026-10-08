#!/usr/bin/env node
// Seed MongoDB from data/ and project it into Neo4j through the same projector the sync service uses.
//   npm run seed            idempotent (upserts)
//   npm run seed -- --reset drops the collections and wipes Neo4j first
//   add --no-detect to skip the anomaly acceptance check at the end
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../src/config/env');
const { connectMongo, disconnectMongo, mongoose } = require('../src/config/mongo');
const neo = require('../src/config/neo4j');
const models = require('../src/models');
const projector = require('../src/services/graphProjector');
const { STATE_ID } = require('../src/services/sync');

const { Entity, Batch, Shipment, Inventory, Transaction, Recall, User, Anomaly, AuditLog, SyncState } = models;
const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset');
const DETECT = !args.has('--no-detect');
const quietLog = { info: () => {}, warn: console.warn, error: console.error };

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(config.dataDir, rel), 'utf8'));

// Fields converted from ISO strings to Date on import.
const DATE_FIELDS = {
  batches: ['manufacture_date', 'expiry_date', 'created_at', 'updated_at'],
  shipments: ['dispatch_timestamp', 'actual_arrival', 'created_at', 'updated_at'],
  inventory: ['last_updated'],
  transactions: ['timestamp'],
  recalls: ['initiated_at', 'updated_at'],
};

function toDates(doc, fields) {
  for (const f of fields) if (doc[f]) doc[f] = new Date(doc[f]);
  if (Array.isArray(doc.affected_entities)) {
    for (const a of doc.affected_entities) if (a.updated_at) a.updated_at = new Date(a.updated_at);
  }
  return doc;
}

// Users: the 6 from users_seed.json plus the 5 extra demo users decided in the handoff (section 5).
const EXTRA_USERS = [
  { username: 'mfg_meadow', password: 'Mfg@12345', role: 'manufacturer', entity_id: 'MFG-IN-00015', display_name: 'Meadow Pharma (manufacturer)' },
  { username: 'mfg_sunrise', password: 'Mfg@12345', role: 'manufacturer', entity_id: 'MFG-IN-00002', display_name: 'Sunrise Pharmaceuticals (manufacturer)' },
  { username: 'mfg_vertex', password: 'Mfg@12345', role: 'manufacturer', entity_id: 'MFG-IN-00004', display_name: 'Vertex Formulations (manufacturer)' },
  { username: 'pharm_recall', password: 'Pharm@12345', role: 'pharmacy', entity_id: 'PHARM-IN-00042', display_name: 'Pharmacy PHARM-IN-00042' },
  { username: 'pharm_suspect', password: 'Pharm@12345', role: 'pharmacy', entity_id: 'PHARM-IN-00004', display_name: 'Pharmacy PHARM-IN-00004' },
];

const PLANTED_EDGE = { manufacturer: 'MFG-IN-00013', batch: 'BATCH-2026-B64675', source: 'TXN-B1D5DB' };

// The generator draws 6-hex ids at random, and two collide in the raw data (SHIP-4C61D8 is two different
// shipments, TXN-71D4C6 two different transactions). Loaded naively, the second document overwrites the first,
// silently losing a shipment and creating a false provenance gap. Re-key every later duplicate to a
// deterministic fresh id and repoint transactions that reference a re-keyed shipment.
function dedupeIds(docs, label) {
  const seen = new Set(docs.map((d) => d._id));
  const first = new Set();
  const remaps = [];
  for (const d of docs) {
    if (!first.has(d._id)) { first.add(d._id); continue; }
    const prefix = d._id.slice(0, d._id.lastIndexOf('-'));
    let n = 0;
    let id;
    do {
      const hex = crypto.createHash('sha1').update(`${d._id}|${d.batch_id}|${n++}`).digest('hex').slice(0, 6).toUpperCase();
      id = `${prefix}-${hex}`;
    } while (seen.has(id));
    seen.add(id);
    remaps.push({ collection: label, old_id: d._id, new_id: id, batch_id: d.batch_id });
    d._id = id;
  }
  return remaps;
}

async function bulkUpsert(Model, docs) {
  // Raw driver bulk writes (ordered:false, 1000 per batch): fast, and idempotent via replaceOne+upsert.
  const coll = Model.collection;
  let n = 0;
  for (let i = 0; i < docs.length; i += 1000) {
    const part = docs.slice(i, i + 1000);
    await coll.bulkWrite(part.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
    n += part.length;
  }
  return n;
}

async function main() {
  const t0 = Date.now();
  await connectMongo(config.mongoUri, { attempts: 10, log: console });
  await neo.connectNeo4j({ attempts: 10, log: console });
  console.log(`Connected. Mongo=${config.mongoUri}  Neo4j=${config.neo4jUri}`);

  // 1. reset
  if (RESET) {
    const existing = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
    for (const name of existing) await mongoose.connection.db.dropCollection(name);
    await neo.run('MATCH (n) CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS');
    console.log(`Reset: dropped ${existing.length} Mongo collections, wiped Neo4j`);
  }

  // 3 (first, so unique indexes guard the inserts). syncIndexes also creates the collections.
  for (const M of Object.values(models)) await M.syncIndexes();

  // 2. load JSON
  const entities = readJson('reference/entities.json').map((e) => ({
    _id: e.entity_id, name: e.name, entity_type: e.entity_type, city: e.city, country: e.country, license_number: e.license_number,
  }));
  const counts = { entities: await bulkUpsert(Entity, entities) };
  const files = { batches: Batch, shipments: Shipment, inventory: Inventory, transactions: Transaction, recalls: Recall };
  const loaded = {};
  for (const name of Object.keys(files)) loaded[name] = readJson(`mongodb/${name}.json`).map((d) => toDates(d, DATE_FIELDS[name]));
  const remaps = [...dedupeIds(loaded.shipments, 'shipments'), ...dedupeIds(loaded.transactions, 'transactions')];
  for (const r of remaps.filter((x) => x.collection === 'shipments')) {
    for (const t of loaded.transactions) if (t.shipment_id === r.old_id && t.batch_id === r.batch_id) t.shipment_id = r.new_id;
  }
  for (const r of remaps) console.log(`Re-keyed duplicate id in ${r.collection}: ${r.old_id} (batch ${r.batch_id}) -> ${r.new_id}`);
  for (const [name, Model] of Object.entries(files)) counts[name] = await bulkUpsert(Model, loaded[name]);
  console.log('Loaded into Mongo:', counts);

  // 4. users (bcrypt, cost 10). Upsert by username so re-seeding resets demo passwords.
  const seedUsers = readJson('mongodb/users_seed.json');
  for (const u of [...seedUsers, ...EXTRA_USERS]) {
    await User.updateOne(
      { username: u.username },
      { $set: { password_hash: await User.hashPassword(u.password), role: u.role, entity_id: u.entity_id || null, display_name: u.display_name } },
      { upsert: true },
    );
  }

  // 5. normalise recall + inventory statuses (raw data is inconsistent; see README "Seed-time data corrections")
  let recallsChanged = 0;
  let inventoryChanged = 0;
  for (const r of await Recall.find({}).lean()) {
    const status = r.affected_entities.length && r.affected_entities.every((a) => a.status === 'returned') ? 'completed' : 'in_progress';
    if (status !== r.status) {
      await Recall.updateOne({ _id: r._id }, { $set: { status } });
      recallsChanged++;
    }
    for (const a of r.affected_entities) {
      const invStatus = a.status === 'returned' ? 'returned' : a.status === 'quarantined' ? 'quarantined' : 'none';
      const res = await Inventory.updateMany(
        { entity_id: a.entity_id, batch_id: { $in: r.batch_ids }, recall_status: { $ne: invStatus } },
        { $set: { recall_status: invStatus } },
      );
      inventoryChanged += res.modifiedCount;
    }
  }
  console.log(`Normalised statuses: ${recallsChanged} recall(s) changed, ${inventoryChanged} inventory row(s) changed`);

  // 6. Neo4j: constraints + projection through the sync projector (exercises the real pipeline code)
  await projector.reconcileAll(mongoose.connection.db, quietLog);
  // The planted second PRODUCED edge exists only in neo4j/batches.csv (Mongo _id uniqueness forbids a second batch
  // doc), so the Mongo->Neo4j sync can never produce it. Inject it explicitly; the projector never deletes it.
  await neo.write(
    `MATCH (m:Manufacturer {entity_id: $m}), (b:Batch {batch_id: $b})
     MERGE (m)-[p:PRODUCED]->(b) SET p.planted = true, p.source = $source`,
    { m: PLANTED_EDGE.manufacturer, b: PLANTED_EDGE.batch, source: PLANTED_EDGE.source },
  );
  // Reset the sync state so the running server reconciles once and starts a fresh change stream.
  await SyncState.deleteOne({ _id: STATE_ID });

  // 7. verify counts
  const expected = {
    mongo: { entities: 135, batches: 500, shipments: 2598, inventory: 2591, transactions: 2599, recalls: 10, users: 11 },
    neo4j: { entities: 135, batches: 500, shipments: 2598, recalls: 10, produced: 501 },
  };
  const actualMongo = {
    entities: await Entity.countDocuments(), batches: await Batch.countDocuments(), shipments: await Shipment.countDocuments(),
    inventory: await Inventory.countDocuments(), transactions: await Transaction.countDocuments(), recalls: await Recall.countDocuments(),
    users: await User.countDocuments(),
  };
  const g = await projector.graphCounts();
  const actualNeo = { entities: g.entities, batches: g.batches, shipments: g.shipments, recalls: g.recalls, produced: g.produced };
  let ok = true;
  console.log('\nCount verification (expected vs actual):');
  for (const [store, exp] of Object.entries(expected)) {
    const act = store === 'mongo' ? actualMongo : actualNeo;
    for (const [k, v] of Object.entries(exp)) {
      const pass = act[k] === v;
      ok = ok && pass;
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${store}.${k}: expected ${v}, got ${act[k]}`);
    }
  }
  if (!RESET) console.log('  (not a --reset run: counts include anything created through the app since the last reset)');

  // 8. anomaly acceptance check
  if (DETECT) {
    const { runDetection } = require('../src/services/anomaly');
    const summary = await runDetection({ trigger: 'seed' });
    const EXPECTED = [
      ['multi_manufacturer_batch', 'BATCH-2026-B64675', 'MFG-IN-00013,MFG-IN-00015'],
      ['duplicate_batch_fanin', 'BATCH-2025-A7B41D', 'WHS-IN-00009'],
      ['abnormal_fanout', 'BATCH-2026-F14542', 'DIST-IN-00001'],
      ['reentrant_distribution', 'BATCH-2025-0B0618', 'PHARM-IN-00004'],
      ['provenance_gap', 'BATCH-2025-A7B41D', 'DIST-IN-00002'],
      ['provenance_gap', 'BATCH-2025-A7B41D', 'DIST-IN-00003'],
      ['provenance_gap', 'BATCH-2026-F14542', 'DIST-IN-00001'],
      ['provenance_gap', 'BATCH-2025-0B0618', 'WHS-IN-00028'],
      ['provenance_gap', 'BATCH-2025-0B0618', 'WHS-IN-00033'],
    ];
    console.log(`\nAnomaly detection (${summary.duration_ms} ms, fan-out baseline ${summary.fanout.baseline_per_sender_day.toFixed(2)}/sender/day, threshold ${summary.fanout.threshold.toFixed(2)}, next-highest sender ${summary.fanout.next_highest_sender_fanout}):`);
    for (const [type, batch, disc] of EXPECTED) {
      const doc = await Anomaly.findOne({ type, batch_id: batch, discriminator: disc }).lean();
      ok = ok && !!doc;
      console.log(`  ${doc ? 'PASS' : 'FAIL'}  ${type} ${batch} [${disc}]${doc ? ` severity=${doc.severity}` : ''}`);
    }
    const total = await Anomaly.countDocuments();
    const totalOk = !RESET || total === EXPECTED.length;
    ok = ok && totalOk;
    console.log(`  ${totalOk ? 'PASS' : 'FAIL'}  total anomaly docs: ${total} (expected ${EXPECTED.length} after --reset)`);
  }

  console.log(`\nSeed ${ok ? 'completed: all checks PASS' : 'completed with FAILURES'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await neo.closeNeo4j();
  await disconnectMongo();
  process.exit(ok ? 0 : 2);
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  try { await neo.closeNeo4j(); await disconnectMongo(); } catch (_) { /* ignore */ }
  process.exit(1);
});

module.exports = { EXTRA_USERS };
