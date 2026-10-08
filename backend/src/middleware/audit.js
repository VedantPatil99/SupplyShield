// FR-10: every mutating request (POST/PUT/PATCH/DELETE) is recorded in the append-only audit_log,
// including rejected ones (status_code shows the outcome). Written after the response finishes.
const { AuditLog } = require('../models');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACT = new Set(['password', 'password_hash', 'token']);
const pending = new Set(); // in-flight writes, so shutdown/tests can wait for them

function scrub(body) {
  if (!body || typeof body !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) out[k] = REDACT.has(k) ? '[redacted]' : v;
  return out;
}

function audit(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const started = Date.now();
  // Capture the concrete path now: Express rewrites baseUrl/route while routing, and an error can leave them reset.
  const urlPath = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const parts = urlPath.replace(/^\/api\//, '').split('/');
    const user = req.user || {};
    const write = AuditLog.create({
      ts: new Date(),
      user_id: user.id,
      username: user.username || (req.body && req.body.username) || undefined,
      role: user.role,
      entity_id: user.entity_id || undefined,
      action: `${req.method} ${urlPath}`,
      resource: parts[0],
      resource_id: res.locals.resourceId || parts[1],
      status_code: res.statusCode,
      ip: req.ip,
      details: { body: scrub(req.body), duration_ms: Date.now() - started, ...(res.locals.auditDetails || {}) },
    }).catch((err) => console.error('[audit] failed to write audit entry:', err.message));
    pending.add(write);
    write.finally(() => pending.delete(write));
  });
  return next();
}

/** Resolves once every audit entry already queued has been written. */
const flushAudit = () => Promise.all([...pending]);

module.exports = { audit, flushAudit };
