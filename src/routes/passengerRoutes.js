const express = require('express');
const router = express.Router();
const { getPassengerBootstrap } = require('../controllers/aggregateController');
const { protect, authorize } = require('../middleware/auth');

router.get('/bootstrap', protect, authorize('commuter'), getPassengerBootstrap);

module.exports = router;
