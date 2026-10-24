const jwt = require('jsonwebtoken');

// Creates a signed JWT containing the user's id and role.
// The token is what the client sends back on future requests
// (usually in the Authorization header) to prove who they are.
const generateToken = (userId, role, sessionId) => {
  return jwt.sign(
    { id: userId, role, ...(sessionId ? { sid: String(sessionId) } : {}) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m', algorithm: 'HS256' }
  );
};

module.exports = generateToken;
