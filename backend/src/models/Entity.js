const { Schema, model } = require('mongoose');
const { ENTITY_TYPES } = require('./constants');

const EntitySchema = new Schema({
  _id: String, // = entity_id
  name: { type: String, required: true },
  entity_type: { type: String, enum: ENTITY_TYPES, required: true, index: true },
  city: String,
  country: String,
  license_number: String,
}, { versionKey: false, collection: 'entities' });

module.exports = model('Entity', EntitySchema);
