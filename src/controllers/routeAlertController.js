const RouteAlert = require('../models/RouteAlert');

// @route   POST /api/route-alerts
const createRouteAlert = async (req, res) => {
  try {
    const { route, message, expiresAt } = req.body;

    if (!route || !message) {
      return res.status(400).json({ message: 'route and message are required' });
    }

    const alert = await RouteAlert.create({ route, message, expiresAt: expiresAt || null });
    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ message: 'Server error creating route alert', error: err.message });
  }
};

// @route   GET /api/route-alerts/route/:routeId
const getAlertsByRoute = async (req, res) => {
  try {
    const now = new Date();
    const alerts = await RouteAlert.find({
      route: req.params.routeId,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).sort({ createdAt: -1 });

    res.status(200).json(alerts);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching route alerts', error: err.message });
  }
};

// @route   DELETE /api/route-alerts/:id
const deleteRouteAlert = async (req, res) => {
  try {
    const alert = await RouteAlert.findByIdAndDelete(req.params.id);
    if (!alert) {
      return res.status(404).json({ message: 'Route alert not found' });
    }
    res.status(200).json({ message: 'Route alert deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error deleting route alert', error: err.message });
  }
};

module.exports = { createRouteAlert, getAlertsByRoute, deleteRouteAlert };