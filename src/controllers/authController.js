const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Shift = require('../models/Shift');
const { getOperatingBusForDriver } = require('../services/operatingBusService');
const { createSession, rotateSession, revokeSession } = require('../services/authSessionService');
const { ApiError, sendApiError } = require('../utils/apiError');
const { requireObjectBody, validateAccountFields } = require('../utils/accountValidation');

const dummyPasswordHash = bcrypt.hashSync('smart-safar-invalid-account-password', 10);

// @route   POST /api/auth/register
// @access  Public (commuter accounts only)
const registerUser = async (req, res) => {
  try {
    requireObjectBody(req.body);
    const { name, email, password, phone, role } = req.body;
    if (role !== undefined && role !== 'commuter') {
      throw new ApiError(400, 'Public registration is available for commuter accounts only.');
    }
    const fields = validateAccountFields({ name, email, password, ...(phone === undefined ? {} : { phone }) }, { create: true });
    if (await User.exists({ email: fields.email })) throw new ApiError(400, 'User already exists');
    // Password hashing remains in User's existing pre-save hook. Public callers
    // cannot provision privileged roles or set a profile assignment.
    const newUser = await User.create({ ...fields, role: 'commuter', assignedBus: null });
    const session = await createSession(newUser);
    res.status(201).json({ _id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role, ...session });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'User already exists' });
    sendApiError(res, error, 'Server error');
  }
};

// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    requireObjectBody(req.body);
    const { email, password } = req.body;
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      throw new ApiError(400, 'Please provide all required fields');
    }
    const foundUser = await User.findOne({ email: email.trim().toLowerCase() });
    const passwordMatches = foundUser
      ? await foundUser.matchPassword(password)
      : await bcrypt.compare(password, dummyPasswordHash);
    if (!foundUser || !passwordMatches) throw new ApiError(401, 'Invalid email or password.');
    const session = await createSession(foundUser);
    res.status(200).json({ _id: foundUser._id, name: foundUser.name, email: foundUser.email, role: foundUser.role, ...session });
  } catch (error) {
    sendApiError(res, error, 'Server error');
  }
};

// @route   POST /api/auth/dev-login
// @access  Local development only (requires explicit opt-in)
const devLogin = async (req, res) => {
  if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_LOCAL_TEST_LOGIN !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }
  try {
    requireObjectBody(req.body);
    const { role } = req.body;
    if (!['driver', 'admin'].includes(role)) throw new ApiError(400, 'Choose a valid test workspace');

    const email = `local-demo-${role}@smartsafar.invalid`;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name: role === 'admin' ? 'Local Demo Administrator' : 'Local Demo Driver',
        email,
        password: randomBytes(32).toString('hex'),
        role,
        assignedBus: null,
      });
    }
    if (user.role !== role) throw new ApiError(403, 'Test account role mismatch');
    const session = await createSession(user);
    return res.status(200).json({ _id: user._id, name: user.name, email: user.email, role: user.role, ...session });
  } catch (error) {
    return sendApiError(res, error, 'Could not start local test session');
  }
};

// @route   GET /api/auth/profile
// @access  Private (current authenticated user, without password)
const getMe = async (req, res) => {
  try {
    const currentBus = req.user.role === 'driver' ? await getOperatingBusForDriver(req.user._id) : null;
    const activeShift = currentBus?.shiftId
      ? await Shift.findOne({ _id: currentBus.shiftId, driver: req.user._id, bus: currentBus._id, status: 'active', endedAt: null })
        .populate('bus', 'busNumber status direction currentStopIndex route capacity')
        .populate('route', 'routeName startPoint endPoint')
        .lean()
      : null;
    res.status(200).json({ ...req.user.toObject(), activeShift });
  } catch (error) {
    sendApiError(res, error, 'Server error fetching profile');
  }
};

const refreshSession = async (req, res) => {
  try {
    const session = await rotateSession(req.body?.refreshToken);
    if (!session) return res.status(401).json({ message: 'Refresh session is invalid or expired.', code: 'REFRESH_REJECTED' });
    res.status(200).json(session);
  } catch (error) { sendApiError(res, error, 'Could not refresh session.'); }
};

const logout = async (req, res) => {
  try { await revokeSession(req.body?.refreshToken); res.status(204).end(); }
  catch (error) { sendApiError(res, error, 'Could not revoke session.'); }
};

module.exports = { registerUser, loginUser, devLogin, getMe, refreshSession, logout };
