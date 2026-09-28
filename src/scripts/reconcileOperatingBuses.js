require('dotenv').config();
const mongoose = require('mongoose');
const Bus = require('../models/Bus');
const Booking = require('../models/Booking');
const Seat = require('../models/Seat');
const Shift = require('../models/Shift');
const User = require('../models/User');
const { isOperatingShift } = require('../services/operatingBusRules');
const { runInTransaction } = require('../services/transactionService');

const apply = process.argv.includes('--apply');
const staleHours = Math.max(1, Number(process.env.SHIFT_STALE_HOURS || 12));

async function closeShift(shift, reason) {
  await runInTransaction(async session => {
    const current = await Shift.findOne({ _id: shift._id, status: 'active', endedAt: null }).session(session);
    if (!current) return;
    current.status = 'completed'; current.endedAt = new Date(); await current.save({ session });
    await Bus.updateOne({ _id: current.bus, driver: current.driver, status: 'active' }, { $set: { status: 'idle' } }, { session });
    await Booking.updateMany({ shift: current._id, status: 'confirmed' }, { $set: { status: 'cancelled_by_service', paymentStatus: 'cancelled', locationSharingActive: false } }, { session });
    await Booking.updateMany({ shift: current._id, status: 'boarded' }, { $set: { status: 'completed', locationSharingActive: false } }, { session });
    await Seat.updateMany({ shift: current._id }, { $set: { status: 'available', booking: null } }, { session });
  });
  return reason;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured; no database was changed.');
  await mongoose.connect(process.env.MONGO_URI);
  const [buses, drivers, shifts] = await Promise.all([
    Bus.find({}).lean(),
    User.find({ role: 'driver' }).select('_id assignedBus').lean(),
    Shift.find({ status: 'active', endedAt: null }).populate('bus', 'busNumber route driver capacity status').populate('driver', 'role assignedBus').lean(),
  ]);
  const driverById = new Map(drivers.map(d => [String(d._id), d]));
  const current = new Date();
  const cutoff = new Date(current.getTime() - staleHours * 3600000);
  const issues = [];
  const keep = new Set();
  const usedBuses = new Set();
  const usedDrivers = new Set();
  const ordered = shifts.sort((a,b) => new Date(b.startedAt) - new Date(a.startedAt));

  for (const shift of ordered) {
    const busId = String(shift.bus?._id || shift.bus);
    const driverId = String(shift.driver?._id || shift.driver);
    const driver = driverById.get(driverId);
    const expired = new Date(shift.heartbeatAt || shift.startedAt) < cutoff;
    const valid = isOperatingShift({ ...shift, bus: shift.bus, driver: shift.driver }, shift.route);
    const duplicate = usedBuses.has(busId) || usedDrivers.has(driverId);
    const type = expired ? 'stale_open_shift' : duplicate ? 'duplicate_open_shift' : !valid ? 'open_shift_assignment_mismatch' : null;
    if (type) issues.push({ type, shiftId: shift._id, bus: shift.bus?.busNumber || busId, driverId, action: apply ? 'closed' : 'would close' });
    else { keep.add(String(shift._id)); usedBuses.add(busId); usedDrivers.add(driverId); }
    if (type && apply) await closeShift(shift, type);
  }

  const validBuses = new Set(ordered.filter(s => keep.has(String(s._id))).map(s => String(s.bus?._id || s.bus)));
  for (const bus of buses) {
    const id = String(bus._id);
    if (bus.status === 'active' && !validBuses.has(id)) {
      issues.push({ type: 'active_bus_without_operating_shift', busId: bus._id, busNumber: bus.busNumber, action: apply ? 'set idle' : 'would set idle' });
      if (apply) await Bus.updateOne({ _id: bus._id, status: 'active' }, { $set: { status: 'idle' } });
    } else if (validBuses.has(id) && bus.status !== 'active') {
      issues.push({ type: 'operating_shift_bus_not_active', busId: bus._id, busNumber: bus.busNumber, action: apply ? 'set active' : 'would set active' });
      if (apply) await Bus.updateOne({ _id: bus._id, status: bus.status }, { $set: { status: 'active' } });
    }
    if (apply) await Bus.updateOne({ _id: bus._id }, { $unset: { availableSeats: '' } });
  }

  for (const shift of ordered.filter(s => keep.has(String(s._id)))) {
    const bus = shift.bus;
    if (!bus) continue;
    const count = await Seat.countDocuments({ shift: shift._id });
    if (count < Number(bus.capacity)) {
      issues.push({ type: 'missing_shift_seats', shiftId: shift._id, busNumber: bus.busNumber, missing: Number(bus.capacity) - count, action: apply ? 'created' : 'would create' });
      if (apply) {
        const existing = new Set((await Seat.find({ shift: shift._id }).distinct('seatNumber')).map(String));
        const rows = Array.from({ length: Number(bus.capacity) }, (_, i) => String(i + 1)).filter(n => !existing.has(n)).map(seatNumber => ({ bus: bus._id, shift: shift._id, seatNumber, status: 'available' }));
        if (rows.length) await Seat.insertMany(rows, { ordered: false });
      }
    }
  }

  const activeByBus = new Map(ordered.filter(s => keep.has(String(s._id))).map(s => [String(s.bus?._id || s.bus), s]));
  const legacyBookings = await Booking.find({ status: 'confirmed', shift: null, seatNumber: { $ne: null } }).select('_id bus driver route seatNumber');
  for (const booking of legacyBookings) {
    const shift = activeByBus.get(String(booking.bus));
    if (!shift || String(shift.driver?._id || shift.driver) !== String(booking.driver) || String(shift.route) !== String(booking.route)) {
      issues.push({ type: 'active_booking_without_matching_shift', bookingId: booking._id, action: 'manual review required' });
      continue;
    }
    const seat = await Seat.findOne({ shift: shift._id, seatNumber: booking.seatNumber });
    if (!seat || seat.status !== 'available') {
      issues.push({ type: 'legacy_booking_seat_conflict', bookingId: booking._id, seatNumber: booking.seatNumber, action: 'manual review required' });
      continue;
    }
    issues.push({ type: 'legacy_booking_missing_shift_link', bookingId: booking._id, shiftId: shift._id, action: apply ? 'linked and reserved' : 'would link and reserve' });
    if (apply) await runInTransaction(async session => {
      const linked = await Booking.updateOne({ _id: booking._id, status: 'confirmed', shift: null }, { $set: { shift: shift._id } }, { session });
      if (linked.modifiedCount !== 1) return;
      const reserved = await Seat.updateOne({ _id: seat._id, status: 'available', booking: null }, { $set: { status: 'reserved', booking: booking._id } }, { session });
      if (reserved.modifiedCount !== 1) throw new Error(`Seat conflict while migrating booking ${booking._id}`);
    });
  }

  if (apply) {
    // Create the new protection indexes only after the open-shift cleanup above.
    await Promise.all([Shift.createIndexes(), Seat.createIndexes(), Booking.createIndexes()]);
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', checkedAt: current.toISOString(), staleHours, issueCount: issues.length, issues }, null, 2));
  await mongoose.disconnect();
}

main().catch(async error => { console.error(JSON.stringify({ message: error.message, stack: error.stack })); await mongoose.disconnect().catch(()=>{}); process.exitCode = 1; });
