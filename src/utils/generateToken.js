const jwt = require('jsonwebtoken');

// Creates a signed JWT containing the user's id and role.
// The token is what the client sends back on future requests
// (usually in the Authorization header) to prove who they are.
const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = generateToken;