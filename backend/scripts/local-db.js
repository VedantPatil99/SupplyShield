#!/usr/bin/env node
// Local (non-Docker) database helper for Windows/macOS/Linux.
//   node scripts/local-db.js start   -> starts mongod (replica set rs0) + Neo4j console, initialises rs0, sets Neo4j password
//   node scripts/local-db.js stop    -> stops both
//   node scripts/local-db.js status
// Expects the portable MongoDB 7 and Neo4j 5 Community folders in <repo>/.tools (see README "Local setup").
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { MongoClient } = require('mongodb');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '.tools');
const DATA = path.join(ROOT, '.dbdata');
const PIDS = path.join(DATA, 'pids.json');
const isWin = process.platform === 'win32';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'supplyshield123';

function findDir(prefix) {
  if (!fs.existsSync(TOOLS)) return null;
  const d = fs.readdirSync(TOOLS).find((n) => n.startsWith(prefix) && fs.statSync(path.join(TOOLS, n)).isDirectory());
  return d ? path.join(TOOLS, d) : null;
}

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function waitPort(port, label, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not open port ${port} within ${seconds}s`);
}

// Windows: start a long-running process fully detached from this one (survives this script exiting) and
// return its pid. stdio is ignored so the child can't inherit pipes that would keep spawnSync waiting.
function winStart(file, args, outLog) {
  const pidFile = path.join(DATA, `.pid-${path.basename(file)}`);
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `$p = Start-Process -FilePath ${q(file)} -ArgumentList @(${args.map((a) => q(a.includes(' ') ? `"${a}"` : a)).join(',')}) `
    + `-WindowStyle Hidden -PassThru -RedirectStandardOutput ${q(outLog)} -RedirectStandardError ${q(`${outLog}.err`)}; `
    + `Set-Content -Path ${q(pidFile)} -Value $p.Id`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`could not start ${file}`);
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  fs.unlinkSync(pidFile);
  return pid;
}

function readPids() {
  try { return JSON.parse(fs.readFileSync(PIDS, 'utf8')); } catch (_) { return {}; }
}

async function start() {
  fs.mkdirSync(path.join(DATA, 'mongo'), { recursive: true });
  const pids = readPids();

  // ---- MongoDB (single-node replica set; change streams require a replica set) ----
  if (await portOpen(27017)) {
    console.log('mongod already listening on 27017');
  } else {
    const mongoDir = findDir('mongodb-');
    if (!mongoDir) throw new Error(`MongoDB not found in ${TOOLS}`);
    const mongod = path.join(mongoDir, 'bin', isWin ? 'mongod.exe' : 'mongod');
    const log = path.join(DATA, 'mongod.log');
    const args = ['--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', '27017',
      '--dbpath', path.join(DATA, 'mongo'), '--logpath', log, '--logappend'];
    if (isWin) {
      pids.mongod = winStart(mongod, args, path.join(DATA, 'mongod-console.log'));
    } else {
      const child = spawn(mongod, args, { detached: true, stdio: 'ignore' });
      child.unref();
      pids.mongod = child.pid;
    }
    console.log(`started mongod (pid ${pids.mongod}), log: ${log}`);
    await waitPort(27017, 'mongod');
  }
  const client = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');
  await client.connect();
  try {
    await client.db('admin').command({ replSetGetStatus: 1 });
    console.log('replica set rs0 already initialised');
  } catch (err) {
    if (err.codeName !== 'NotYetInitialized') throw err;
    await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
    console.log('initialised replica set rs0');
  }
  for (let i = 0; i < 30; i++) {
    const hello = await client.db('admin').command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await client.close();

  // ---- Neo4j 5 Community ----
  if (await portOpen(7687)) {
    console.log('Neo4j already listening on 7687');
  } else {
    const neoDir = findDir('neo4j-community-');
    if (!neoDir) throw new Error(`Neo4j not found in ${TOOLS}`);
    const bin = (n) => path.join(neoDir, 'bin', isWin ? `${n}.bat` : n);
    const authFile = path.join(neoDir, 'data', 'dbms', 'auth.ini');
    if (!fs.existsSync(authFile)) {
      const r = isWin
        ? spawnSync('cmd.exe', ['/c', bin('neo4j-admin'), 'dbms', 'set-initial-password', NEO4J_PASSWORD], { stdio: 'inherit' })
        : spawnSync(bin('neo4j-admin'), ['dbms', 'set-initial-password', NEO4J_PASSWORD], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('neo4j-admin set-initial-password failed');
    }
    const conf = path.join(neoDir, 'conf', 'neo4j.conf');
    if (!fs.readFileSync(conf, 'utf8').includes('dbms.usage_report.enabled=false')) {
      fs.appendFileSync(conf, '\n# SupplyShield local dev\ndbms.usage_report.enabled=false\n');
    }
    const outLog = path.join(DATA, 'neo4j.log');
    if (isWin) {
      // A detached child_process kills neo4j.bat ("Terminate batch job"); Start-Process runs it properly hidden.
      pids.neo4j = winStart(bin('neo4j'), ['console'], outLog);
    } else {
      const log = fs.openSync(outLog, 'a');
      const child = spawn(bin('neo4j'), ['console'], { detached: true, stdio: ['ignore', log, log] });
      child.unref();
      pids.neo4j = child.pid;
    }
    console.log(`started Neo4j (pid ${pids.neo4j}), log: ${outLog}`);
    await waitPort(7687, 'Neo4j', 180);
  }
  fs.writeFileSync(PIDS, JSON.stringify(pids, null, 2));
  console.log('\nMongoDB: mongodb://localhost:27017/supplyshield?replicaSet=rs0');
  console.log(`Neo4j:   bolt://localhost:7687 (Browser http://localhost:7474, user neo4j / ${NEO4J_PASSWORD})`);
}

function killTree(pid) {
  if (!pid) return;
  if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-pid, 'SIGTERM'); } catch (_) { try { process.kill(pid, 'SIGTERM'); } catch (__) { /* gone */ } }
}

async function stop() {
  // Ask mongod to shut down cleanly first.
  if (await portOpen(27017)) {
    const client = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true');
    try {
      await client.connect();
      await client.db('admin').command({ shutdown: 1, force: true });
    } catch (_) { /* connection drops on shutdown */ }
    await client.close().catch(() => {});
  }
  const pids = readPids();
  killTree(pids.neo4j);
  if (isWin) {
    // neo4j.bat spawns java.exe; make sure the JVM running Neo4j is gone too.
    spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*neo4j*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' });
  }
  killTree(pids.mongod);
  try { fs.unlinkSync(PIDS); } catch (_) { /* none */ }
  console.log('stopped');
}

async function status() {
  console.log(`mongod  :27017 ${(await portOpen(27017)) ? 'UP' : 'down'}`);
  console.log(`neo4j   :7687  ${(await portOpen(7687)) ? 'UP' : 'down'}`);
}

const cmd = process.argv[2] || 'status';
({ start, stop, status })[cmd]().catch((err) => { console.error(err.message); process.exit(1); });
