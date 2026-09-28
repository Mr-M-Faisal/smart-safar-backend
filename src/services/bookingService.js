const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Shift = require('../models/Shift');
const Stop = require('../models/Stop');
const User = require('../models/User');
const { ApiError } = require('../utils/apiError');
const { assertObjectId, requireObjectBody } = require('../utils/accountValidation');
const { runInTransaction } = require('./transactionService');
const { getBookingPrice } = require('./paymentService');
const Seat = require('../models/Seat');
const { getOperatingBusesForRoute, getOperatingBusForDriver } = require('./operatingBusService');

function sameId(left, right) {
  return Boolean(left && right && left.toString() === right.toString());
}

function populatedBooking(id) {
  return Booking.findById(id)
    .populate('user', 'name')
    .populate('bus', 'busNumber route driver status capacity')
    .populate('route', 'routeName startPoint endPoint')
    .populate('driver', 'name');
}

function validateCreateBody(body) {
  requireObjectBody(body);
  const allowed = [
    'routeId',
    'bus',
    'driverId',
    'seatNumber',
    'paymentMethod',
    'pickupLocation',
    'shareLocation',
    // Accepted only to preserve older clients. The server deliberately ignores it.
    'fare',
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(
      400,
      'Only routeId, bus, driverId, seatNumber, paymentMethod, pickupLocation, and shareLocation can be provided.'
    );
  }

  if (!body.routeId && !body.bus) {
    throw new ApiError(400, 'routeId is required unless a valid bus is selected for manual booking.');
  }
  if (body.routeId) assertObjectId(body.routeId, 'Route ID');
  if (body.bus) assertObjectId(body.bus, 'Bus ID');
  if (body.driverId) {
    assertObjectId(body.driverId, 'Driver ID');
    if (!body.bus) {
      throw new ApiError(400, 'driverId can only be provided with a selected bus.');
    }
  }

  if (Object.hasOwn(body, 'shareLocation') && typeof body.shareLocation !== 'boolean') {
    throw new ApiError(400, 'shareLocation must be a boolean.');
  }
  if (body.pickupLocation && body.shareLocation !== true) {
    throw new ApiError(400, 'Explicit shareLocation consent is required to store a passenger location.');
  }
  if (body.shareLocation === true && !body.pickupLocation) {
    throw new ApiError(400, 'pickupLocation is required when location sharing is enabled.');
  }

  let seatNumber = null;
  if (Object.hasOwn(body, 'seatNumber') && body.seatNumber !== null) {
    if (!(typeof body.seatNumber === 'string' || typeof body.seatNumber === 'number') || !String(body.seatNumber).trim()) {
      throw new ApiError(400, 'seatNumber is required and must identify a seat on the selected bus.');
    }
    seatNumber = String(body.seatNumber).trim().toUpperCase();
    if (seatNumber.length > 32) throw new ApiError(400, 'seatNumber is too long.');
  }
  if (!seatNumber || !/^[1-9]\d*$/.test(seatNumber)) throw new ApiError(400, 'Choose a valid numbered seat on the selected bus.');

  const paymentMethod = body.paymentMethod || 'cash';
  if (!['cash', 'online'].includes(paymentMethod)) {
    throw new ApiError(400, 'paymentMethod must be cash or online.');
  }

  return {
    routeId: body.routeId || null,
    busId: body.bus || null,
    driverId: body.driverId || null,
    seatNumber,
    paymentMethod,
    pickupLocation: body.pickupLocation
      ? normalizeLocation(body.pickupLocation)
      : null,
    shareLocation: body.shareLocation === true,
  };
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'pickupLocation must be an object.');
  }
  const allowed = ['latitude', 'longitude', 'accuracy', 'timestamp'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'pickupLocation contains unsupported fields.');
  }

  const { latitude, longitude } = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ApiError(400, 'pickupLocation.latitude must be between -90 and 90.');
  }
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new ApiError(400, 'pickupLocation.longitude must be between -180 and 180.');
  }

  let accuracy = null;
  if (value.accuracy !== undefined && value.accuracy !== null) {
    if (typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy < 0) {
      throw new ApiError(400, 'pickupLocation.accuracy must be a non-negative number.');
    }
    accuracy = value.accuracy;
  }

  const timestamp = value.timestamp === undefined ? new Date() : new Date(value.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new ApiError(400, 'pickupLocation.timestamp must be a valid date.');
  }

  return { latitude, longitude, accuracy, timestamp };
}

async function requireActiveRoute(routeId, session) {
  const route = await Route.findOne({ _id: routeId, isActive: true }).session(session);
  if (!route) throw new ApiError(404, 'Active route not found.');

  const hasStop = await Stop.exists({ route: route._id }).session(session);
  if (!hasStop) throw new ApiError(409, 'The selected route has no valid stops.');
  return route;
}

async function validOperationalAssignment(bus, routeId, session) {
  if (!bus || !sameId(bus.route, routeId)) return null;
  const operating = await getOperatingBusesForRoute(routeId, session);
  const match = operating.find(item => sameId(item._id, bus._id));
  return match ? { driver: match.driver, shiftId: match.shiftId, bus: match } : null;
}

async function bookingReadinessMessage(routeId, session, onlyBus = null) {
  const buses = onlyBus ? [onlyBus] : await Bus.find({ route: routeId }).session(session);
  if (!buses.length) return 'No bus has been assigned to this route yet. Contact the transit team to assign a bus.';
  const operating = await getOperatingBusesForRoute(routeId, session);
  if (operating.length && operating.every(bus => bus.availableSeats <= 0)) return 'All buses assigned to this route are full. Please try again later or choose another route.';
  if (buses.every(bus => bus.status === 'maintenance')) return 'The assigned bus is under maintenance and cannot be booked right now.';
  if (buses.some(bus => bus.driver)) return 'No buses running on this route right now. Ask the driver to start a shift, then try again.';
  return 'A bus is assigned to this route, but it has no driver yet. Ask the administrator to assign a driver.';
}

async function resolveBookingAssignment(values, session) {
  let bus = null;
  let routeId = values.routeId;

  if (values.busId) {
    bus = await Bus.findById(values.busId).session(session);
    if (!bus) throw new ApiError(404, 'Bus not found.');
    if (!bus.route) throw new ApiError(409, 'The selected bus does not have an assigned route.');
    if (routeId && !sameId(bus.route, routeId)) {
      throw new ApiError(400, 'The selected bus does not belong to the selected route.');
    }
    routeId = routeId || bus.route.toString();
  }

  const route = await requireActiveRoute(routeId, session);

  if (!bus) {
    const candidates = await getOperatingBusesForRoute(route._id, session);
    const candidate = candidates.find(item => item.availableSeats > 0);
    if (!candidate) {
      throw new ApiError(409, await bookingReadinessMessage(route._id, session));
    }
    bus = await Bus.findById(candidate._id).session(session);
  }

  const assignment = await validOperationalAssignment(bus, route._id, session);
  if (!assignment) {
    throw new ApiError(409, await bookingReadinessMessage(route._id, session, bus));
  }
  const { driver, shiftId } = assignment;
  if (values.driverId && !sameId(driver._id, values.driverId)) {
    throw new ApiError(400, 'The selected driver is not assigned to this bus and route.');
  }
  return { route, bus, driver, shiftId };
}

async function createBookingFromRequest(userId, body) {
  const values = validateCreateBody(body);
  const price = getBookingPrice();

  const bookingId = await runInTransaction(async (session) => {
    const { route, bus, driver, shiftId } = await resolveBookingAssignment(values, session);

    const duplicate = await Booking.findOne({
      user: userId,
      bus: bus._id,
      status: { $in: ['confirmed', 'boarded'] },
    })
      .select('_id')
      .session(session);
    if (duplicate) throw new ApiError(409, 'You already have an active booking on this bus.');

    const availableSeat = await Seat.findOne({ bus: bus._id, shift: shiftId, seatNumber: values.seatNumber, status: 'available' }).session(session);
    if (!availableSeat) throw new ApiError(409, 'That seat was just taken, please pick another.');

    const [booking] = await Booking.create(
      [
        {
          user: userId,
          bus: bus._id,
          route: route._id,
          shift: shiftId,
          driver: driver._id,
          seatNumber: values.seatNumber,
          paymentMethod: values.paymentMethod,
          paymentStatus: 'pending',
          fare: price.fare,
          currency: price.currency,
          pickupLocation: values.pickupLocation,
          locationSharingActive: values.shareLocation,
        },
      ],
      { session }
    );

    const claimed = await Seat.updateOne({ _id: availableSeat._id, status: 'available', booking: null }, { $set: { status: 'reserved', booking: booking._id } }, { session });
    if (claimed.modifiedCount !== 1) throw new ApiError(409, 'That seat was just taken, please pick another.');
    return booking._id;
  });

  return populatedBooking(bookingId);
}

async function releaseSeat(booking, session) {
  if (booking.shift && booking.seatNumber) await Seat.updateOne({ shift: booking.shift, seatNumber: booking.seatNumber, booking: booking._id, status: { $in: ['reserved', 'occupied'] } }, { $set: { status: 'available', booking: null } }, { session });
}

async function cancelUserBooking(bookingId, userId) {
  assertObjectId(bookingId, 'Booking ID');

  const result = await runInTransaction(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw new ApiError(404, 'Booking not found.');
    if (!sameId(booking.user, userId)) {
      throw new ApiError(403, 'Not authorized to cancel this booking.');
    }
    if (booking.status === 'cancelled') {
      throw new ApiError(400, 'Booking is already cancelled.');
    }
    if (booking.status === 'completed') {
      throw new ApiError(409, 'A completed booking cannot be cancelled.');
    }
    if (booking.status === 'boarded') throw new ApiError(409, 'A boarded passenger cannot cancel an active trip.');

    const locationStopped = booking.locationSharingActive;
    booking.status = 'cancelled';
    booking.locationSharingActive = false;
    if (booking.paymentStatus !== 'paid') booking.paymentStatus = 'cancelled';
    await booking.save({ session });
    await releaseSeat(booking, session);
    return { id: booking._id, locationStopped };
  });

  return { booking: await populatedBooking(result.id), locationStopped: result.locationStopped };
}

async function cancelAdminBooking(bookingId) {
  assertObjectId(bookingId, 'Booking ID');
  const result = await runInTransaction(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw new ApiError(404, 'Booking not found.');
    if (booking.status === 'cancelled') throw new ApiError(400, 'Booking is already cancelled.');
    if (booking.status === 'completed') throw new ApiError(409, 'A completed booking cannot be cancelled.');
    if (booking.status === 'boarded') throw new ApiError(409, 'A boarded passenger cannot be cancelled by the administrator.');
    const locationStopped = booking.locationSharingActive;
    booking.status = 'cancelled';
    booking.locationSharingActive = false;
    if (booking.paymentStatus !== 'paid') booking.paymentStatus = 'cancelled';
    await booking.save({ session });
    await releaseSeat(booking, session);
    return { id: booking._id, locationStopped };
  });
  return { booking: await populatedBooking(result.id), locationStopped: result.locationStopped };
}

function validateLocationUpdateBody(body) {
  requireObjectBody(body);
  const allowed = ['pickupLocation', 'shareLocation'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'Only pickupLocation and shareLocation can be provided.');
  }
  if (typeof body.shareLocation !== 'boolean') {
    throw new ApiError(400, 'shareLocation must be a boolean.');
  }
  if (body.shareLocation && !body.pickupLocation) {
    throw new ApiError(400, 'pickupLocation is required when location sharing is enabled.');
  }
  if (!body.shareLocation && body.pickupLocation) {
    throw new ApiError(400, 'Do not send pickupLocation when stopping location sharing.');
  }
  return {
    shareLocation: body.shareLocation,
    pickupLocation: body.shareLocation ? normalizeLocation(body.pickupLocation) : null,
  };
}

async function requireBookingActiveAssignment(booking) {
  const bus = await Bus.findById(booking.bus);
  if (!bus || !sameId(bus.route, booking.route) || !sameId(bus.driver, booking.driver)) {
    throw new ApiError(409, 'The booking no longer has a valid bus and driver assignment.');
  }
  const assignment = await validOperationalAssignment(bus, booking.route, null);
  if (!assignment || !sameId(assignment.driver._id, booking.driver)) {
    throw new ApiError(409, 'Passenger location can only be shared during the assigned driver shift.');
  }
}

async function updatePassengerLocation(bookingId, userId, body) {
  assertObjectId(bookingId, 'Booking ID');
  const values = validateLocationUpdateBody(body);
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  if (!sameId(booking.user, userId)) {
    throw new ApiError(403, 'Not authorized to update this booking location.');
  }
  if (booking.status !== 'confirmed') {
    throw new ApiError(409, 'Location sharing is only available for confirmed bookings.');
  }

  if (values.shareLocation) {
    await requireBookingActiveAssignment(booking);
    booking.pickupLocation = values.pickupLocation;
  }
  booking.locationSharingActive = values.shareLocation;
  await booking.save();
  return populatedBooking(booking._id);
}

async function activeDriverContext(driverId) {
  const operating = await getOperatingBusForDriver(driverId);
  if (!operating) throw new ApiError(409, 'An assigned bus and open shift are required.');
  const driver = await User.findById(driverId).select('_id name assignedBus');
  const bus = await Bus.findById(operating._id);
  if (!driver || !bus) throw new ApiError(409, 'An assigned bus and open shift are required.');
  return { driver, bus, shiftId: operating.shiftId };
}

async function getPassengerLocationsForDriver(driverId) {
  const { driver, bus } = await activeDriverContext(driverId);
  const bookings = await Booking.find({
    driver: driver._id,
    bus: bus._id,
    route: bus.route,
    status: 'confirmed',
    locationSharingActive: true,
    pickupLocation: { $ne: null },
  })
    .select('user pickupLocation')
    .populate('user', 'name')
    .sort({ updatedAt: -1 });

  return bookings.map((booking) => ({
    bookingId: booking._id,
    passenger: {
      id: booking.user?._id || booking.user,
      name: booking.user?.name || null,
    },
    pickupLocation: booking.pickupLocation,
  }));
}

async function applyVerifiedPayment(notification) {
  const result = await runInTransaction(async (session) => {
    const booking = await Booking.findOne({
      paymentReference: notification.paymentReference,
    }).session(session);
    if (!booking) throw new ApiError(404, 'Booking payment reference not found.');
    if (booking.paymentMethod !== 'online') {
      throw new ApiError(409, 'This booking is not configured for online payment.');
    }
    if (booking.fare !== notification.amount || booking.currency !== notification.currency) {
      throw new ApiError(400, 'Payment amount or currency does not match the booking.');
    }

    if (notification.status === 'paid') {
      if (booking.paymentStatus === 'paid') {
        if (booking.providerTransactionId !== notification.providerTransactionId) {
          throw new ApiError(409, 'This booking was confirmed by a different transaction.');
        }
        return { id: booking._id, locationStopped: false };
      }
      if (booking.paymentStatus !== 'pending' || booking.status !== 'confirmed') {
        throw new ApiError(409, 'This booking can no longer accept a successful payment.');
      }
      booking.paymentStatus = 'paid';
      booking.providerTransactionId = notification.providerTransactionId;
      booking.paymentProvider = process.env.PAYMENT_PROVIDER || null;
      booking.paidAt = new Date();
      booking.paymentFailureReason = null;
      await booking.save({ session });
      return { id: booking._id, locationStopped: false };
    }

    if (booking.paymentStatus === 'failed') {
      if (booking.providerTransactionId !== notification.providerTransactionId) {
        throw new ApiError(409, 'This booking was failed by a different transaction.');
      }
      return { id: booking._id, locationStopped: false };
    }
    if (booking.paymentStatus !== 'pending' || booking.status !== 'confirmed') {
      throw new ApiError(409, 'This booking can no longer accept a failed payment.');
    }

    const locationStopped = booking.locationSharingActive;
    booking.paymentStatus = 'failed';
    booking.providerTransactionId = notification.providerTransactionId;
    booking.paymentProvider = process.env.PAYMENT_PROVIDER || null;
    booking.paymentFailureReason = notification.failureReason || 'Payment provider reported failure.';
    booking.status = 'cancelled';
    booking.locationSharingActive = false;
    await booking.save({ session });
    await releaseSeat(booking, session);
    return { id: booking._id, locationStopped };
  });

  return { booking: await populatedBooking(result.id), locationStopped: result.locationStopped };
}

async function emitPassengerLocation(io, booking, sharing) {
  if (!io || !booking?.driver || !booking?.bus || !booking?.route) return false;
  const operating = await getOperatingBusForDriver(booking.driver._id || booking.driver);
  if (!operating || !sameId(operating._id, booking.bus._id || booking.bus) || !sameId(operating.route, booking.route._id || booking.route)) return false;

  const payload = {
    bookingId: booking._id,
    passenger: {
      id: booking.user?._id || booking.user,
      name: booking.user?.name || null,
    },
    sharing,
  };
  if (sharing && booking.locationSharingActive && booking.pickupLocation) {
    payload.latitude = booking.pickupLocation.latitude;
    payload.longitude = booking.pickupLocation.longitude;
    payload.accuracy = booking.pickupLocation.accuracy;
    payload.timestamp = booking.pickupLocation.timestamp;
  }

  io.to(`driver:${booking.driver._id || booking.driver}`).emit('passengerLocationUpdate', payload);
  return true;
}

module.exports = {
  activeDriverContext,
  applyVerifiedPayment,
  cancelUserBooking,
  cancelAdminBooking,
  createBookingFromRequest,
  emitPassengerLocation,
  getPassengerLocationsForDriver,
  updatePassengerLocation,
};
