const { HttpError } = require('../utils/errors');

/** Route-level role gate. Data scoping (which rows a role may see) is done in the handlers. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (!roles.includes(req.user.role)) {
    return next(new HttpError(403, `Role "${req.user.role}" may not perform this action`));
  }
  return next();
};

const isOversight = (user) => user.role === 'admin' || user.role === 'regulator';

module.exports = { requireRole, isOversight };
