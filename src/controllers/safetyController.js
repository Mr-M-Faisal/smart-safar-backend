const SafetySession = require('../models/SafetySession');
const Bus = require('../models/Bus');

// @route   POST /api/safety/sessions
// @desc    Start sharing a live trip (generates a shareable link)
// @access  Private (any logged-in user)
const startSession = async (req, res) => {
  try {
    const { bus } = req.body;
    const userId = req.user._id;

    if (!bus) {
      return res.status(400).json({ message: 'bus is required' });
    }

    const busExists = await Bus.findById(bus);
    if (!busExists) {
      return res.status(404).json({ message: 'Bus not found' });
    }

    const session = await SafetySession.create({ user: userId, bus });

    res.status(201).json({
      _id: session._id,
      shareToken: session.shareToken,
      isActive: session.isActive,
      startedAt: session.startedAt,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error starting safety session', error: err.message });
  }
};

// @route   GET /api/safety/track/:shareToken
// @desc    View a shared trip's live info — NO LOGIN REQUIRED.
//          This is what a trusted contact opens from the shared link.
// @access  Public
const trackSession = async (req, res) => {
  try {
    const session = await SafetySession.findOne({ shareToken: req.params.shareToken })
      .populate('user', 'name phone')
      .populate({
        path: 'bus',
        select: 'busNumber currentLocation lastLocationUpdate route status',
        populate: { path: 'route', select: 'routeName' },
      });

    if (!session) {
      return res.status(404).json({ message: 'Tracking link not found or invalid' });
    }

    if (!session.isActive) {
      return res.status(410).json({ message: 'This trip has ended and is no longer being shared' });
    }

    res.status(200).json({
      passenger: session.user.name,
      bus: session.bus,
      startedAt: session.startedAt,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching shared trip', error: err.message });
  }
};

// @route   PATCH /api/safety/sessions/:id/end
// @desc    End a safety session (stops sharing)
// @access  Private (only the passenger who started it)
const endSession = async (req, res) => {
  try {
    const session = await SafetySession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (session.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to end this session' });
    }

    session.isActive = false;
    session.endedAt = new Date();
    await session.save();

    res.status(200).json({ message: 'Trip sharing ended', session });
  } catch (err) {
    res.status(500).json({ message: 'Server error ending safety session', error: err.message });
  }
};

// @route   GET /api/safety/sessions/me
// @desc    Get the logged-in user's own safety sessions (history)
// @access  Private
const getMySessions = async (req, res) => {
  try {
    const sessions = await SafetySession.find({ user: req.user._id })
      .populate('bus', 'busNumber')
      .sort({ createdAt: -1 });
    res.status(200).json(sessions);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching sessions', error: err.message });
  }
};

module.exports = { startSession, trackSession, endSession, getMySessions };