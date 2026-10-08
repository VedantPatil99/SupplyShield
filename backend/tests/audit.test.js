const { setup, teardown, sleep } = require('./helpers');
const { AuditLog, Transaction } = require('../src/models');

let ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(teardown);

describe('FR-10 audit log', () => {
  test('mutating requests (including rejected ones) create audit entries; reads do not', async () => {
    const before = await AuditLog.countDocuments();
    const dist = await ctx.as('dist_national');
    await dist.get('/api/inventory'); // read: not audited
    const denied = await dist.post('/api/recalls').send({ batch_ids: ['BATCH-2026-5983C7'], reason: 'x', recall_class: 'Class II' });
    expect(denied.status).toBe(403);
    await sleep(200); // entries are written on response finish
    const entries = await AuditLog.find({}).sort({ ts: -1 }).limit(5).lean();
    expect(await AuditLog.countDocuments()).toBeGreaterThan(before);
    const e = entries.find((x) => x.action === 'POST /api/recalls' && x.username === 'dist_national');
    expect(e).toBeTruthy();
    expect(e.status_code).toBe(403);
    expect(e.role).toBe('distributor');
  });

  test('passwords are redacted in audit details', async () => {
    await ctx.request().post('/api/auth/login').send({ username: 'admin', password: 'Admin@123' });
    await sleep(200);
    const e = await AuditLog.findOne({ action: 'POST /api/auth/login' }).sort({ ts: -1 }).lean();
    expect(e.details.body.password).toBe('[redacted]');
  });

  test('no API route mutates the audit log', async () => {
    const admin = await ctx.as('admin');
    const any = await AuditLog.findOne().lean();
    for (const method of ['post', 'patch', 'put', 'delete']) {
      const res = await admin[method](`/api/admin/audit/${any._id}`);
      expect(res.status).toBe(404);
    }
    expect((await admin.delete('/api/admin/audit')).status).toBe(404);
  });

  test('audit_log and transactions are append-only at the model level', async () => {
    await expect(AuditLog.updateOne({}, { $set: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(Transaction.deleteOne({})).rejects.toThrow(/append-only/);
    const doc = await AuditLog.findOne();
    doc.action = 'tampered';
    await expect(doc.save()).rejects.toThrow(/append-only/);
  });
});
