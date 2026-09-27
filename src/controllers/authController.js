const { randomBytes } = require('crypto');
const User = require('../models/User');
const Shift = require('../models/Shift');
const generateToken = require('../utils/generateToken');
const { ApiError, sendApiError } = require('../utils/apiError');
const { requireObjectBody, validateAccountFields } = require('../utils/accountValidation');

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
    const token = generateToken(newUser._id, newUser.role);
    res.status(201).json({ _id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role, token });
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
    if (!foundUser) throw new ApiError(400, 'User not found');
    if (!(await foundUser.matchPassword(password))) throw new ApiError(400, 'Invalid credentials');
    const token = generateToken(foundUser._id, foundUser.role);
    res.status(200).json({ _id: foundUser._id, name: foundUser.name, email: foundUser.email, role: foundUser.role, token });
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
    const token = generateToken(user._id, user.role);
    return res.status(200).json({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
  } catch (error) {
    return sendApiError(res, error, 'Could not start local test session');
  }
};

// @route   GET /api/auth/profile
// @access  Private (current authenticated user, without password)
const getMe = async (req, res) => {
  try {
    const activeShift = req.user.role === 'driver'
      ? await Shift.findOne({ driver: req.user._id, status: 'active' })
        .populate('bus', 'busNumber status direction currentStopIndex route')
        .populate('route', 'routeName startPoint endPoint')
        .lean()
      : null;
    res.status(200).json({ ...req.user.toObject(), activeShift });
  } catch (error) {
    sendApiError(res, error, 'Server error fetching profile');
  }
};

module.exports = { registerUser, loginUser, devLogin, getMe };
