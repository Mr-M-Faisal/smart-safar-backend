const Shift = require('../models/Shift');
const Bus = require('../models/Bus');
const User = require('../models/User');
const Seat = require('../models/Seat');
const { isOperatingShift } = require('./operatingBusRules');

// The only definition of operating service: an unended active shift whose
// route, bus, driver, and driver's assignedBus all still agree.
async function getOperatingBusesForRoute(routeId, session = null) {
  const query = Shift.find({ route: routeId, status: 'active', endedAt: null })
    .populate('bus', 'busNumber route driver capacity status currentLocation lastLocationUpdate direction currentStopIndex recentSpeeds')
    .populate('driver', 'name role assignedBus')
    .sort({ startedAt: 1, _id: 1 });
  if (session) query.session(session);
  const shifts = await query.lean();
  const operating = shifts.filter(shift => isOperatingShift(shift, routeId));
  if (operating.length === 0) return [];

  const shiftIds = operating.map(shift => shift._id);
  const aggQuery = Seat.aggregate([
    { $match: { shift: { $in: shiftIds }, status: 'available' } },
    { $group: { _id: '$shift', availableCount: { $sum: 1 } } },
  ]);
  if (session) aggQuery.session(session);
  const seatCounts = await aggQuery;
  const countMap = new Map(seatCounts.map(item => [String(item._id), item.availableCount]));

  return operating.map(shift => {
    const availableSeats = countMap.get(String(shift._id)) || 0;
    return { ...shift.bus, shiftId: shift._id, shiftStartedAt: shift.startedAt, driver: shift.driver, shiftActive: true, operating: true, availableSeats };
  });
}

async function getOperatingBusForDriver(driverId, session = null) {
  const assignedQuery = User.findOne({ _id: driverId, role: 'driver' }).select('assignedBus');
  if (session) assignedQuery.session(session);
  const driver = await assignedQuery;
  if (!driver?.assignedBus) return null;
  const busQuery = Bus.findOne({ _id: driver.assignedBus, driver: driver._id });
  if (session) busQuery.session(session);
  const bus = await busQuery;
  if (!bus?.route) return null;
  const buses = await getOperatingBusesForRoute(bus.route, session);
  return buses.find(item => String(item._id) === String(bus._id)) || null;
}

module.exports = { getOperatingBusesForRoute, getOperatingBusForDriver };
