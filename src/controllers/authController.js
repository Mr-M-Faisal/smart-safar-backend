const { randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Shift = require('../models/Shift');
const { getOperatingBusForDriver } = require('../services/operatingBusService');
const { createSession, rotateSession, revokeSession, revokeUserSessions } = require('../services/authSessionService');
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
    if (foundUser.isActive === false) throw new ApiError(403, 'This account has been disabled. Contact an administrator.', 'ACCOUNT_DISABLED');
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
    if (user.isActive === false) throw new ApiError(403, 'This account has been disabled. Contact an administrator.', 'ACCOUNT_DISABLED');
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
    res.status(200).json(await profileShape(req.user));
  } catch (error) {
    sendApiError(res, error, 'Server error fetching profile');
  }
};

async function profileShape(user) {
  const currentBus = user.role === 'driver' ? await getOperatingBusForDriver(user._id) : null;
  const activeShift = currentBus?.shiftId
    ? await Shift.findOne({ _id: currentBus.shiftId, driver: user._id, bus: currentBus._id, status: 'active', endedAt: null })
      .populate('bus', 'busNumber status direction currentStopIndex route capacity')
      .populate('route', 'routeName startPoint endPoint')
      .lean()
    : null;
  const profile = user.toObject();
  const connectedGoogle = Boolean(profile.googleId);
  delete profile.googleId;
  delete profile.password;
  return { ...profile, connectedGoogle, activeShift };
}

const updateProfile = async (req, res) => {
  try {
    const fields = validateAccountFields(req.body);
    if (Object.hasOwn(fields, 'email')) throw new ApiError(400, 'Email address is read-only.');
    const user = await User.findById(req.user._id).select('-password +googleId');
    if (!user) throw new ApiError(404, 'Account not found.');
    Object.assign(user, fields);
    await user.save();
    res.status(200).json(await profileShape(user));
  } catch (error) { sendApiError(res, error, 'Could not update profile.'); }
};

const changePassword = async (req, res) => {
  try {
    requireObjectBody(req.body);
    if (Object.keys(req.body).some((key) => !['currentPassword', 'newPassword'].includes(key))) {
      throw new ApiError(400, 'Provide only your currentPassword and newPassword.');
    }
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) throw new ApiError(400, 'Enter your current and new password.');
    if (newPassword.length < 6) throw new ApiError(400, 'New password must contain at least 6 characters.');
    const user = await User.findById(req.user._id).select('+password +googleId');
    if (!user) throw new ApiError(404, 'Account not found.');
    if (user.googleId || !user.password) throw new ApiError(400, 'This account signs in with Google and cannot use a password.', 'PASSWORD_LOGIN_UNAVAILABLE');
    if (!await user.matchPassword(currentPassword)) throw new ApiError(400, 'Your current password is incorrect.', 'CURRENT_PASSWORD_INCORRECT');
    if (await user.matchPassword(newPassword)) throw new ApiError(400, 'Choose a new password different from the current one.', 'PASSWORD_UNCHANGED');
    user.password = newPassword;
    await user.save();
    const session = await createSession(user);
    const claims = require('jsonwebtoken').verify(session.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    await revokeUserSessions(user._id, claims.sid);
    res.status(200).json({ ...session, profile: await profileShape(user) });
  } catch (error) { sendApiError(res, error, 'Could not change password.'); }
};

const refreshSession = async (req, res) => {
  try {
    const session = await rotateSession(req.body?.refreshToken);
    if (session?.disabled) return res.status(403).json({ message: 'This account has been disabled. Contact an administrator.', code: 'ACCOUNT_DISABLED' });
    if (!session) return res.status(401).json({ message: 'Refresh session is invalid or expired.', code: 'REFRESH_REJECTED' });
    res.status(200).json(session);
  } catch (error) { sendApiError(res, error, 'Could not refresh session.'); }
};

const logout = async (req, res) => {
  try { await revokeSession(req.body?.refreshToken); res.status(204).end(); }
  catch (error) { sendApiError(res, error, 'Could not revoke session.'); }
};

module.exports = { registerUser, loginUser, devLogin, getMe, updateProfile, changePassword, refreshSession, logout };
