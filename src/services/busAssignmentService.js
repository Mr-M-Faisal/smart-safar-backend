const Bus = require('../models/Bus');
const User = require('../models/User');
const { ApiError } = require('../utils/apiError');
const { assertObjectId, requireObjectBody } = require('../utils/accountValidation');
const { runInTransaction } = require('./transactionService');

const BUS_FIELDS = ['busNumber', 'route', 'driver', 'capacity', 'availableSeats', 'currentLocation', 'lastLocationUpdate', 'status', 'trustScore', 'currentStopIndex', 'recentSpeeds'];

function busUpdates(body) {
  requireObjectBody(body);
  if (Object.keys(body).some((key) => !BUS_FIELDS.includes(key))) {
    throw new ApiError(400, 'Only editable bus fields can be provided.');
  }
  return body;
}

async function setDriver(bus, driverId, session) {
  let driver = null;
  if (driverId !== null) {
    assertObjectId(driverId, 'Driver ID');
    driver = await User.findById(driverId).select('_id role assignedBus').session(session);
    if (!driver) throw new ApiError(404, 'Driver not found.');
    if (driver.role !== 'driver') throw new ApiError(400, 'The selected user is not a driver.');
    if (driver.assignedBus && !driver.assignedBus.equals(bus._id)) {
      throw new ApiError(409, 'This driver is already assigned to another bus. Unassign that bus first.');
    }
    // Also detect legacy fleet links where assignedBus was never synchronized.
    const otherBus = await Bus.findOne({ driver: driver._id, _id: { $ne: bus._id } }).select('_id').session(session);
    if (otherBus) throw new ApiError(409, 'This driver is already referenced by another bus. Unassign that bus first.');
  }

  // Clear the previous profile and any legacy claims to this bus, preserving
  // profiles that point elsewhere. Never clear another valid bus assignment.
  const previousProfiles = { assignedBus: bus._id };
  if (driver) previousProfiles._id = { $ne: driver._id };
  await User.updateMany(previousProfiles, { $set: { assignedBus: null } }, { session });
  if (driver) {
    // This write also serializes concurrent assignments of the same driver.
    await User.updateOne({ _id: driver._id, role: 'driver' }, { $set: { assignedBus: bus._id } }, { session });
  }
  bus.driver = driver ? driver._id : null;
  // Force a bus write even for a repeated assignment so concurrent requests
  // on the same bus participate in MongoDB's write-conflict detection.
  bus.markModified('driver');
}

async function createFleetBus(body) {
  requireObjectBody(body);
  const { busNumber, route, capacity, driver } = body;
  if (!busNumber || !route || capacity == null) throw new ApiError(400, 'busNumber, route, and capacity are required');
  assertObjectId(route, 'Route ID');
  return runInTransaction(async (session) => {
    const bus = new Bus({ busNumber, route, capacity, availableSeats: capacity });
    await setDriver(bus, driver === undefined || driver === '' ? null : driver, session);
    await bus.save({ session });
    return bus;
  });
}

async function updateFleetBus(id, body) {
  assertObjectId(id, 'Bus ID');
  const updates = busUpdates(body);
  if (!Object.hasOwn(updates, 'driver')) {
    const bus = await Bus.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    if (!bus) throw new ApiError(404, 'Bus not found.');
    return bus;
  }
  return runInTransaction(async (session) => {
    const bus = await Bus.findById(id).session(session);
    if (!bus) throw new ApiError(404, 'Bus not found.');
    const { driver, ...fields } = updates;
    bus.set(fields);
    await setDriver(bus, driver, session);
    await bus.save({ session });
    return bus;
  });
}

async function deleteFleetBus(id) {
  assertObjectId(id, 'Bus ID');
  return runInTransaction(async (session) => {
    const bus = await Bus.findById(id).select('_id').session(session);
    if (!bus) throw new ApiError(404, 'Bus not found.');
    await User.updateMany({ assignedBus: bus._id }, { $set: { assignedBus: null } }, { session });
    await Bus.deleteOne({ _id: bus._id }, { session });
  });
}

async function removeDriver(id) {
  assertObjectId(id, 'Driver ID');
  return runInTransaction(async (session) => {
    const driver = await User.findOne({ _id: id, role: 'driver' }).select('_id').session(session);
    if (!driver) throw new ApiError(404, 'Driver not found.');
    const buses = await Bus.find({ driver: driver._id }).select('_id').session(session);
    if (buses.length) {
      await User.updateMany({ assignedBus: { $in: buses.map((bus) => bus._id) } }, { $set: { assignedBus: null } }, { session });
    }
    await Bus.updateMany({ driver: driver._id }, { $set: { driver: null } }, { session });
    await User.deleteOne({ _id: driver._id, role: 'driver' }, { session });
  });
}

module.exports = { createFleetBus, updateFleetBus, deleteFleetBus, removeDriver };
