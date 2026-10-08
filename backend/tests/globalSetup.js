// Tests run against the real local MongoDB + Neo4j. Neo4j Community has a single database, so instead of a
// separate test database the suite starts from a freshly seeded state (seed --reset). Set SKIP_SEED=1 to skip.
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async () => {
  if (process.env.SKIP_SEED === '1') return;
  const r = spawnSync(process.execPath, [path.join(__dirname, '../scripts/seed.js'), '--reset', '--no-detect'], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
  });
  if (r.status !== 0) {
    throw new Error(`Seeding failed before tests:\n${r.stdout}\n${r.stderr}`);
  }
};
