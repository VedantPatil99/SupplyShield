// Change-stream sync: a write to MongoDB must appear in Neo4j within 5 s (NFR), without the API touching Neo4j.
const { setup, teardown, sleep } = require('./helpers');
const { SyncService } = require('../src/services/sync');
const neo = require('../src/config/neo4j');
const { Shipment, Recall, Batch } = require('../src/models');

let ctx;
let sync;
const quiet = { info: () => {}, warn: () => {}, error: console.error };

beforeAll(async () => {
  ctx = await setup();
  sync = new SyncService(quiet);
  await sync.start();
});
afterAll(async () => {
  await sync.stop();
  await teardown();
});

async function waitFor(cypher, params, pred, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    const rows = await neo.read(cypher, params);
    if (pred(rows)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(50);
  }
}

describe('MongoDB -> Neo4j sync', () => {
  test('a shipment inserted directly into Mongo appears in Neo4j (with FROM/TO/PART_OF) within 5 s', async () => {
    const id = `SHIP-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`;
    await Shipment.create({
      _id: id, batch_id: 'BATCH-2026-5983C7', quantity: 1,
      from_entity: { entity_id: 'DIST-IN-00023', entity_type: 'distributor', city: 'Nagpur' },
      to_entity: { entity_id: 'WHS-IN-00019', entity_type: 'wholesaler', city: 'x' },
      dispatch_timestamp: new Date('2026-02-07T00:00:00Z'), status: 'dispatched',
    });
    const ms = await waitFor(
      `MATCH (b:Batch {batch_id: 'BATCH-2026-5983C7'})-[:PART_OF]->(s:Shipment {shipment_id: $id})-[:FROM]->(:Distributor {entity_id: 'DIST-IN-00023'}),
             (s)-[:TO]->(:Wholesaler {entity_id: 'WHS-IN-00019'}) RETURN s.status AS status`,
      { id }, (rows) => rows.length === 1,
    );
    expect(ms).not.toBeNull();
    expect(ms).toBeLessThan(5000);

    // status update propagates too
    await Shipment.updateOne({ _id: id }, { $set: { status: 'delivered' } });
    const ms2 = await waitFor('MATCH (s:Shipment {shipment_id: $id}) RETURN s.status AS status', { id }, (r) => r[0] && r[0].status === 'delivered');
    expect(ms2).not.toBeNull();
    await Shipment.deleteOne({ _id: id }); // tidy (deletes are not projected; remove the node directly)
    await neo.write('MATCH (s:Shipment {shipment_id: $id}) DETACH DELETE s', { id });
  });

  test('a batch registered through the API is projected with its PRODUCED edge', async () => {
    const res = await (await ctx.as('mfg_vertex')).post('/api/batches').send({
      product_name: 'Sync Test Tablets', product_code: 'SYNC-TAB', manufacture_date: '2026-08-10', expiry_date: '2027-08-10', quantity_produced: 100,
    });
    expect(res.status).toBe(201);
    const ms = await waitFor(
      'MATCH (:Manufacturer {entity_id: "MFG-IN-00004"})-[:PRODUCED]->(b:Batch {batch_id: $id}) RETURN b.status AS status',
      { id: res.body._id }, (r) => r.length === 1,
    );
    expect(ms).not.toBeNull();
  });

  test('recall status changes update NOTIFIED.status in Neo4j', async () => {
    const id = 'RECALL-2026-D7457A';
    const r = await Recall.findById(id).lean();
    const target = r.affected_entities.find((a) => a.status !== 'returned' && a.entity_id !== 'PHARM-IN-00042');
    if (!target) return; // already fully actioned by another test run
    const next = target.status === 'notified' ? 'acknowledged' : target.status === 'acknowledged' ? 'quarantined' : 'returned';
    const res = await (await ctx.as('admin')).patch(`/api/recalls/${id}/entities/${target.entity_id}`).send({ status: next });
    expect(res.status).toBe(200);
    const ms = await waitFor(
      'MATCH (:Recall {recall_id: $id})-[n:NOTIFIED]->({entity_id: $e}) RETURN n.status AS status',
      { id, e: target.entity_id }, (rows) => rows[0] && rows[0].status === next,
    );
    expect(ms).not.toBeNull();
  });

  test('sync stats record events and lag; Mongo and Neo4j counts match', async () => {
    expect(sync.stats.events_processed).toBeGreaterThan(0);
    expect(sync.stats.last_lag_ms).toBeLessThan(5000);
    await sleep(300);
    const res = await (await ctx.as('admin')).get('/api/admin/sync-health');
    expect(res.status).toBe(200);
    const byColl = Object.fromEntries(res.body.counts.map((c) => [c.collection, c]));
    expect(byColl.batches.mongo).toBe(await Batch.countDocuments());
    expect(byColl.batches.neo4j).toBe(byColl.batches.mongo);
    expect(byColl.entities.in_sync).toBe(true);
    expect(res.body.produced_edges.planted).toBe(1);
  });
});
