// Acceptance test from the handoff (section 5 "Expected detector output"), run against real Neo4j.
const { setup, teardown, PLANTED_BATCHES } = require('./helpers');
const { Anomaly, Shipment } = require('../src/models');
const { anomalyId } = require('../src/services/anomaly');

const EXPECTED = [
  ['multi_manufacturer_batch', 'BATCH-2026-B64675', 'MFG-IN-00013,MFG-IN-00015', 'high'],
  ['duplicate_batch_fanin', 'BATCH-2025-A7B41D', 'WHS-IN-00009', 'high'],
  ['abnormal_fanout', 'BATCH-2026-F14542', 'DIST-IN-00001', 'high'],
  ['reentrant_distribution', 'BATCH-2025-0B0618', 'PHARM-IN-00004', 'medium'],
  ['provenance_gap', 'BATCH-2025-A7B41D', 'DIST-IN-00002', 'high'],
  ['provenance_gap', 'BATCH-2025-A7B41D', 'DIST-IN-00003', 'high'],
  ['provenance_gap', 'BATCH-2026-F14542', 'DIST-IN-00001', 'high'],
  ['provenance_gap', 'BATCH-2025-0B0618', 'WHS-IN-00028', 'high'],
  ['provenance_gap', 'BATCH-2025-0B0618', 'WHS-IN-00033', 'high'],
];

// Organic repeat receipts: (batch, receiver) pairs outside the planted batches that receive the same batch more
// than once (normal restocking). Computed from the data; the handoff says there are 10 and none may be flagged.
async function organicRepeatPairs() {
  const seeded = require('../../data/mongodb/batches.json').map((b) => b._id).filter((id) => !PLANTED_BATCHES.includes(id));
  return Shipment.aggregate([
    { $match: { batch_id: { $in: seeded } } },
    { $group: { _id: { batch: '$batch_id', receiver: '$to_entity.entity_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
}

let ctx;
let firstRun;
beforeAll(async () => {
  ctx = await setup();
  await Anomaly.deleteMany({});
  firstRun = await (await ctx.as('regulator1')).post('/api/anomalies/run');
});
afterAll(teardown);

describe('anomaly detection acceptance', () => {
  test('run succeeds and reports per-detector timings', () => {
    expect(firstRun.status).toBe(200);
    expect(Object.keys(firstRun.body.detector_ms).sort()).toEqual(
      ['abnormal_fanout', 'duplicate_batch_fanin', 'multi_manufacturer_batch', 'provenance_gap', 'reentrant_distribution'],
    );
  });

  test('exactly the 9 expected documents exist', async () => {
    const all = await Anomaly.find({}).lean();
    expect(all).toHaveLength(9);
    for (const [type, batch, disc, sev] of EXPECTED) {
      const doc = all.find((a) => a.type === type && a.batch_id === batch && a.discriminator === disc);
      expect({ type, batch, disc, found: !!doc }).toEqual({ type, batch, disc, found: true });
      expect(doc.severity).toBe(sev);
    }
  });

  test('the four planted manifest entries are present by (type, batch_id)', async () => {
    const manifest = require('../../data/anomalies_manifest.json').planted_anomalies;
    for (const m of manifest) {
      expect(await Anomaly.exists({ type: m.type, batch_id: m.batch_id })).toBeTruthy();
    }
  });

  test('provenance gaps cover exactly 22 shipments; fan-out burst has 18 receivers', async () => {
    expect(firstRun.body.provenance_gap_shipments).toBe(22);
    const fan = await Anomaly.findOne({ type: 'abnormal_fanout' }).lean();
    expect(fan.details.distinct_receivers).toBe(18);
    expect(firstRun.body.fanout.threshold).toBe(5);
    expect(firstRun.body.fanout.next_highest_sender_fanout).toBe(4);
  });

  test('none of the 10 organic repeat-receipt batches is flagged', async () => {
    const pairs = await organicRepeatPairs();
    expect(pairs).toHaveLength(10);
    expect(pairs.map((p) => p._id)).toContainEqual({ batch: 'BATCH-2026-CE201F', receiver: 'WHS-IN-00001' });
    expect(await Anomaly.countDocuments({ batch_id: { $in: pairs.map((p) => p._id.batch) } })).toBe(0);
  });

  test('re-running is idempotent and does not reset reviewed/dismissed status', async () => {
    const reg = await ctx.as('regulator1');
    const id = anomalyId('provenance_gap', 'BATCH-2025-A7B41D', 'DIST-IN-00002');
    const patch = await reg.patch(`/api/anomalies/${encodeURIComponent(id)}`).send({ status: 'dismissed', note: 'test' });
    expect(patch.status).toBe(200);
    const again = await reg.post('/api/anomalies/run');
    expect(again.status).toBe(200);
    expect(again.body.new_findings).toBe(0);
    expect(await Anomaly.countDocuments()).toBe(9);
    expect((await Anomaly.findById(id).lean()).status).toBe('dismissed');
    await reg.patch(`/api/anomalies/${encodeURIComponent(id)}`).send({ status: 'open' });
  });

  test('a manufacturer only sees anomalies on its own batches', async () => {
    const res = await (await ctx.as('mfg_sunrise')).get('/api/anomalies');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2); // F14542: fan-out + provenance gap
    expect(res.body.items.every((a) => a.batch_id === 'BATCH-2026-F14542')).toBe(true);
  });
});
