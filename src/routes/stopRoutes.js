const express = require('express');
const router = express.Router();
const {
  createStop,
  getStopsByRoute,
  getStopById,
  updateStop,
  reorderStop,
  deleteStop,
} = require('../controllers/stopController');
const { protect, authorize } = require('../middleware/auth');

router.get('/route/:routeId', getStopsByRoute);
router.get('/:id', getStopById);
router.post('/', protect, authorize('admin'), createStop);
router.put('/:id', protect, authorize('admin'), updateStop);
router.patch('/:id/reorder', protect, authorize('admin'), reorderStop);
router.delete('/:id', protect, authorize('admin'), deleteStop);

module.exports = router;
