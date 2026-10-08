const crypto = require('crypto');

const hex6 = () => crypto.randomBytes(3).toString('hex').toUpperCase();

/** Generate an id like BATCH-2026-5983C7 that does not exist yet in `Model`. */
async function uniqueId(Model, makeId, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const id = makeId(hex6());
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists({ _id: id }))) return id;
  }
  throw new Error('Could not generate a unique id');
}

const signature = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);

module.exports = { hex6, uniqueId, signature };
