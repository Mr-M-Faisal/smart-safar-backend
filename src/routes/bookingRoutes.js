const express = require('express');
const router = express.Router();
const {
  cancelBooking,
  createBooking,
  getAssignedPassengerLocations,
  getMyBookings,
  paymentWebhook,
  updateBookingLocation,
} = require('../controllers/bookingController');
const { protect, authorize } = require('../middleware/auth');

router.post('/payments/webhook', paymentWebhook);
router.post('/', protect, createBooking);
router.get('/me', protect, getMyBookings);
router.get(
  '/assigned/passenger-locations',
  protect,
  authorize('driver'),
  getAssignedPassengerLocations
);
router.patch('/:id/location', protect, updateBookingLocation);
router.patch('/:id/cancel', protect, cancelBooking);

module.exports = router;
