const request = require('supertest');
const { connectMongo, disconnectMongo } = require('../src/config/mongo');
const { connectNeo4j, closeNeo4j } = require('../src/config/neo4j');
const { createApp } = require('../src/app');
const { flushAudit } = require('../src/middleware/audit');

const PASSWORDS = {
  admin: 'Admin@123', regulator1: 'Regulator@123', mfg_aarav: 'Mfg@12345', dist_national: 'Dist@12345', whs_city: 'Whs@12345',
  pharm_healthplus: 'Pharm@12345', mfg_meadow: 'Mfg@12345', mfg_sunrise: 'Mfg@12345', mfg_vertex: 'Mfg@12345',
  pharm_recall: 'Pharm@12345', pharm_suspect: 'Pharm@12345',
};

const PLANTED_BATCHES = ['BATCH-2026-B64675', 'BATCH-2025-A7B41D', 'BATCH-2026-F14542', 'BATCH-2025-0B0618'];

async function setup({ sync = null } = {}) {
  await connectMongo(undefined, { attempts: 5 });
  await connectNeo4j({ attempts: 5 });
  const app = createApp({ sync, logRequests: false });
  const tokens = {};
  const login = async (username) => {
    if (!tokens[username]) {
      const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORDS[username] });
      if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
      tokens[username] = res.body.token;
    }
    return tokens[username];
  };
  /** Authenticated request helper: as('admin').get('/api/...') */
  const as = async (username) => {
    const token = await login(username);
    const agent = request(app);
    const wrap = (method) => (url) => agent[method](url).set('Authorization', `Bearer ${token}`);
    return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), delete: wrap('delete'), put: wrap('put') };
  };
  return { app, login, as, request: () => request(app) };
}

async function teardown() {
  await flushAudit();
  await closeNeo4j();
  await disconnectMongo();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { setup, teardown, PASSWORDS, PLANTED_BATCHES, sleep };
