const mongoose = require('mongoose');
const crypto = require('crypto');

const safetySessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    bus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bus',
      required: true,
    },
    // A random, unguessable string used in the shareable link.
    // e.g. https://sawari.app/safety/track/<shareToken>
    // Trusted contacts use this link WITHOUT needing an account —
    // that's the whole point, they just click and watch.
    shareToken: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(16).toString('hex'),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SafetySession', safetySessionSchema);