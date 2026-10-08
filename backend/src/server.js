const config = require('./config/env');
const { connectMongo, disconnectMongo } = require('./config/mongo');
const { connectNeo4j, closeNeo4j } = require('./config/neo4j');
const { SyncService } = require('./services/sync');
const { runDetection } = require('./services/anomaly');
const { createApp } = require('./app');
const { flushAudit } = require('./middleware/audit');

async function main() {
  await connectMongo();
  await connectNeo4j();
  console.log('[startup] connected to MongoDB and Neo4j');

  const sync = new SyncService(console);
  await sync.start();
  console.log(`[startup] sync service running (${sync.stats.mode})`);

  // Re-run the detectors shortly after the graph changes (debounced), in addition to on-demand runs.
  if (config.anomaly.autoRunDebounceMs > 0) {
    let timer = null;
    sync.on('projected', ({ collection }) => {
      if (collection !== 'shipments' && collection !== 'batches') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        runDetection({ trigger: 'auto:after-sync' })
          .then((s) => { if (s.new_findings) console.log(`[anomaly] auto-run found ${s.new_findings} new finding(s)`); })
          .catch((err) => console.error('[anomaly] auto-run failed:', err.message));
      }, config.anomaly.autoRunDebounceMs);
    });
  }

  const app = createApp({ sync });
  const server = app.listen(config.port, () => console.log(`[startup] SupplyShield listening on http://localhost:${config.port}`));

  const shutdown = async (sig) => {
    console.log(`[shutdown] ${sig}`);
    server.close();
    await sync.stop();
    await flushAudit();
    await closeNeo4j();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[startup] fatal:', err);
  process.exit(1);
});
