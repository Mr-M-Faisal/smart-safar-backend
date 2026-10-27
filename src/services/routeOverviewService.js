const Route = require('../models/Route');
const { haversineDistanceKm } = require('../utils/geo');

const routeOverviewPipeline = [
  { $match: { isActive: true } },
  { $sort: { createdAt: -1 } },
  { $lookup: {
    from: 'stops',
    localField: '_id',
    foreignField: 'route',
    pipeline: [{ $sort: { stopOrder: 1, _id: 1 } }, { $project: { stopName: 1, latitude: 1, longitude: 1, stopOrder: 1 } }],
    as: 'stops',
  } },
  { $lookup: {
    from: 'buses',
    let: { routeId: '$_id', routeName: '$routeName' },
    pipeline: [
      { $match: { $expr: { $eq: ['$route', '$$routeId'] } } },
      { $lookup: {
        from: 'shifts',
        let: { busId: '$_id', routeId: '$route' , driverId: '$driver' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$bus', '$$busId'] }, { $eq: ['$route', '$$routeId'] },
            { $eq: ['$driver', '$$driverId'] }, { $eq: ['$status', 'active'] }, { $eq: ['$endedAt', null] },
          ] } } },
          { $lookup: {
            from: 'users',
            let: { driverId: '$driver', busId: '$bus' },
            pipeline: [{ $match: { $expr: { $and: [ { $eq: ['$_id', '$$driverId'] }, { $eq: ['$assignedBus', '$$busId'] }, { $eq: ['$role', 'driver'] } ] } } }, { $project: { _id: 1 } }, { $limit: 1 }],
            as: 'validDriver',
          } },
          { $match: { $expr: { $gt: [{ $size: '$validDriver' }, 0] } } },
          { $project: { _id: 1, startedAt: 1 } }, { $limit: 1 },
        ],
        as: 'activeShift',
      } },
      { $addFields: { activeShift: { $arrayElemAt: ['$activeShift', 0] } } },
      { $addFields: { activeShiftId: { $ifNull: ['$activeShift._id', null] } } },
      { $lookup: {
        from: 'seats',
        let: { shiftId: '$activeShiftId' },
        pipeline: [
          { $match: { $expr: { $and: [ { $ne: ['$$shiftId', null] }, { $eq: ['$shift', '$$shiftId'] }, { $eq: ['$status', 'available'] } ] } } },
          { $count: 'availableSeats' },
        ],
        as: 'seatSummary',
      } },
      { $lookup: {
        from: 'users',
        let: { driverId: '$driver' },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$driverId'] } } }, { $project: { _id: 1, name: 1 } }, { $limit: 1 }],
        as: 'driverDetails',
      } },
      { $addFields: {
        operating: { $ne: ['$activeShiftId', null] },
        shiftActive: { $ne: ['$activeShiftId', null] },
        availableSeats: { $cond: [{ $ne: ['$activeShiftId', null] }, { $ifNull: [{ $arrayElemAt: ['$seatSummary.availableSeats', 0] }, 0] }, null] },
        status: { $cond: [{ $ne: ['$activeShiftId', null] }, 'active', { $cond: [{ $eq: ['$status', 'maintenance'] }, 'maintenance', 'idle'] }] },
        route: { _id: '$$routeId', routeName: '$$routeName' },
        driver: { $arrayElemAt: ['$driverDetails', 0] },
      } },
      { $project: { _id: 1, busNumber: 1, status: 1, capacity: 1, availableSeats: 1, nextStop: 1, etaMinutes: 1, currentLocation: 1, lastLocationUpdate: 1, route: 1, driver: 1, shiftActive: 1, operating: 1, shiftId: '$activeShiftId', currentStopIndex: 1, direction: 1, recentSpeeds: 1 } },
    ],
    as: 'buses',
  } },
  { $project: { _id: 1, routeName: 1, startPoint: 1, endPoint: 1, description: 1, isActive: 1, createdAt: 1, stops: 1, buses: 1 } },
];

function addNextStopAndEta(route) {
  const stops = route.stops || [];
  for (const bus of route.buses || []) {
    const directionStops = bus.direction === 'return' ? [...stops].reverse() : stops;
    const target = directionStops[Number(bus.currentStopIndex) || 0] || null;
    bus.nextStop = target ? { _id: target._id, stopName: target.stopName, stopOrder: target.stopOrder } : null;
    bus.etaMinutes = null;
    const speeds = Array.isArray(bus.recentSpeeds) ? bus.recentSpeeds : [];
    delete bus.currentStopIndex;
    delete bus.recentSpeeds;
    if (!target || bus.currentLocation?.latitude == null || bus.currentLocation?.longitude == null) continue;
    const distance = haversineDistanceKm(bus.currentLocation.latitude, bus.currentLocation.longitude, target.latitude, target.longitude);
    const speed = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 20;
    bus.etaMinutes = speed > 0 ? Math.round((distance / speed) * 600) / 10 : null;
  }
  return route;
}

async function getRoutesOverviewData() {
  const routes = await Route.aggregate(routeOverviewPipeline);
  return routes.map(addNextStopAndEta);
}

module.exports = { getRoutesOverviewData, routeOverviewPipeline };
