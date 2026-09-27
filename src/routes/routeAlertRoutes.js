const express = require('express');
const router = express.Router();
const {
  createRouteAlert,
  getAlertsByRoute,
  deleteRouteAlert,
} = require('../controllers/routeAlertController');
const { protect, authorize } = require('../middleware/auth');

router.get('/route/:routeId', getAlertsByRoute);
router.post('/', protect, authorize('admin'), createRouteAlert);
router.delete('/:id', protect, authorize('admin'), deleteRouteAlert);

module.exports = router;