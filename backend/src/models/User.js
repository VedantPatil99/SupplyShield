const { Schema, model } = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('./constants');

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ROLES, required: true },
  entity_id: { type: String, default: null },
  display_name: String,
}, { versionKey: false, collection: 'users', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

UserSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 10);
UserSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.password_hash);
};
UserSchema.methods.toPublic = function toPublic() {
  return { id: String(this._id), username: this.username, role: this.role, entity_id: this.entity_id, display_name: this.display_name };
};

module.exports = model('User', UserSchema);
