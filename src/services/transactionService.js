const mongoose = require('mongoose');

const transactionOptions = {
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  maxCommitTimeMS: 10000,
};

function runInTransaction(work) {
  return mongoose.connection.transaction(work, transactionOptions);
}

module.exports = { runInTransaction };
