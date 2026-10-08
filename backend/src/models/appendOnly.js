// Mongoose plugin: reject every update/delete path so the collection is append-only at the model level.
// (Someone with direct shell access can still bypass this; production would add DB-level roles.)
const BLOCKED = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete'];

module.exports = function appendOnly(schema, { name }) {
  for (const op of BLOCKED) {
    schema.pre(op, function block() {
      throw new Error(`${name} is append-only: ${op} is not allowed`);
    });
  }
  schema.pre('save', function blockResave() {
    if (!this.isNew) throw new Error(`${name} is append-only: documents cannot be modified`);
  });
};
