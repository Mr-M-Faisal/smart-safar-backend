const Stop = require('../models/Stop');

// @route   POST /api/stops
const createStop = async (req, res) => {
  try {
    const { route, stopName, latitude, longitude, stopOrder } = req.body;

    if (!route || !stopName || latitude == null || longitude == null || stopOrder == null) {
      return res.status(400).json({ message: 'route, stopName, latitude, longitude, and stopOrder are required' });
    }

    const stop = await Stop.create({ route, stopName, latitude, longitude, stopOrder });
    res.status(201).json(stop);
  } catch (err) {
    res.status(500).json({ message: 'Server error creating stop', error: err.message });
  }
};

// @route   GET /api/stops/route/:routeId
const getStopsByRoute = async (req, res) => {
  try {
    const stops = await Stop.find({ route: req.params.routeId }).sort({ stopOrder: 1 });
    res.status(200).json(stops);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching stops', error: err.message });
  }
};

// @route   GET /api/stops/:id
const getStopById = async (req, res) => {
  try {
    const stop = await Stop.findById(req.params.id).populate('route', 'routeName');
    if (!stop) {
      return res.status(404).json({ message: 'Stop not found' });
    }
    res.status(200).json(stop);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching stop', error: err.message });
  }
};

// @route   PUT /api/stops/:id
const updateStop = async (req, res) => {
  try {
    const stop = await Stop.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!stop) {
      return res.status(404).json({ message: 'Stop not found' });
    }
    res.status(200).json(stop);
  } catch (err) {
    res.status(500).json({ message: 'Server error updating stop', error: err.message });
  }
};

// @route   DELETE /api/stops/:id
const deleteStop = async (req, res) => {
  try {
    const stop = await Stop.findByIdAndDelete(req.params.id);
    if (!stop) {
      return res.status(404).json({ message: 'Stop not found' });
    }
    res.status(200).json({ message: 'Stop deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error deleting stop', error: err.message });
  }
};

module.exports = { createStop, getStopsByRoute, getStopById, updateStop, deleteStop };