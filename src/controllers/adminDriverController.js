const User = require('../models/User');
const { removeDriver } = require('../services/busAssignmentService');
const { ApiError, sendApiError } = require('../utils/apiError');
const { assertObjectId, validateAccountFields } = require('../utils/accountValidation');
const Shift = require('../models/Shift');
const { revokeUserSessions } = require('../services/authSessionService');

const SAFE_DRIVER_FIELDS = '_id name email phone role assignedBus isActive createdAt updatedAt';

function safeDriver(driver) {
  const record = { _id: driver._id, name: driver.name, email: driver.email, role: driver.role, assignedBus: driver.assignedBus, isActive: driver.isActive !== false, createdAt: driver.createdAt, updatedAt: driver.updatedAt };
  if (driver.phone !== undefined) record.phone = driver.phone;
  return record;
}

const getDrivers = async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).select(SAFE_DRIVER_FIELDS).sort({ name: 1, _id: 1 }).lean();
    res.status(200).json(drivers);
  } catch (error) {
    sendApiError(res, error, 'Server error fetching drivers');
  }
};

const createDriver = async (req, res) => {
  try {
    const fields = validateAccountFields(req.body, { create: true });
    if (await User.exists({ email: fields.email })) throw new ApiError(409, 'A user with this email already exists.');
    // User.create uses the existing bcrypt pre-save hook. No driver JWT is
    // issued here, so creating an account cannot replace the admin session.
    const driver = await User.create({ ...fields, role: 'driver', assignedBus: null });
    res.status(201).json(safeDriver(driver));
  } catch (error) {
    sendApiError(res, error, 'Server error creating driver', 'A user with this email already exists.');
  }
};

const updateDriver = async (req, res) => {
  try {
    assertObjectId(req.params.id, 'Driver ID');
    const fields = validateAccountFields(req.body);
    const driver = await User.findOneAndUpdate({ _id: req.params.id, role: 'driver' }, { $set: fields }, { new: true, runValidators: true }).select(SAFE_DRIVER_FIELDS);
    if (!driver) throw new ApiError(404, 'Driver not found.');
    res.status(200).json(safeDriver(driver));
  } catch (error) {
    sendApiError(res, error, 'Server error updating driver', 'A user with this email already exists.');
  }
};

const deleteDriver = async (req, res) => {
  try {
    await removeDriver(req.params.id);
    res.status(200).json({ message: 'Driver deleted' });
  } catch (error) {
    sendApiError(res, error, 'Server error deleting driver');
  }
};

const resetDriverPassword = async (req, res) => {
  try {
    assertObjectId(req.params.id, 'Driver ID');
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).some((key) => key !== 'newPassword')) throw new ApiError(400, 'Provide only a newPassword field.');
    if (typeof req.body.newPassword !== 'string' || req.body.newPassword.length < 6) throw new ApiError(400, 'Password must contain at least 6 characters.');
    const driver = await User.findOne({ _id: req.params.id, role: 'driver' });
    if (!driver) throw new ApiError(404, 'Driver not found.');
    driver.password = req.body.newPassword;
    await driver.save();
    await revokeUserSessions(driver._id);
    res.status(204).end();
  } catch (error) { sendApiError(res, error, 'Could not reset driver password.'); }
};

const setDriverStatus = async (req, res) => {
  try {
    assertObjectId(req.params.id, 'Driver ID');
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length !== 1 || typeof req.body.active !== 'boolean') throw new ApiError(400, 'Provide active as true or false.');
    const driver = await User.findOne({ _id: req.params.id, role: 'driver' });
    if (!driver) throw new ApiError(404, 'Driver not found.');
    if (!req.body.active) {
      const openShift = await Shift.exists({ driver: driver._id, status: 'active', endedAt: null });
      if (openShift) throw new ApiError(409, 'End the driver’s active shift before disabling this account.', 'SHIFT_OPEN');
    }
    driver.isActive = req.body.active;
    await driver.save();
    if (!req.body.active) await revokeUserSessions(driver._id);
    res.status(200).json(safeDriver(driver));
  } catch (error) { sendApiError(res, error, 'Could not update driver status.'); }
};

module.exports = { getDrivers, createDriver, updateDriver, deleteDriver, resetDriverPassword, setDriverStatus };
