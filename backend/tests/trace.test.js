const { setup, teardown } = require('./helpers');
const { Shipment } = require('../src/models');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(teardown);

describe('FR-4 forward trace', () => {
  test('returns every shipment of the batch and its distinct recipients (matches Mongo)', async () => {
    const batchId = 'BATCH-2025-0B0618';
    const res = await (await ctx.as('mfg_meadow')).get(`/api/trace/forward/${batchId}`);
    expect(res.status).toBe(200);
    const mongo = await Shipment.find({ batch_id: batchId }).lean();
    expect(res.body.edges.length).toBe(mongo.length);
    const expectedRecipients = new Set(mongo.map((s) => s.to_entity.entity_id));
    expect(new Set(res.body.recipients.map((r) => r.entity_id))).toEqual(expectedRecipients);
    expect(res.body.recipients.map((r) => r.entity_id)).toEqual(expect.arrayContaining(['PHARM-IN-00023', 'PHARM-IN-00004']));
    expect(res.body.producers.map((p) => p.entity_id)).toEqual(['MFG-IN-00015']);
  });

  test('F14542 fan-out: DIST-IN-00001 appears as sender to 18 wholesalers', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/trace/forward/BATCH-2026-F14542');
    expect(res.status).toBe(200);
    const fromDist = new Set(res.body.edges.filter((e) => e.from.entity_id === 'DIST-IN-00001').map((e) => e.to.entity_id));
    expect(fromDist.size).toBe(18);
  });

  test('unknown batch -> 404', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/trace/forward/BATCH-2026-FFFFFF');
    expect(res.status).toBe(404);
  });
});

describe('FR-4 backward trace / authenticity', () => {
  test('BATCH-2025-0B0618 at PHARM-IN-00023 verifies via MFG-IN-00015 -> DIST-IN-00013 -> WHS-IN-00019 -> PHARM-IN-00023', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/trace/backward/BATCH-2025-0B0618?entity_id=PHARM-IN-00023');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    const chain = res.body.chains[0].path;
    const hops = [chain[0].from.entity_id, ...chain.map((e) => e.to.entity_id)];
    expect(hops).toEqual(['MFG-IN-00015', 'DIST-IN-00013', 'WHS-IN-00019', 'PHARM-IN-00023']);
  });

  test('same batch at PHARM-IN-00004 (pharm_suspect) fails: chain breaks at WHS-IN-00028 / WHS-IN-00033', async () => {
    const res = await (await ctx.as('pharm_suspect')).get('/api/trace/backward/BATCH-2025-0B0618');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.chains).toHaveLength(2);
    expect(res.body.chains.every((c) => !c.verified)).toBe(true);
    expect(res.body.chains.map((c) => c.breaks_at.entity_id).sort()).toEqual(['WHS-IN-00028', 'WHS-IN-00033']);
  });

  test('a fabricated batch id fails verification with 404', async () => {
    const res = await (await ctx.as('pharm_suspect')).get('/api/trace/backward/BATCH-2026-DEAD00');
    expect(res.status).toBe(404);
    expect(res.body.verified).toBe(false);
  });

  test('a batch claimed by two manufacturers never verifies', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/trace/backward/BATCH-2026-B64675?entity_id=MFG-IN-00015');
    expect(res.status).toBe(200);
    expect(res.body.producers).toHaveLength(2);
    expect(res.body.verified).toBe(false);
  });

  test('every legitimately supplied pharmacy of a clean batch verifies', async () => {
    const res = await (await ctx.as('regulator1')).get('/api/trace/forward/BATCH-2026-5983C7');
    const pharmacies = res.body.recipients.filter((r) => r.entity_type === 'pharmacy');
    expect(pharmacies.length).toBeGreaterThan(0);
    for (const p of pharmacies) {
      const v = await (await ctx.as('regulator1')).get(`/api/trace/backward/BATCH-2026-5983C7?entity_id=${p.entity_id}`);
      expect(v.body.verified).toBe(true);
    }
  });
});
