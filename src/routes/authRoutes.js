const express = require('express');
const router = express.Router();

const { registerUser, loginUser, devLogin, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/dev-login', devLogin);
router.get('/profile', protect, getMe);

module.exports = router;
