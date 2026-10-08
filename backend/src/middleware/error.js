const { HttpError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new HttpError(404, `No route ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal error';
  if (err.name === 'ValidationError') { status = 422; }
  if (err.name === 'CastError') { status = 422; message = `Invalid value for ${err.path}`; }
  if (err.code === 11000) { status = 409; message = 'Duplicate key'; }
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body'; }
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
}

module.exports = { notFoundHandler, errorHandler, HttpError };
