const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { cancelAdminBooking } = require('../services/bookingService');
const { ApiError, sendApiError } = require('../utils/apiError');
const { assertObjectId, validateAccountFields } = require('../utils/accountValidation');
const Report = require('../models/Report');
const Shift = require('../models/Shift');

// @route   GET /api/admin/overview
// @desc    High-level fleet snapshot for the dashboard home screen
// @access  Private (admin)
const getFleetOverview = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalBuses,
      activeBuses,
      idleBuses,
      maintenanceBuses,
      totalRoutes,
      bookingsToday,
      totalBookings,
      openReports,
      activeShifts,
    ] = await Promise.all([
      Bus.countDocuments({}),
      Bus.countDocuments({ status: 'active' }),
      Bus.countDocuments({ status: 'idle' }),
      Bus.countDocuments({ status: 'maintenance' }),
      Route.countDocuments({ isActive: true }),
      Booking.countDocuments({ createdAt: { $gte: startOfToday } }),
      Booking.countDocuments({}),
      Report.countDocuments({ status: 'open' }),
      Shift.countDocuments({ status: 'active' }),
    ]);

    res.status(200).json({
      buses: { total: totalBuses, active: activeBuses, idle: idleBuses, maintenance: maintenanceBuses },
      routes: { total: totalRoutes },
      bookingsToday,
      totalBookings,
      openReports,
      activeShifts,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching fleet overview', error: err.message });
  }
};

// @route   GET /api/admin/analytics/bookings
// @desc    Bookings per day for the last 7 days
// @access  Private (admin)
const getBookingsAnalytics = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // include today = 7 days total
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const results = await Booking.aggregate([
      // Stage 1: only look at bookings from the last 7 days
      { $match: { createdAt: { $gte: sevenDaysAgo } } },

      // Stage 2: group bookings by their calendar day
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$fare' },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
          },
        },
      },

      // Stage 3: sort oldest to newest so it plots left-to-right on a chart
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching booking analytics', error: err.message });
  }
};

// @route   GET /api/admin/analytics/occupancy
// @desc    Average seat occupancy (%) per route, across all buses on it
// @access  Private (admin)
const getOccupancyByRoute = async (req, res) => {
  try {
    const results = await Bus.aggregate([
      // Stage 1: work out this bus's occupancy percentage
      {
        $project: {
          route: 1,
          busNumber: 1,
          occupancyPercent: {
            $multiply: [
              { $divide: [{ $subtract: ['$capacity', '$availableSeats'] }, '$capacity'] },
              100,
            ],
          },
        },
      },
      // Stage 2: group all buses by route, average their occupancy
      {
        $group: {
          _id: '$route',
          averageOccupancy: { $avg: '$occupancyPercent' },
          busCount: { $sum: 1 },
        },
      },
      // Stage 3: pull in the route's name instead of just its ID
      {
        $lookup: {
          from: 'routes',
          localField: '_id',
          foreignField: '_id',
          as: 'routeInfo',
        },
      },
      { $unwind: '$routeInfo' },
      {
        $project: {
          _id: 0,
          routeId: '$_id',
          routeName: '$routeInfo.routeName',
          busCount: 1,
          averageOccupancy: { $round: ['$averageOccupancy', 1] },
        },
      },
    ]);

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching occupancy analytics', error: err.message });
  }
};

// @route   GET /api/admin/analytics/reports
// @desc    Report counts grouped by status and type
// @access  Private (admin)
const getReportsSummary = async (req, res) => {
  try {
    const byStatus = await Report.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byType = await Report.aggregate([
      { $group: { _id: '$reportType', count: { $sum: 1 } } },
    ]);

    res.status(200).json({ byStatus, byType });
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching reports summary', error: err.message });
  }
};

const getShifts = async (req, res) => {
  try {
    const shifts = await Shift.find({})
      .populate('driver', 'name email phone')
      .populate('bus', 'busNumber status direction')
      .populate('route', 'routeName startPoint endPoint')
      .sort({ startedAt: -1 });
    res.status(200).json(shifts);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching shifts' });
  }
};

const getAdminBookings = async (req, res) => {
  try {
    const filter = {};
    if (['confirmed', 'cancelled', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    if (['pending', 'paid', 'failed', 'cancelled'].includes(req.query.paymentStatus)) filter.paymentStatus = req.query.paymentStatus;
    const bookings = await Booking.find(filter)
      .populate('user', 'name email phone')
      .populate('bus', 'busNumber status availableSeats capacity')
      .populate('route', 'routeName startPoint endPoint')
      .populate('driver', 'name')
      .sort({ createdAt: -1 }).limit(500);
    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching bookings', error: err.message });
  }
};

const cancelAdminBookingAction = async (req, res) => {
  try {
    const result = await cancelAdminBooking(req.params.id);
    const io = req.app.get('io');
    const bus = result.booking?.bus;
    if (bus?._id && bus.availableSeats != null) {
      io?.to(`bus:${bus._id}`).emit('seatAvailabilityUpdate', { busId: bus._id, availableSeats: bus.availableSeats, capacity: bus.capacity });
    }
    if (result.locationStopped && result.booking?.driver?._id) {
      io?.to(`driver:${result.booking.driver._id}`).emit('passengerLocationUpdate', { bookingId: result.booking._id, passenger: { id: result.booking.user?._id, name: result.booking.user?.name || null }, sharing: false });
    }
    res.status(200).json({ message: 'Booking cancelled and seat released.', booking: result.booking });
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ message: err.message || 'Server error cancelling booking' });
  }
};

const getCommuters = async (req, res) => {
  try {
    const users = await User.find({ role: 'commuter' }).select('_id name email phone createdAt').sort({ createdAt: -1 }).limit(500).lean();
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching passenger accounts', error: err.message });
  }
};

const updateCommuter = async (req, res) => {
  try {
    assertObjectId(req.params.id, 'Passenger ID');
    const fields = validateAccountFields(req.body);
    const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'commuter' }, { $set: fields }, { new: true, runValidators: true }).select('_id name email phone createdAt');
    if (!user) throw new ApiError(404, 'Passenger account not found.');
    res.status(200).json(user);
  } catch (error) {
    sendApiError(res, error, 'Server error updating passenger account', 'A user with this email already exists.');
  }
};

module.exports = {
  getFleetOverview,
  getBookingsAnalytics,
  getOccupancyByRoute,
  getReportsSummary,
  getShifts,
  getAdminBookings,
  cancelAdminBookingAction,
  getCommuters,
  updateCommuter,
};
