const { setup, teardown, PLANTED_BATCHES } = require('./helpers');
const { Batch, Shipment, Inventory, Transaction } = require('../src/models');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(teardown);

const newBatch = (over = {}) => ({
  product_name: 'Test Amoxicillin 250mg Capsules', product_code: 'AMOX250-CAP', manufacture_date: '2026-08-01',
  expiry_date: '2028-08-01', quantity_produced: 5000, ...over,
});

const qty = async (entityId, batchId) => {
  const inv = await Inventory.findOne({ entity_id: entityId, batch_id: batchId }).lean();
  return inv ? inv.quantity_on_hand : 0;
};

describe('FR-1 register batch', () => {
  test('manufacturer registers a batch; manufacturer_id is forced from the JWT', async () => {
    const mfg = await ctx.as('mfg_aarav');
    const res = await mfg.post('/api/batches').send(newBatch({ manufacturer_id: 'MFG-IN-00009' }));
    expect(res.status).toBe(201);
    expect(res.body._id).toMatch(/^BATCH-2026-[0-9A-F]{6}$/);
    expect(res.body.manufacturer_id).toBe('MFG-IN-00001');
    expect(res.body.status).toBe('active');
    expect(await qty('MFG-IN-00001', res.body._id)).toBe(5000); // opening stock
  });

  test('validation errors -> 422', async () => {
    const mfg = await ctx.as('mfg_aarav');
    expect((await mfg.post('/api/batches').send(newBatch({ quantity_produced: -5 }))).status).toBe(422);
    expect((await mfg.post('/api/batches').send(newBatch({ expiry_date: '2025-01-01' }))).status).toBe(422);
    expect((await mfg.post('/api/batches').send(newBatch({ product_name: '' }))).status).toBe(422);
    expect((await mfg.post('/api/batches').send(newBatch({ manufacture_date: 'yesterday' }))).status).toBe(422);
  });

  test('non-manufacturers cannot register batches', async () => {
    expect((await (await ctx.as('dist_national')).post('/api/batches').send(newBatch())).status).toBe(403);
    expect((await (await ctx.as('regulator1')).post('/api/batches').send(newBatch())).status).toBe(403);
  });

  test('batch list is scoped: a manufacturer sees only its own batches', async () => {
    const res = await (await ctx.as('mfg_meadow')).get('/api/batches?limit=500');
    expect(res.status).toBe(200);
    expect(res.body.items.every((b) => b.manufacturer_id === 'MFG-IN-00015')).toBe(true);
    expect(res.body.items.map((b) => b._id)).toEqual(expect.arrayContaining(['BATCH-2026-B64675', 'BATCH-2025-A7B41D', 'BATCH-2025-0B0618']));
  });

  test('expired batches are flagged at read time (APP_NOW), not rewritten', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/batches/BATCH-2025-A599C3');
    expect(res.status).toBe(200);
    expect(res.body.is_expired).toBe(true);
    expect(res.body.status).toBe('active');
  });
});

describe('FR-2 / FR-3 ship and receive with inventory conservation', () => {
  let batchId;
  beforeAll(async () => {
    const res = await (await ctx.as('mfg_aarav')).post('/api/batches').send(newBatch({ quantity_produced: 10000 }));
    batchId = res.body._id;
  });

  test('manufacturer -> distributor -> wholesaler -> pharmacy, conserving stock at every hop', async () => {
    const mfg = await ctx.as('mfg_aarav');
    const dist = await ctx.as('dist_national');
    const whs = await ctx.as('whs_city');
    const pharm = await ctx.as('pharm_healthplus');

    // hop 1
    let s = await mfg.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'DIST-IN-00001', quantity: 6000 });
    expect(s.status).toBe(201);
    expect(s.body.status).toBe('dispatched');
    expect(await qty('MFG-IN-00001', batchId)).toBe(4000);
    expect(await qty('DIST-IN-00001', batchId)).toBe(0); // not received yet
    // only the receiver can confirm
    expect((await whs.patch(`/api/shipments/${s.body._id}/receive`)).status).toBe(403);
    let r = await dist.patch(`/api/shipments/${s.body._id}/receive`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('delivered');
    expect(r.body.actual_arrival).toBeTruthy();
    expect(await qty('DIST-IN-00001', batchId)).toBe(6000);
    expect((await dist.patch(`/api/shipments/${s.body._id}/receive`)).status).toBe(409); // idempotency guard

    // hop 2
    s = await dist.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'WHS-IN-00001', quantity: 2500 });
    expect(s.status).toBe(201);
    r = await whs.patch(`/api/shipments/${s.body._id}/receive`);
    expect(r.status).toBe(200);
    expect(await qty('DIST-IN-00001', batchId)).toBe(3500);
    expect(await qty('WHS-IN-00001', batchId)).toBe(2500);

    // hop 3
    s = await whs.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'PHARM-IN-00001', quantity: 1000 });
    expect(s.status).toBe(201);
    r = await pharm.patch(`/api/shipments/${s.body._id}/receive`);
    expect(r.status).toBe(200);
    expect(await qty('WHS-IN-00001', batchId)).toBe(1500);
    expect(await qty('PHARM-IN-00001', batchId)).toBe(1000);

    // total conserved
    const all = await Inventory.find({ batch_id: batchId }).lean();
    expect(all.reduce((n, i) => n + i.quantity_on_hand, 0)).toBe(10000);

    // each receipt wrote an ownership_transfer
    expect(await Transaction.countDocuments({ batch_id: batchId, type: 'ownership_transfer' })).toBe(3);
  });

  test('shipment validation: insufficient stock, wrong direction, unknown receiver, bad quantity', async () => {
    const mfg = await ctx.as('mfg_aarav');
    const dist = await ctx.as('dist_national');
    expect((await mfg.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'DIST-IN-00002', quantity: 999999 })).status).toBe(422);
    expect((await dist.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'MFG-IN-00002', quantity: 1 })).status).toBe(422);
    expect((await mfg.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'DIST-IN-99999', quantity: 1 })).status).toBe(422);
    expect((await mfg.post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'DIST-IN-00002', quantity: 0 })).status).toBe(422);
    expect((await mfg.post('/api/shipments').send({ batch_id: 'BATCH-2026-FFFFFF', to_entity_id: 'DIST-IN-00002', quantity: 1 })).status).toBe(404);
    // a sender with no stock of the batch
    expect((await (await ctx.as('whs_city')).post('/api/shipments').send({ batch_id: 'BATCH-2026-5983C7', to_entity_id: 'PHARM-IN-00001', quantity: 1 })).status).toBe(422);
    // pharmacies cannot ship
    expect((await (await ctx.as('pharm_healthplus')).post('/api/shipments').send({ batch_id: batchId, to_entity_id: 'PHARM-IN-00002', quantity: 1 })).status).toBe(403);
  });
});

describe('seeded data: inventory conservation (planted batches excluded by design)', () => {
  test('for every non-planted batch, received - shipped = on hand at every holder, and producers ship exactly what they made', async () => {
    const batches = await Batch.find({ _id: { $nin: PLANTED_BATCHES }, created_at: { $lt: new Date('2026-09-01') } }).lean();
    const ids = batches.map((b) => b._id);
    const ships = await Shipment.find({ batch_id: { $in: ids } }).lean();
    const inv = await Inventory.find({ batch_id: { $in: ids } }).lean();
    const flow = new Map();
    const key = (e, b) => `${e}|${b}`;
    for (const s of ships) {
      flow.set(key(s.to_entity.entity_id, s.batch_id), (flow.get(key(s.to_entity.entity_id, s.batch_id)) || 0) + s.quantity);
      flow.set(key(s.from_entity.entity_id, s.batch_id), (flow.get(key(s.from_entity.entity_id, s.batch_id)) || 0) - s.quantity);
    }
    const mismatches = [];
    for (const i of inv) {
      const expected = flow.get(key(i.entity_id, i.batch_id)) || 0;
      if (expected !== i.quantity_on_hand) mismatches.push(`${i._id}: on hand ${i.quantity_on_hand}, flow ${expected}`);
    }
    for (const b of batches) {
      const shipped = -(flow.get(key(b.manufacturer_id, b._id)) || 0);
      if (shipped !== b.quantity_produced) mismatches.push(`${b._id}: produced ${b.quantity_produced}, shipped ${shipped}`);
    }
    expect(mismatches).toEqual([]);
  });
});
