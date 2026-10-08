const router = require('express').Router();
const { User, Entity } = require('../models');
const { signToken, requireAuth } = require('../middleware/auth');
const { ah, HttpError } = require('../utils/errors');
const v = require('../utils/validate');

router.post('/login', ah(async (req, res) => {
  const username = v.str(req.body.username, 'username', { max: 64 });
  const password = v.str(req.body.password, 'password', { max: 128 });
  const user = await User.findOne({ username });
  // Same message for unknown user and wrong password.
  if (!user || !(await user.checkPassword(password))) throw new HttpError(401, 'Invalid username or password');
  req.user = { id: String(user._id), role: user.role, entity_id: user.entity_id, username: user.username };
  res.locals.resourceId = user.username;
  const entity = user.entity_id ? await Entity.findById(user.entity_id).lean() : null;
  res.json({ token: signToken(user), user: { ...user.toPublic(), entity } });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new HttpError(401, 'User no longer exists');
  const entity = user.entity_id ? await Entity.findById(user.entity_id).lean() : null;
  res.json({ user: { ...user.toPublic(), entity } });
}));

module.exports = router;
