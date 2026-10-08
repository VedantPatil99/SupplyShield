const { setup, teardown } = require('./helpers');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(teardown);

describe('authentication', () => {
  test('login succeeds with demo credentials and returns a JWT + user', async () => {
    const res = await ctx.request().post('/api/auth/login').send({ username: 'regulator1', password: 'Regulator@123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'regulator1', role: 'regulator' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('all 11 demo users can log in (6 seed + 5 extra)', async () => {
    for (const u of ['admin', 'regulator1', 'mfg_aarav', 'dist_national', 'whs_city', 'pharm_healthplus',
      'mfg_meadow', 'mfg_sunrise', 'mfg_vertex', 'pharm_recall', 'pharm_suspect']) {
      await expect(ctx.login(u)).resolves.toEqual(expect.any(String));
    }
  });

  test('wrong password and unknown user both give 401 with the same message', async () => {
    const a = await ctx.request().post('/api/auth/login').send({ username: 'admin', password: 'nope' });
    const b = await ctx.request().post('/api/auth/login').send({ username: 'ghost', password: 'nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  test('missing fields -> 422', async () => {
    const res = await ctx.request().post('/api/auth/login').send({ username: 'admin' });
    expect(res.status).toBe(422);
  });

  test('missing / malformed / forged tokens -> 401', async () => {
    expect((await ctx.request().get('/api/batches')).status).toBe(401);
    expect((await ctx.request().get('/api/batches').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: 'x', role: 'admin' }, 'wrong-secret');
    expect((await ctx.request().get('/api/admin/users').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  test('/auth/me returns the user with their entity', async () => {
    const res = await (await ctx.as('pharm_suspect')).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'pharm_suspect', entity_id: 'PHARM-IN-00004' });
    expect(res.body.user.entity.entity_type).toBe('pharmacy');
  });
});

describe('role-based access control', () => {
  test('distributor cannot initiate a recall (403)', async () => {
    const res = await (await ctx.as('dist_national')).post('/api/recalls')
      .send({ batch_ids: ['BATCH-2026-5983C7'], reason: 'test', recall_class: 'Class II' });
    expect(res.status).toBe(403);
  });

  test('wholesaler and pharmacy cannot initiate a recall (403)', async () => {
    for (const u of ['whs_city', 'pharm_healthplus']) {
      const res = await (await ctx.as(u)).post('/api/recalls').send({ batch_ids: ['BATCH-2026-5983C7'], reason: 'x', recall_class: 'Class II' });
      expect(res.status).toBe(403);
    }
  });

  test("pharmacy cannot read another entity's inventory", async () => {
    const res = await (await ctx.as('pharm_healthplus')).get('/api/inventory?entity_id=PHARM-IN-00023');
    expect(res.status).toBe(403);
  });

  test('pharmacy inventory is scoped to its own entity', async () => {
    const res = await (await ctx.as('pharm_healthplus')).get('/api/inventory?limit=1000');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i) => i.entity_id === 'PHARM-IN-00001')).toBe(true);
  });

  test('non-admins cannot reach admin endpoints; regulator can read the audit log', async () => {
    expect((await (await ctx.as('regulator1')).get('/api/admin/users')).status).toBe(403);
    expect((await (await ctx.as('mfg_aarav')).get('/api/admin/sync-health')).status).toBe(403);
    expect((await (await ctx.as('regulator1')).get('/api/admin/audit')).status).toBe(200);
    expect((await (await ctx.as('pharm_healthplus')).get('/api/admin/audit')).status).toBe(403);
  });

  test('only regulator/admin can run anomaly detection', async () => {
    expect((await (await ctx.as('mfg_meadow')).post('/api/anomalies/run')).status).toBe(403);
    expect((await (await ctx.as('pharm_suspect')).get('/api/anomalies')).status).toBe(403);
  });

  test("a manufacturer cannot forward-trace another manufacturer's batch", async () => {
    const res = await (await ctx.as('mfg_aarav')).get('/api/trace/forward/BATCH-2025-0B0618');
    expect(res.status).toBe(403);
  });

  test('a pharmacy cannot verify stock at a different entity', async () => {
    const res = await (await ctx.as('pharm_suspect')).get('/api/trace/backward/BATCH-2025-0B0618?entity_id=PHARM-IN-00023');
    expect(res.status).toBe(403);
  });
});
