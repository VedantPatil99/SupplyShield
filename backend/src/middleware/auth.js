const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { HttpError } = require('../utils/errors');

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, entity_id: user.entity_id || null, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/** Requires a valid Bearer JWT; sets req.user = { id, role, entity_id, username }. */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/i);
  if (!m) return next(new HttpError(401, 'Missing bearer token'));
  try {
    const p = jwt.verify(m[1], config.jwtSecret);
    req.user = { id: p.sub, role: p.role, entity_id: p.entity_id, username: p.username };
    return next();
  } catch (err) {
    return next(new HttpError(401, err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'));
  }
}

module.exports = { signToken, requireAuth };
