const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { requireAuth } = require('./middleware/auth');
const { audit } = require('./middleware/audit');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { pingMongo } = require('./config/mongo');
const { pingNeo4j } = require('./config/neo4j');
const config = require('./config/env');

function createApp({ sync = null, logRequests = true } = {}) {
  const app = express();
  app.locals.sync = sync;
  app.set('trust proxy', 'loopback');
  app.use(cors());
  app.use(express.json({ limit: '200kb' }));
  if (logRequests) app.use(morgan('dev'));
  app.use(audit);

  app.get('/api/health', async (req, res) => {
    const out = { status: 'ok', app_now: config.today().toISOString(), mongo: {}, neo4j: {} };
    try { out.mongo = { ok: true, ping_ms: await pingMongo() }; } catch (e) { out.mongo = { ok: false, error: e.message }; out.status = 'degraded'; }
    try { out.neo4j = { ok: true, ping_ms: await pingNeo4j() }; } catch (e) { out.neo4j = { ok: false, error: e.message }; out.status = 'degraded'; }
    out.sync = sync ? sync.stats.status : 'not running';
    res.status(out.status === 'ok' ? 200 : 503).json(out);
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/entities', requireAuth, require('./routes/entities'));
  app.use('/api/batches', requireAuth, require('./routes/batches'));
  app.use('/api/shipments', requireAuth, require('./routes/shipments'));
  app.use('/api/inventory', requireAuth, require('./routes/inventory'));
  app.use('/api/transactions', requireAuth, require('./routes/transactions'));
  app.use('/api/trace', requireAuth, require('./routes/trace'));
  app.use('/api/anomalies', requireAuth, require('./routes/anomalies'));
  app.use('/api/recalls', requireAuth, require('./routes/recalls'));
  app.use('/api/alerts', requireAuth, require('./routes/alerts'));
  app.use('/api/admin', requireAuth, require('./routes/admin'));
  app.use('/api', notFoundHandler);

  app.use(express.static(path.join(__dirname, '../public')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
