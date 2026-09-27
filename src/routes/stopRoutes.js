const express = require('express');
const router = express.Router();
const {
  createStop,
  getStopsByRoute,
  getStopById,
  updateStop,
  deleteStop,
} = require('../controllers/stopController');
const { protect, authorize } = require('../middleware/auth');

router.get('/route/:routeId', getStopsByRoute);
router.get('/:id', getStopById);
router.post('/', protect, authorize('admin'), createStop);
router.put('/:id', protect, authorize('admin'), updateStop);
router.delete('/:id', protect, authorize('admin'), deleteStop);

module.exports = router;