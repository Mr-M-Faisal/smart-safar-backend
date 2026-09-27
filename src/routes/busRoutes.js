const express = require('express');
const router = express.Router();
const {
  createBus,
  getBuses,
  getBusById,
  getBusETA,
  updateBusLocation,
  startReturnTrip,
  updateSeatAvailability,
  updateBus,
  deleteBus,
} = require('../controllers/busController');
const { startShift, endShift } = require('../controllers/shiftController');
const { protect, authorize } = require('../middleware/auth');

router.get('/', getBuses);
router.get('/:id', getBusById);
router.get('/:id/eta', getBusETA);
router.post('/', protect, authorize('admin'), createBus);
router.post('/assigned/start-shift', protect, authorize('driver'), startShift);
router.post('/assigned/end-shift', protect, authorize('driver'), endShift);
router.post('/assigned/return-trip', protect, authorize('driver'), startReturnTrip);
router.patch('/:id/location', protect, authorize('driver'), updateBusLocation);
router.patch('/:id/seats', protect, authorize('driver', 'admin'), updateSeatAvailability);
router.put('/:id', protect, authorize('admin'), updateBus);
router.delete('/:id', protect, authorize('admin'), deleteBus);

module.exports = router;
