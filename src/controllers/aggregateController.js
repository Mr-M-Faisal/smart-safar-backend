const Booking = require('../models/Booking');
const RouteAlert = require('../models/RouteAlert');
const SafetySession = require('../models/SafetySession');
const Route = require('../models/Route');
const { getRoutesOverviewData } = require('../services/routeOverviewService');
const { sendApiError } = require('../utils/apiError');

async function getAdminRoutesWithDetails(_req, res) {
  try {
    const now = new Date();
    const routes = await Route.aggregate([
      { $match: { isActive: true } }, { $sort: { createdAt: -1 } },
      { $lookup: { from: 'stops', localField: '_id', foreignField: 'route', pipeline: [{ $sort: { stopOrder: 1 } }], as: 'stops' } },
      { $lookup: { from: 'routealerts', let: { routeId: '$_id' }, pipeline: [{ $match: { $expr: { $and: [ { $eq: ['$route', '$$routeId'] }, { $or: [ { $eq: ['$expiresAt', null] }, { $gt: ['$expiresAt', now] } ] } ] } } }, { $sort: { createdAt: -1 } }], as: 'alerts' } },
      { $project: { _id: 1, routeName: 1, startPoint: 1, endPoint: 1, description: 1, isActive: 1, stops: 1, alerts: 1 } },
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(routes);
  } catch (error) { return sendApiError(res, error, 'Could not load route details.'); }
}

async function getPassengerBootstrap(req, res) {
  try {
    const [routes, bookings, safetySessions, routeAlerts] = await Promise.all([
      getRoutesOverviewData(),
      Booking.find({ user: req.user._id }).populate('bus', 'busNumber route status capacity currentLocation lastLocationUpdate').populate('route', 'routeName startPoint endPoint').populate('driver', 'name').sort({ createdAt: -1 }).lean(),
      SafetySession.find({ user: req.user._id }).populate('bus', 'busNumber').sort({ createdAt: -1 }).lean(),
      RouteAlert.find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).lean(),
    ]);
    const activeBookings = bookings.filter((booking) => ['confirmed', 'boarded'].includes(booking.status));
    const unreadAlerts = routeAlerts.length; // Alerts have no per-user read receipt yet.
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      profile: req.user,
      activeBookings,
      routeAlerts,
      unreadAlerts,
      bookings,
      safetySessions,
      routes,
      buses: routes.flatMap((route) => route.buses || []),
    });
  } catch (error) { return sendApiError(res, error, 'Could not load passenger data.'); }
}

module.exports = { getAdminRoutesWithDetails, getPassengerBootstrap };
