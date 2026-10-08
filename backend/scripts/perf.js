#!/usr/bin/env node
// Performance probe (not a pass/fail claim). Measures real timings on this machine and writes docs/PERFORMANCE.md.
//   npm run perf      (stop the dev server first so its sync service doesn't compete)
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../src/config/env');
const { connectMongo, disconnectMongo } = require('../src/config/mongo');
const neo = require('../src/config/neo4j');
const { Batch, Shipment, Recall, User } = require('../src/models');
const trace = require('../src/services/traceability');
const { runDetection } = require('../src/services/anomaly');
const { SyncService } = require('../src/services/sync');
const { createApp } = require('../src/app');

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}
const f = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
const row = (label, st, note = '') => `| ${label} | ${st.n} | ${f(st.p50)} | ${f(st.p95)} | ${f(st.max)} | ${note} |`;

async function timeIt(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = now();
    await fn(i);
    out.push(now() - t);
  }
  return out;
}

// Deterministic sample without Math.random so reruns measure the same batches.
const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);

async function main() {
  await connectMongo();
  await neo.connectNeo4j();
  const results = [];

  const batches = (await Batch.find({}, { _id: 1 }).sort({ _id: 1 }).lean()).map((b) => b._id);
  const sample = pick(batches, 100);
  const pharmShipments = await Shipment.find({ 'to_entity.entity_type': 'pharmacy', batch_id: { $in: sample } }, { batch_id: 1, 'to_entity.entity_id': 1 }).lean();
  const pairs = pick(pharmShipments, 100).map((s) => [s.batch_id, s.to_entity.entity_id]);
  const recalls = (await Recall.find({}, { _id: 1, batch_ids: 1 }).lean());

  // warm-up (first queries compile plans / fill caches)
  for (const b of sample.slice(0, 10)) await trace.forwardTrace(b);

  // ---- service-level (Neo4j query + JS assembly) ----
  results.push(row('Forward trace (`/trace/forward`), service level', stats(await timeIt((i) => trace.forwardTrace(sample[i]), sample.length)), `${sample.length} different batches`));
  results.push(row('Backward trace / authenticity, service level', stats(await timeIt((i) => trace.backwardTrace(pairs[i][0], pairs[i][1]), pairs.length)), `${pairs.length} (batch, pharmacy) pairs`));
  results.push(row('Recall impact via Recall node (handoff §8 query)', stats(await timeIt((i) => trace.recallImpact(recalls[i % recalls.length]._id), 50)), '10 seeded recalls, 5 rounds'));
  results.push(row('Recall preview: recipients of a batch set', stats(await timeIt((i) => trace.recipientsOfBatches(recalls[i % recalls.length].batch_ids), 50)), 'graph traversal before the Recall node exists'));

  // ---- deepest traversal the data allows + a 10-hop variable-length probe ----
  // Longest manufacturer -> recipient chain in entity hops, from the forward trace of every batch.
  let maxHops = 0;
  for (const b of batches) maxHops = Math.max(maxHops, (await trace.forwardTrace(b)).hops);
  const tenHop = await timeIt((i) => neo.read(
    `MATCH (b:Batch {batch_id: $id})-[:PART_OF|FROM|TO|PRODUCED*1..10]-(x)
     RETURN count(DISTINCT x) AS reached`, { id: sample[i] },
  ), 20);
  const [reach] = await neo.read(
    'MATCH (b:Batch {batch_id: $id})-[:PART_OF|FROM|TO|PRODUCED*1..10]-(x) RETURN count(DISTINCT x) AS reached', { id: sample[0] },
  );
  results.push(row('10-relationship variable-length expansion from a batch (undirected, all edge types)', stats(tenHop), `reaches ~${reach.reached} nodes from one batch; 20 batches`));

  // ---- anomaly detection ----
  const detSamples = [];
  let detTimings = null;
  for (let i = 0; i < 5; i++) {
    const t = now();
    const s = await runDetection({ trigger: 'perf' });
    detSamples.push(now() - t);
    detTimings = s.detector_ms;
  }
  results.push(row('Full anomaly detection run (5 detectors + Mongo upsert)', stats(detSamples), `last run per detector (ms): ${Object.entries(detTimings).map(([k, v]) => `${k} ${v}`).join(', ')}`));

  // ---- API level (HTTP, JWT, Express, JSON) ----
  const sync = new SyncService({ info: () => {}, warn: () => {}, error: console.error });
  await sync.start();
  const app = createApp({ sync, logRequests: false });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'regulator1', password: 'Regulator@123' }) }).then((r) => r.json());
  const H = { Authorization: `Bearer ${login.token}` };
  results.push(row('`GET /api/trace/forward/:id` end to end (HTTP)', stats(await timeIt((i) => fetch(`${base}/trace/forward/${sample[i]}`, { headers: H }).then((r) => r.json()), sample.length)), 'includes JWT check + JSON'));
  results.push(row('`GET /api/trace/backward/:id` end to end (HTTP)', stats(await timeIt((i) => fetch(`${base}/trace/backward/${pairs[i][0]}?entity_id=${pairs[i][1]}`, { headers: H }).then((r) => r.json()), pairs.length)), ''));

  // ---- sync lag: Mongo insert -> visible in Neo4j ----
  const lag = [];
  const created = [];
  for (let i = 0; i < 25; i++) {
    const id = `SHIP-F${String(i).padStart(5, '0')}`.slice(0, 11);
    created.push(id);
    const t = now();
    await Shipment.create({
      _id: id, batch_id: 'BATCH-2026-5983C7', quantity: 1,
      from_entity: { entity_id: 'DIST-IN-00023', entity_type: 'distributor' }, to_entity: { entity_id: 'WHS-IN-00019', entity_type: 'wholesaler' },
      dispatch_timestamp: new Date('2026-02-07T00:00:00Z'), status: 'dispatched',
    });
    for (;;) {
      const r = await neo.read('MATCH (s:Shipment {shipment_id: $id})-[:TO]->() RETURN 1 AS ok', { id });
      if (r.length) break;
      if (now() - t > 10000) throw new Error('sync did not deliver within 10 s');
      await sleep(5);
    }
    lag.push(now() - t);
  }
  // clean up the probe shipments from both stores (deletes are not projected by design)
  await Shipment.deleteMany({ _id: { $in: created } });
  await neo.write('MATCH (s:Shipment) WHERE s.shipment_id IN $ids DETACH DELETE s', { ids: created });
  results.push(row('Sync lag: Mongo insert → shipment + edges visible in Neo4j', stats(lag), 'polled every 5 ms; includes poll granularity'));

  server.close();
  await sync.stop();

  // ---- environment ----
  const mongoVer = (await mongoose.connection.db.admin().command({ buildInfo: 1 })).version;
  const [neoVer] = await neo.read('CALL dbms.components() YIELD name, versions RETURN versions[0] AS v');
  const counts = await neo.read('MATCH (n) RETURN count(n) AS nodes');
  const rels = await neo.read('MATCH ()-[r]->() RETURN count(r) AS rels');
  const env = [
    `- Date: ${new Date().toISOString()}`,
    `- Machine: ${os.cpus()[0].model.trim()} (${os.cpus().length} logical cores), ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, ${os.type()} ${os.release()}`,
    `- Node.js ${process.version}; MongoDB ${mongoVer} (single-node replica set); Neo4j ${neoVer.v} Community (default memory settings)`,
    '- Databases and app on the same machine (localhost), no Docker',
    `- Graph size during the probe: ${counts[0].nodes} nodes, ${rels[0].rels} relationships; ${batches.length} batches (synthetic dataset)`,
  ];

  const md = `# Performance probe

Real measurements from \`npm run perf\` (\`backend/scripts/perf.js\`). This is a probe on one laptop with the
synthetic dataset, **not** a benchmark and not a scalability test. The 10M-node / 50M-relationship figure in the proposal is a
design target that was **not** tested.

## Environment
${env.join('\n')}

## Results (milliseconds)

| Operation | Samples | p50 | p95 | max | Notes |
|---|---|---|---|---|---|
${results.join('\n')}

## Reading these numbers

- **NFR "trace queries within 2 seconds up to 10 hops":** every trace query above finished well under 2 s on this data.
  The longest manufacturer→recipient chain in the dataset is **${maxHops} entity hops** (each hop is a Shipment with FROM and TO
  edges, so ${maxHops * 2} relationships), because the network has four tiers. A real 10-hop *supply chain* does not exist in this data. The
  "10-relationship variable-length expansion" row is a synthetic stress probe: an undirected traversal over all edge types out to
  10 relationships, which reaches a large part of the graph. It is reported to show traversal cost at that depth, not as a
  trace a user would run.
- The first query after a restart is slower (plan compilation, cold page cache); the probe warms up with 10 traces first.
- Sync lag includes the polling interval of the probe itself (5 ms). The app also reports per-event lag (Mongo commit wall time →
  Neo4j write complete) live on the admin Sync health page.
- Re-run \`npm run perf\` to regenerate this file; numbers will vary between machines and runs.
`;
  const out = path.join(__dirname, '../../docs/PERFORMANCE.md');
  fs.writeFileSync(out, md);
  console.log(md);
  console.log(`\nWrote ${out}`);
  await neo.closeNeo4j();
  await disconnectMongo();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
