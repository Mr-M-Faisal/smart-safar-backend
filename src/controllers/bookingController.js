const Booking = require('../models/Booking');
const { sendApiError } = require('../utils/apiError');
const {
  applyVerifiedPayment,
  cancelUserBooking,
  createBookingFromRequest,
  emitPassengerLocation,
  getPassengerLocationsForDriver,
  updatePassengerLocation,
} = require('../services/bookingService');
const { verifyPaymentNotification } = require('../services/paymentService');

const emitSeatAvailability = (io, bus) => {
  if (!bus) return;
  const id = typeof bus === 'object' ? bus._id : bus;
  const availableSeats = typeof bus === 'object' ? bus.availableSeats : undefined;
  const capacity = typeof bus === 'object' ? bus.capacity : undefined;
  if (id && availableSeats != null) io.to(`bus:${id}`).emit('seatAvailabilityUpdate', { busId: id, availableSeats, capacity });
};

// @route   POST /api/bookings
// @desc    Create a route-first or validated manual booking
// @access  Private
const createBooking = async (req, res) => {
  try {
    const booking = await createBookingFromRequest(req.user._id, req.body);
    emitSeatAvailability(req.app.get('io'), booking.bus);
    if (booking.locationSharingActive) {
      await emitPassengerLocation(req.app.get('io'), booking, true);
    }
    res.status(201).json(booking);
  } catch (error) {
    sendApiError(res, error, 'Server error creating booking');
  }
};

// @route   GET /api/bookings/me
// @desc    Get the logged-in user's own bookings
// @access  Private
const getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('bus', 'busNumber route status')
      .populate('route', 'routeName startPoint endPoint')
      .populate('driver', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json(bookings);
  } catch (error) {
    sendApiError(res, error, 'Server error fetching bookings');
  }
};

// @route   PATCH /api/bookings/:id/cancel
// @desc    Cancel the authenticated user's booking and release its seat
// @access  Private
const cancelBooking = async (req, res) => {
  try {
    const result = await cancelUserBooking(req.params.id, req.user._id);
    emitSeatAvailability(req.app.get('io'), result.booking?.bus);
    if (result.locationStopped) {
      await emitPassengerLocation(req.app.get('io'), result.booking, false);
    }
    res.status(200).json({ message: 'Booking cancelled', booking: result.booking });
  } catch (error) {
    sendApiError(res, error, 'Server error cancelling booking');
  }
};

// @route   PATCH /api/bookings/:id/location
// @desc    Start, update, or stop consensual passenger location sharing
// @access  Private (booking owner)
const updateBookingLocation = async (req, res) => {
  try {
    const booking = await updatePassengerLocation(req.params.id, req.user._id, req.body);
    await emitPassengerLocation(
      req.app.get('io'),
      booking,
      booking.locationSharingActive
    );
    res.status(200).json(booking);
  } catch (error) {
    sendApiError(res, error, 'Server error updating passenger location');
  }
};

// @route   GET /api/bookings/assigned/passenger-locations
// @desc    Return shared locations for the authenticated driver's active assignment
// @access  Private (driver)
const getAssignedPassengerLocations = async (req, res) => {
  try {
    const locations = await getPassengerLocationsForDriver(req.user._id);
    res.status(200).json(locations);
  } catch (error) {
    sendApiError(res, error, 'Server error fetching passenger locations');
  }
};

// @route   POST /api/bookings/payments/webhook
// @desc    Apply a cryptographically verified payment provider notification
// @access  Payment provider (HMAC signature)
const paymentWebhook = async (req, res) => {
  try {
    const notification = verifyPaymentNotification(
      req.body,
      req.headers['x-payment-signature']
    );
    const result = await applyVerifiedPayment(notification);
    if (result.locationStopped) {
      await emitPassengerLocation(req.app.get('io'), result.booking, false);
    }
    res.status(200).json({
      message: 'Payment notification processed',
      booking: {
        _id: result.booking._id,
        status: result.booking.status,
        paymentStatus: result.booking.paymentStatus,
        paidAt: result.booking.paidAt,
      },
    });
  } catch (error) {
    sendApiError(res, error, 'Server error processing payment notification');
  }
};

module.exports = {
  cancelBooking,
  createBooking,
  getAssignedPassengerLocations,
  getMyBookings,
  paymentWebhook,
  updateBookingLocation,
};
