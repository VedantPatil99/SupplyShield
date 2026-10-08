const { setup, teardown } = require('./helpers');
const { Batch, Inventory, Recall, Transaction } = require('../src/models');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(teardown);

describe('seed-time recall normalisation', () => {
  test('all 10 seeded recalls are in_progress (no recall has every entity returned)', async () => {
    const seeded = await Recall.find({ _id: { $in: require('../../data/mongodb/recalls.json').map((r) => r._id) } }).lean();
    expect(seeded).toHaveLength(10);
    // pharm_recall's own actions in other tests may complete RECALL-2026-D7457A; check the rest
    expect(seeded.filter((r) => r._id !== 'RECALL-2026-D7457A').every((r) => r.status === 'in_progress')).toBe(true);
  });
});

describe('FR-6 initiate a recall', () => {
  test('affected entities equal the forward-trace recipient set; batch becomes recalled', async () => {
    const batchId = 'BATCH-2026-5983C7';
    const mfg = await ctx.as('mfg_aarav');
    // MFG-IN-00001 does not own this batch (MFG-IN-00007 does)
    expect((await mfg.post('/api/recalls').send({ batch_ids: [batchId], reason: 'x', recall_class: 'Class II' })).status).toBe(403);

    const reg = await ctx.as('regulator1');
    const trace = await reg.get(`/api/trace/forward/${batchId}`);
    const recipients = trace.body.recipients.map((r) => r.entity_id).sort();

    const preview = await reg.post('/api/recalls/preview').send({ batch_ids: [batchId] });
    expect(preview.status).toBe(200);
    expect(preview.body.affected.map((a) => a.entity_id).sort()).toEqual(recipients);

    const res = await reg.post('/api/recalls').send({ batch_ids: [batchId], reason: 'Test: dissolution failure', recall_class: 'Class I' });
    expect(res.status).toBe(201);
    expect(res.body._id).toMatch(/^RECALL-\d{4}-[0-9A-F]{6}$/);
    expect(res.body.status).toBe('in_progress');
    expect(res.body.affected_entities.map((a) => a.entity_id).sort()).toEqual(recipients);
    expect(res.body.affected_entities.every((a) => a.status === 'notified')).toBe(true);
    expect(res.body.affected_entities.every((a) => Array.isArray(a.entity_type))).toBe(true);
    expect((await Batch.findById(batchId).lean()).status).toBe('recalled');
    expect(await Transaction.countDocuments({ type: 'recall_action', recall_id: res.body._id })).toBe(1);

    // a second open recall on the same batch is refused
    expect((await reg.post('/api/recalls').send({ batch_ids: [batchId], reason: 'dup', recall_class: 'Class II' })).status).toBe(409);
  });

  test('a recalled batch cannot be shipped (409)', async () => {
    const res = await (await ctx.as('admin')).post('/api/shipments')
      .send({ from_entity_id: 'DIST-IN-00023', batch_id: 'BATCH-2026-5983C7', to_entity_id: 'WHS-IN-00001', quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/recalled/);
  });

  test('a manufacturer recalls its own batch (mfg_meadow, planted batch A7B41D)', async () => {
    const res = await (await ctx.as('mfg_meadow')).post('/api/recalls')
      .send({ batch_ids: ['BATCH-2025-A7B41D'], reason: 'Suspected counterfeit units in circulation', recall_class: 'Class I' });
    expect(res.status).toBe(201);
    expect(res.body.affected_entities.map((a) => a.entity_id)).toEqual(expect.arrayContaining(['WHS-IN-00009']));
  });
});

describe('FR-7 recall status tracking', () => {
  test('pharm_recall acknowledges -> quarantines -> returns on RECALL-2026-D7457A', async () => {
    const id = 'RECALL-2026-D7457A';
    const ph = await ctx.as('pharm_recall');
    const before = await ph.get(`/api/recalls/${id}`);
    expect(before.status).toBe(200);
    expect(before.body.affected_entities).toHaveLength(1); // a pharmacy sees only its own row
    expect(before.body.affected_entities[0]).toMatchObject({ entity_id: 'PHARM-IN-00042', status: 'notified' });

    const alerts = await ph.get('/api/alerts');
    expect(alerts.body.items.some((a) => a.recall_id === id)).toBe(true);

    // cannot act for another entity, cannot skip backwards
    expect((await ph.patch(`/api/recalls/${id}/entities/PHARM-IN-00038`).send({ status: 'returned' })).status).toBe(403);

    for (const status of ['acknowledged', 'quarantined', 'returned']) {
      const r = await ph.patch(`/api/recalls/${id}/entities/PHARM-IN-00042`).send({ status });
      expect(r.status).toBe(200);
      const inv = await Inventory.findOne({ entity_id: 'PHARM-IN-00042', batch_id: 'BATCH-2026-00A6CD' }).lean();
      if (status !== 'acknowledged') expect(inv.recall_status).toBe(status);
    }
    expect((await ph.patch(`/api/recalls/${id}/entities/PHARM-IN-00042`).send({ status: 'acknowledged' })).status).toBe(409);

    // regulator sees progress move
    const reg = await (await ctx.as('regulator1')).get(`/api/recalls/${id}`);
    expect(reg.body.affected_entities.find((a) => a.entity_id === 'PHARM-IN-00042').status).toBe('returned');
    expect(reg.body.progress.by_status.returned).toBeGreaterThanOrEqual(5);
  });

  test('recall auto-completes when every affected entity has returned stock', async () => {
    const reg = await ctx.as('regulator1');
    const created = await reg.post('/api/recalls').send({ batch_ids: ['BATCH-2026-B20ABC'], reason: 'Test completion', recall_class: 'Class III' });
    expect(created.status).toBe(201);
    const admin = await ctx.as('admin');
    let last;
    for (const a of created.body.affected_entities) {
      last = await admin.patch(`/api/recalls/${created.body._id}/entities/${a.entity_id}`).send({ status: 'returned' });
      expect(last.status).toBe(200);
    }
    expect(last.body.status).toBe('completed');
    expect(last.body.progress.returned_pct).toBe(100);
  });
});
