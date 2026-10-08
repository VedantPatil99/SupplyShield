const mongoose = require('mongoose');
const config = require('./env');
const { withRetry } = require('../utils/retry');

mongoose.set('strictQuery', true);

async function connectMongo(uri = config.mongoUri, opts = {}) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await withRetry('mongo', () => mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 }), opts);
  // Change streams need a replica set; fail loudly instead of erroring later in the sync service.
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB is not running as a replica set (change streams need one). Start mongod with --replSet rs0 and run rs.initiate().');
  }
  return mongoose.connection;
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

async function pingMongo() {
  const t = Date.now();
  await mongoose.connection.db.admin().command({ ping: 1 });
  return Date.now() - t;
}

module.exports = { connectMongo, disconnectMongo, pingMongo, mongoose };
