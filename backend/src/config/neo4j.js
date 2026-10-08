const neo4j = require('neo4j-driver');
const config = require('./env');
const { withRetry } = require('../utils/retry');

let driver = null;

async function connectNeo4j(opts = {}) {
  if (driver) return driver;
  const d = neo4j.driver(config.neo4jUri, neo4j.auth.basic(config.neo4jUser, config.neo4jPassword), {
    disableLosslessIntegers: true, // return JS numbers; our integers are small (quantities, counts)
  });
  await withRetry('neo4j', () => d.verifyConnectivity(), opts);
  driver = d;
  return driver;
}

function getDriver() {
  if (!driver) throw new Error('Neo4j driver not initialised; call connectNeo4j() first');
  return driver;
}

/** Run a read query and return plain objects (record.toObject()). */
async function read(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.executeRead((tx) => tx.run(cypher, params));
    return res.records.map((r) => toPlain(r.toObject()));
  } finally {
    await session.close();
  }
}

/** Run a write query and return plain objects. */
async function write(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const res = await session.executeWrite((tx) => tx.run(cypher, params));
    return res.records.map((r) => toPlain(r.toObject()));
  } finally {
    await session.close();
  }
}

/** Auto-commit query (needed for schema operations and CALL {} IN TRANSACTIONS). */
async function run(cypher, params = {}) {
  const session = getDriver().session();
  try {
    const res = await session.run(cypher, params);
    return res.records.map((r) => toPlain(r.toObject()));
  } finally {
    await session.close();
  }
}

// Convert Neo4j temporal/integer values that can still leak through into JSON-friendly values.
function toPlain(v) {
  if (v === null || v === undefined) return v;
  if (neo4j.isInt(v)) return v.toNumber();
  if (Array.isArray(v)) return v.map(toPlain);
  if (neo4j.isDateTime(v) || neo4j.isDate(v) || neo4j.isLocalDateTime(v)) return v.toString();
  if (typeof v === 'object' && v.constructor === Object) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toPlain(val);
    return out;
  }
  return v;
}

async function pingNeo4j() {
  const t = Date.now();
  await read('RETURN 1 AS ok');
  return Date.now() - t;
}

async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

module.exports = { connectNeo4j, getDriver, read, write, run, pingNeo4j, closeNeo4j };
