const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  replacedByHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });
module.exports = mongoose.model('RefreshToken', schema);
