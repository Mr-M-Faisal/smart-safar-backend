const express = require('express');
const router = express.Router();

const { registerUser, loginUser, devLogin, getMe, updateProfile, changePassword, refreshSession, logout } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { loginRateLimiter, registrationRateLimiter } = require('../middleware/rateLimit');

router.post('/register', registrationRateLimiter, registerUser);
router.post('/login', loginRateLimiter, loginUser);
router.post('/dev-login', devLogin);
router.post('/refresh', refreshSession);
router.post('/logout', logout);
router.get('/profile', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.post('/change-password', protect, loginRateLimiter, changePassword);

module.exports = router;
