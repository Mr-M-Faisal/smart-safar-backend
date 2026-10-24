const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = await User.findById(decoded.id).select('-password +googleId');

    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized, user no longer exists' });
    }
    if (req.user.isActive === false) return res.status(403).json({ message: 'This account has been disabled. Contact an administrator.', code: 'ACCOUNT_DISABLED' });
    req.authSessionId = decoded.sid || null;

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions for this action' });
    }
    next();
  };
};

module.exports = { protect, authorize };
