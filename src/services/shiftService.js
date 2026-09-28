const User = require('../models/User');
const Bus = require('../models/Bus');
const Shift = require('../models/Shift');
const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const { ApiError } = require('../utils/apiError');
const { runInTransaction } = require('./transactionService');

function sameId(left, right) {
  return left && right && left.toString() === right.toString();
}

function populatedShift(id) {
  return Shift.findById(id)
    .populate('driver', 'name email phone')
    .populate('bus', 'busNumber status direction currentStopIndex route currentLocation lastLocationUpdate')
    .populate('route', 'routeName startPoint endPoint');
}

async function startDriverShift(driverId) {
  try {
    const shiftId = await runInTransaction(async (session) => {
      const driver = await User.findOne({ _id: driverId, role: 'driver' }).select('assignedBus').session(session);
      if (!driver) throw new ApiError(403, 'Forbidden: driver access is required.');
      if (!driver.assignedBus) throw new ApiError(400, 'No bus assigned.');

      const bus = await Bus.findById(driver.assignedBus).session(session);
      if (!bus) throw new ApiError(404, 'Assigned bus not found.');
      if (!sameId(bus.driver, driver._id)) throw new ApiError(403, 'Forbidden: this bus is not assigned to you.');
      if (!bus.route) throw new ApiError(400, 'No route assigned.');
      if (bus.status === 'maintenance') throw new ApiError(409, 'This bus is under maintenance and cannot start a shift.');

      const activeShift = await Shift.findOne({
        status: 'active',
        endedAt: null,
        $or: [{ driver: driver._id }, { bus: bus._id }],
      }).session(session);
      if (activeShift) throw new ApiError(409, 'An active shift already exists for this driver or bus.');

      // A new operational cycle always begins in the stored outbound order.
      bus.status = 'active';
      bus.direction = 'outbound';
      bus.currentStopIndex = 0;
      await bus.save({ session });

      const [shift] = await Shift.create([{
        driver: driver._id,
        bus: bus._id,
        route: bus.route,
        status: 'active',
        startDirection: bus.direction,
        startedAt: new Date(),
      }], { session });
      await Seat.insertMany(Array.from({ length: bus.capacity }, (_, index) => ({ bus: bus._id, shift: shift._id, seatNumber: String(index + 1), status: 'available' })), { session });

      return shift._id;
    });

    return populatedShift(shiftId);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'An active shift already exists for this driver or bus.');
    throw error;
  }
}

async function endDriverShift(driverId) {
  const ending = await runInTransaction(async (session) => {
    const driver = await User.findOne({ _id: driverId, role: 'driver' }).select('assignedBus').session(session);
    if (!driver) throw new ApiError(403, 'Forbidden: driver access is required.');
    if (!driver.assignedBus) throw new ApiError(400, 'No bus assigned.');

    const bus = await Bus.findById(driver.assignedBus).session(session);
    if (!bus) throw new ApiError(404, 'Assigned bus not found.');
    if (!sameId(bus.driver, driver._id)) throw new ApiError(403, 'Forbidden: this bus is not assigned to you.');

    const shift = await Shift.findOne({ driver: driver._id, bus: bus._id, status: 'active', endedAt: null }).session(session);
    if (!shift) {
      const previous = await Shift.findOne({ driver: driver._id, bus: bus._id, status: 'completed' }).sort({ endedAt: -1 }).session(session);
      if (previous) return { shiftId: previous._id, cancelledPassengerIds: [] };
      throw new ApiError(409, 'No active shift found.');
    }

    const cancelledPassengerIds = await Booking.find({ shift: shift._id, status: 'confirmed' }).distinct('user').session(session);
    shift.status = 'completed';
    shift.endedAt = new Date();
    bus.status = 'idle';
    await shift.save({ session });
    await bus.save({ session });
    await Booking.updateMany({ shift: shift._id, status: 'confirmed' }, { $set: { status: 'cancelled_by_service', locationSharingActive: false, paymentStatus: 'cancelled' } }, { session });
    await Booking.updateMany({ shift: shift._id, status: 'boarded' }, { $set: { status: 'completed', locationSharingActive: false } }, { session });
    await Booking.updateMany(
      {
        driver: driver._id,
        bus: bus._id,
        route: shift.route,
        status: { $in: ['confirmed', 'boarded'] },
        locationSharingActive: true,
      },
      { $set: { locationSharingActive: false } },
      { session }
    );
    await Seat.updateMany({ shift: shift._id }, { $set: { status: 'available', booking: null } }, { session });
    return { shiftId: shift._id, cancelledPassengerIds };
  });

  return { shift: await populatedShift(ending.shiftId), cancelledPassengerIds: ending.cancelledPassengerIds };
}

module.exports = { startDriverShift, endDriverShift };
