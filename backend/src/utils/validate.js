// Small hand-rolled validators (no extra dependency). Each throws a 422 HttpError.
const { badRequest } = require('./errors');

function str(v, name, { required = true, max = 500, pattern } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`${name} must be a string`);
  const s = v.trim();
  if (s.length > max) throw badRequest(`${name} is too long (max ${max})`);
  if (pattern && !pattern.test(s)) throw badRequest(`${name} has an invalid format`);
  return s;
}

function oneOf(v, name, allowed, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  if (!allowed.includes(v)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
}

function posInt(v, name, { required = true, max = 1e9 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > max) throw badRequest(`${name} must be a positive integer`);
  return n;
}

function date(v, name, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${name} is required`);
    return undefined;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} must be a valid date (YYYY-MM-DD or ISO 8601)`);
  return d;
}

function pageParams(q, { defLimit = 50, maxLimit = 500 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defLimit));
  const skip = Math.max(0, parseInt(q.skip, 10) || 0);
  return { limit, skip };
}

module.exports = { str, oneOf, posInt, date, pageParams };
