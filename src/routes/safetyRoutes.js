const express = require('express');
const router = express.Router();
const {
  startSession,
  trackSession,
  endSession,
  getMySessions,
} = require('../controllers/safetyController');
const { protect } = require('../middleware/auth');

// Public — this is the link a trusted contact opens, no login needed
router.get('/track/:shareToken', trackSession);

// Private — only the passenger themselves
router.post('/sessions', protect, startSession);
router.get('/sessions/me', protect, getMySessions);
router.patch('/sessions/:id/end', protect, endSession);

module.exports = router;