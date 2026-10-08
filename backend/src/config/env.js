const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// backend/.env wins over a repo-root .env; real environment variables win over both.
for (const p of [path.join(__dirname, '../../.env'), path.join(__dirname, '../../../.env')]) {
  if (fs.existsSync(p)) dotenv.config({ path: p, quiet: true });
}

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

const config = {
  port: num('PORT', 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/supplyshield?replicaSet=rs0',
  neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || 'supplyshield123',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  anomaly: {
    fanInWindowHours: num('ANOMALY_FANIN_WINDOW_HOURS', 6),
    fanOutMultiplier: num('ANOMALY_FANOUT_MULTIPLIER', 3),
    fanOutWindowHours: num('ANOMALY_FANOUT_WINDOW_HOURS', 24),
    fanOutMinThreshold: 5,
    autoRunDebounceMs: num('ANOMALY_AUTO_RUN_DEBOUNCE_MS', 3000),
  },
  appNow: process.env.APP_NOW || '',
  dataDir: path.resolve(__dirname, '../../../data'),
};

if (!config.jwtSecret) {
  if (process.env.NODE_ENV === 'test') config.jwtSecret = 'test-secret';
  else throw new Error('JWT_SECRET is not set. Copy .env.example to backend/.env.');
}

/** The app's notion of "today" (APP_NOW), used for expiry checks only. Event timestamps use the real clock. */
config.today = () => (config.appNow ? new Date(config.appNow) : new Date());

module.exports = config;
