const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { cancelAdminBooking } = require('../services/bookingService');
const { ApiError, sendApiError } = require('../utils/apiError');
const { assertObjectId, validateAccountFields } = require('../utils/accountValidation');
const Report = require('../models/Report');
const Shift = require('../models/Shift');
const { getOperatingBusesForRoute } = require('../services/operatingBusService');
const Seat = require('../models/Seat');

// @route   GET /api/admin/overview
// @desc    High-level fleet snapshot for the dashboard home screen
// @access  Private (admin)
const getFleetOverview = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalBuses, maintenanceBuses, totalRoutes, bookingsToday, totalBookings, openReports] = await Promise.all([
      Bus.countDocuments({}),
      Bus.countDocuments({ status: 'maintenance' }),
      Route.countDocuments({ isActive: true }),
      Booking.countDocuments({ createdAt: { $gte: startOfToday } }),
      Booking.countDocuments({}),
      Report.countDocuments({ status: 'open' }),
    ]);
    const routeIds = await Shift.distinct('route', { status: 'active', endedAt: null });
    const operatingBuses = (await Promise.all(routeIds.map(id => getOperatingBusesForRoute(id)))).flat();
    const activeBuses = operatingBuses.length;
    const activeShifts = activeBuses;
    const idleBuses = Math.max(0, totalBuses - activeBuses - maintenanceBuses);

    res.status(200).json({
      buses: { total: totalBuses, active: activeBuses, idle: idleBuses, maintenance: maintenanceBuses },
      routes: { total: totalRoutes },
      bookingsToday,
      totalBookings,
      openReports,
      activeShifts,
    });
  } catch (err) {
    sendApiError(res, err, 'Could not load fleet overview.');
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
            $sum: { $cond: [{ $in: ['$status', ['cancelled', 'cancelled_by_service', 'no_show']] }, 1, 0] },
          },
        },
      },

      // Stage 3: sort oldest to newest so it plots left-to-right on a chart
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json(results);
  } catch (err) {
    sendApiError(res, err, 'Could not load booking analytics.');
  }
};

// @route   GET /api/admin/analytics/occupancy
// @desc    Average seat occupancy (%) per route, across all buses on it
// @access  Private (admin)
const getOccupancyByRoute = async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true }).select('_id routeName').lean();
    const results = await Promise.all(routes.map(async route => {
      const operating = await getOperatingBusesForRoute(route._id);
      const capacities = operating.reduce((sum, bus) => sum + Number(bus.capacity || 0), 0);
      const occupied = operating.reduce((sum, bus) => sum + Number(bus.capacity || 0) - Number(bus.availableSeats || 0), 0);
      return { routeId: route._id, routeName: route.routeName, busCount: operating.length, occupiedSeats: occupied, capacity: capacities, averageOccupancy: capacities ? Math.round((occupied / capacities) * 1000) / 10 : 0 };
    }));
    res.status(200).json(results);
  } catch (err) {
    sendApiError(res, err, 'Could not load occupancy analytics.');
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
    sendApiError(res, err, 'Could not load reports summary.');
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
    sendApiError(res, err, 'Could not load shifts.');
  }
};

const getOperatingConsistency = async (req, res) => {
  try {
    const [buses, shifts] = await Promise.all([
      Bus.find({}).select('_id busNumber route driver status').lean(),
      Shift.find({ status: 'active', endedAt: null }).select('_id bus driver route startedAt heartbeatAt').lean(),
    ]);
    const routeIds = [...new Set([...buses.map(b => String(b.route || '')), ...shifts.map(s => String(s.route || ''))].filter(Boolean))];
    const operating = (await Promise.all(routeIds.map(id => getOperatingBusesForRoute(id)))).flat();
    const operatingByBus = new Set(operating.map(b => String(b._id)));
    const shiftByBus = new Map(shifts.map(s => [String(s.bus), s]));
    const mismatches = [];
    const busShiftCounts = new Map();
    const driverShiftCounts = new Map();
    const staleMs = Math.max(1, Number(process.env.SHIFT_STALE_HOURS || 12)) * 60 * 60 * 1000;
    for (const shift of shifts) {
      const busId = String(shift.bus); const driverId = String(shift.driver);
      busShiftCounts.set(busId, (busShiftCounts.get(busId) || 0) + 1);
      driverShiftCounts.set(driverId, (driverShiftCounts.get(driverId) || 0) + 1);
      if (Date.now() - new Date(shift.heartbeatAt || shift.startedAt).getTime() >= staleMs) mismatches.push({ type: 'stale_open_shift', shiftId: shift._id, busId: shift.bus, driverId });
    }
    for (const [busId, count] of busShiftCounts) if (count > 1) mismatches.push({ type: 'multiple_open_shifts_for_bus', busId, count });
    for (const [driverId, count] of driverShiftCounts) if (count > 1) mismatches.push({ type: 'multiple_open_shifts_for_driver', driverId, count });
    for (const bus of buses) {
      const id = String(bus._id);
      const shift = shiftByBus.get(id);
      if (bus.status === 'active' && !operatingByBus.has(id)) mismatches.push({ type: 'active_bus_without_operating_shift', busId: bus._id, busNumber: bus.busNumber });
      if (operatingByBus.has(id) && bus.status !== 'active') mismatches.push({ type: 'operating_shift_bus_not_active', busId: bus._id, busNumber: bus.busNumber });
      if (shift && !operatingByBus.has(id)) mismatches.push({ type: 'open_shift_assignment_mismatch', shiftId: shift._id, busId: bus._id, busNumber: bus.busNumber });
    }
    for (const shift of shifts) if (!buses.some(b => String(b._id) === String(shift.bus))) mismatches.push({ type: 'open_shift_missing_bus', shiftId: shift._id, busId: shift.bus });
    res.json({ checkedAt: new Date().toISOString(), count: mismatches.length, mismatches });
  } catch (error) { sendApiError(res, error, 'Could not check operating consistency.'); }
};

const getAdminBookings = async (req, res) => {
  try {
    const filter = {};
    if (['confirmed', 'boarded', 'no_show', 'cancelled', 'cancelled_by_service', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    if (['pending', 'paid', 'failed', 'cancelled'].includes(req.query.paymentStatus)) filter.paymentStatus = req.query.paymentStatus;
    const bookings = await Booking.find(filter)
      .populate('user', 'name email phone')
      .populate('bus', 'busNumber status availableSeats capacity')
      .populate('route', 'routeName startPoint endPoint')
      .populate('driver', 'name')
      .sort({ createdAt: -1 }).limit(500);
    res.status(200).json(bookings);
  } catch (err) {
    sendApiError(res, err, 'Could not load bookings.');
  }
};

const cancelAdminBookingAction = async (req, res) => {
  try {
    const result = await cancelAdminBooking(req.params.id);
    const io = req.app.get('io');
    const bus = result.booking?.bus;
    if (bus?._id && result.booking?.shift) {
      const seats = await Seat.find({ shift: result.booking.shift }).select('seatNumber status updatedAt').lean();
      io?.to(`bus:${bus._id}`).emit('seatStateUpdate', { busId: bus._id, shiftId: result.booking.shift, seats, capacity: seats.length, available: seats.filter(s=>s.status==='available').length, reserved: seats.filter(s=>s.status==='reserved').length, occupied: seats.filter(s=>s.status==='occupied').length });
    }
    if (result.locationStopped && result.booking?.driver?._id) {
      io?.to(`driver:${result.booking.driver._id}`).emit('passengerLocationUpdate', { bookingId: result.booking._id, passenger: { id: result.booking.user?._id, name: result.booking.user?.name || null }, sharing: false });
    }
    res.status(200).json({ message: 'Booking cancelled and seat released.', booking: result.booking });
  } catch (err) {
    sendApiError(res, err, 'Could not cancel booking.');
  }
};

const getCommuters = async (req, res) => {
  try {
    const users = await User.find({ role: 'commuter' }).select('_id name email phone createdAt').sort({ createdAt: -1 }).limit(500).lean();
    res.status(200).json(users);
  } catch (err) {
    sendApiError(res, err, 'Could not load passenger accounts.');
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
  getOperatingConsistency,
  getAdminBookings,
  cancelAdminBookingAction,
  getCommuters,
  updateCommuter,
};
