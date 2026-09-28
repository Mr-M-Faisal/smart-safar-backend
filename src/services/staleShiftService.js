const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const Shift = require('../models/Shift');
const { runInTransaction } = require('./transactionService');

const configuredHours = () => Math.max(1, Number(process.env.SHIFT_STALE_HOURS || 12));

async function closeStaleShifts(io, now = new Date()) {
  const cutoff = new Date(now.getTime() - configuredHours() * 60 * 60 * 1000);
  const staleFilter = { status: 'active', endedAt: null, $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: { $exists: false }, startedAt: { $lt: cutoff } }] };
  const stale = await Shift.find(staleFilter).select('_id bus driver route');
  for (const candidate of stale) {
    const passengerIds = await Booking.find({ shift: candidate._id, status: 'confirmed' }).distinct('user');
    await runInTransaction(async session => {
      const shift = await Shift.findOne({ _id: candidate._id, ...staleFilter }).session(session);
      if (!shift) return;
      shift.status = 'completed';
      shift.endedAt = now;
      await shift.save({ session });
      await Bus.updateOne({ _id: shift.bus, driver: shift.driver }, { $set: { status: 'idle' } }, { session });
      await Booking.updateMany({ shift: shift._id, status: 'confirmed' }, { $set: { status: 'cancelled_by_service', paymentStatus: 'cancelled', locationSharingActive: false } }, { session });
      await Booking.updateMany({ shift: shift._id, status: 'boarded' }, { $set: { status: 'completed', locationSharingActive: false } }, { session });
      await Seat.updateMany({ shift: shift._id }, { $set: { status: 'available', booking: null } }, { session });
    });
    for (const userId of passengerIds) io?.to(`passenger:${userId}`).emit('bookingStatusUpdate', { status: 'cancelled_by_service', message: 'Your booking was cancelled because the driver shift ended.' });
    io?.to(`bus:${candidate.bus}`).emit('seatStateUpdate', { busId: candidate.bus, shiftId: candidate._id, seats: [], capacity: 0, available: 0, reserved: 0, occupied: 0 });
  }
  return stale.length;
}

module.exports = { closeStaleShifts, configuredHours };
