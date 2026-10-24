const { randomBytes, createHash } = require('crypto');
const RefreshToken = require('../models/RefreshToken');
const generateToken = require('../utils/generateToken');
const { runInTransaction } = require('./transactionService');

const refreshExpiry = () => {
  const days = Number(process.env.SESSION_INACTIVITY_DAYS || 7);
  return new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000);
};
const hash = token => createHash('sha256').update(token).digest('hex');

async function createSession(user) {
  const refreshToken = randomBytes(48).toString('base64url');
  const [session] = await RefreshToken.create([{ user: user._id, tokenHash: hash(refreshToken), expiresAt: refreshExpiry() }]);
  return { token: generateToken(user._id, user.role, session._id), refreshToken };
}

async function rotateSession(token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const tokenHash = hash(token);
  return runInTransaction(async session => {
    const now = new Date();
    const revoked = await RefreshToken.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now } },
      { new: false, session }
    ).populate('user');
    if (!revoked?.user) {
      const existing = await RefreshToken.findOne({ tokenHash }).populate('user').session(session);
      return existing?.user?.isActive === false ? { disabled: true } : null;
    }
    if (revoked.user.isActive === false) return { disabled: true };
    const refreshToken = randomBytes(48).toString('base64url');
    const nextHash = hash(refreshToken);
    const [nextSession] = await RefreshToken.create([{ user: revoked.user._id, tokenHash: nextHash, expiresAt: refreshExpiry() }], { session });
    await RefreshToken.updateOne({ tokenHash }, { $set: { replacedByHash: nextHash } }, { session });
    return { token: generateToken(revoked.user._id, revoked.user.role, nextSession._id), refreshToken };
  });
}

async function revokeSession(token) {
  if (typeof token === 'string' && token.length >= 32) {
    await RefreshToken.updateOne({ tokenHash: hash(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
}

async function revokeUserSessions(userId, exceptSessionId = null) {
  const filter = { user: userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  return RefreshToken.updateMany(filter, { $set: { revokedAt: new Date() } });
}

module.exports = { createSession, rotateSession, revokeSession, revokeUserSessions };
