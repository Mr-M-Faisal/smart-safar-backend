const Bus = require('../models/Bus');
const Stop = require('../models/Stop');
const Shift = require('../models/Shift');
const User = require('../models/User');
const { createFleetBus, updateFleetBus, deleteFleetBus } = require('../services/busAssignmentService');
const { sendApiError } = require('../utils/apiError');
const { haversineDistanceKm } = require('../utils/geo');
const { getOperatingBusesForRoute, getOperatingBusForDriver } = require('../services/operatingBusService');
const Seat = require('../models/Seat');
const Booking = require('../models/Booking');
const { runInTransaction } = require('../services/transactionService');

// How close (in km) the bus must get to a stop before we consider it
// "reached" and advance to the next one. ~50 meters.
const ARRIVAL_THRESHOLD_KM = 0.05;

// A sensible fallback speed (km/h) to use for ETA when we don't have
// any real speed readings yet (e.g. right after a bus starts its shift).
const DEFAULT_SPEED_KMH = 20;

const getBusDirection = (bus) => bus.direction === 'return' ? 'return' : 'outbound';

const getStopsInDirection = (stops, direction) => direction === 'return' ? [...stops].reverse() : stops;

const stopSummary = (stop) => stop ? { _id: stop._id, stopName: stop.stopName, stopOrder: stop.stopOrder } : null;

const sameId = (left, right) => left && right && left.toString() === right.toString();

// Works out the next stop for a bus and the ETA to it, in minutes.
// This is the core of the ETA Estimation Module from the proposal:
// - finds the next stop in sequence past currentStopIndex
// - measures straight-line distance from the bus's current location
// - divides by a 5-reading moving average of recent speeds
const calculateNextStopAndETA = async (bus) => {
  const storedStops = await Stop.find({ route: bus.route }).sort({ stopOrder: 1 });
  const direction = getBusDirection(bus);
  const stops = getStopsInDirection(storedStops, direction);

  if (stops.length === 0 || bus.currentLocation.latitude == null) {
    return { direction, currentStop: null, nextStop: null, distanceKm: null, etaMinutes: null, terminalReached: false };
  }

  let nextStop = stops[bus.currentStopIndex] || null;
  let currentStop = bus.currentStopIndex > 0 ? stops[bus.currentStopIndex - 1] : null;
  let terminalReached = false;

  // If the bus is already within range of its current target stop,
  // advance to the one after it (this is what "detects arrival" means).
  if (nextStop) {
    const distToCurrentTarget = haversineDistanceKm(
      bus.currentLocation.latitude,
      bus.currentLocation.longitude,
      nextStop.latitude,
      nextStop.longitude
    );

    if (distToCurrentTarget <= ARRIVAL_THRESHOLD_KM && bus.currentStopIndex < stops.length - 1) {
      currentStop = nextStop;
      bus.currentStopIndex += 1;
      nextStop = stops[bus.currentStopIndex];
    } else if (distToCurrentTarget <= ARRIVAL_THRESHOLD_KM && bus.currentStopIndex === stops.length - 1) {
      currentStop = nextStop;
      terminalReached = true;
    }
  }

  if (!nextStop) {
    // Bus has passed the last stop on the route
    return { direction, currentStop: stopSummary(currentStop), nextStop: null, distanceKm: 0, etaMinutes: 0, terminalReached };
  }

  const distanceKm = haversineDistanceKm(
    bus.currentLocation.latitude,
    bus.currentLocation.longitude,
    nextStop.latitude,
    nextStop.longitude
  );

  const avgSpeed =
    bus.recentSpeeds.length > 0
      ? bus.recentSpeeds.reduce((sum, s) => sum + s, 0) / bus.recentSpeeds.length
      : DEFAULT_SPEED_KMH;

  const etaMinutes = avgSpeed > 0 ? (distanceKm / avgSpeed) * 60 : null;

  return {
    direction,
    currentStop: stopSummary(currentStop),
    nextStop: stopSummary(nextStop),
    distanceKm: Math.round(distanceKm * 100) / 100,
    etaMinutes: etaMinutes != null ? Math.round(etaMinutes * 10) / 10 : null,
    terminalReached,
  };
};

// @route   POST /api/buses/assigned/return-trip
// @desc    Start the authenticated driver's return trip at the outbound terminal
// @access  Private (driver)
const startReturnTrip = async (req, res) => {
  try {
    if (!req.user.assignedBus) return res.status(400).json({ message: 'No bus assigned.' });

    const bus = await Bus.findById(req.user.assignedBus);
    if (!bus) return res.status(404).json({ message: 'Assigned bus not found.' });
    if (!sameId(bus.driver, req.user._id)) return res.status(403).json({ message: 'Forbidden: this bus is not assigned to you.' });
    if (!bus.route) return res.status(400).json({ message: 'No route assigned.' });
    if (!await getOperatingBusForDriver(req.user._id)) {
      return res.status(409).json({ message: 'Start an active shift before starting a return trip.' });
    }
    if (getBusDirection(bus) === 'return') return res.status(409).json({ message: 'Return trip has already started.' });

    const stops = await Stop.find({ route: bus.route }).sort({ stopOrder: 1 });
    if (stops.length < 2) return res.status(400).json({ message: 'Return trip is not available for this route.' });

    const terminal = stops[stops.length - 1];
    const atTerminal = bus.currentLocation.latitude != null && bus.currentLocation.longitude != null &&
      bus.currentStopIndex === stops.length - 1 &&
      haversineDistanceKm(bus.currentLocation.latitude, bus.currentLocation.longitude, terminal.latitude, terminal.longitude) <= ARRIVAL_THRESHOLD_KM;
    if (!atTerminal) return res.status(409).json({ message: 'Return trip can only start at the terminal.' });

    const updated = await Bus.findOneAndUpdate(
      { _id: bus._id, driver: req.user._id, direction: { $ne: 'return' }, currentStopIndex: stops.length - 1 },
      { $set: { direction: 'return', currentStopIndex: 0 } },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ message: 'Return trip has already started.' });

    const etaInfo = await calculateNextStopAndETA(updated);
    await updated.save();
    const payload = {
      busId: updated._id,
      latitude: updated.currentLocation.latitude,
      longitude: updated.currentLocation.longitude,
      lastLocationUpdate: updated.lastLocationUpdate,
      status: updated.status,
      ...etaInfo,
    };
    req.app.get('io').to(`bus:${updated._id}`).emit('locationUpdate', payload);
    res.status(200).json({ ...updated.toObject(), ...etaInfo });
  } catch (err) {
    sendApiError(res, err, 'Could not start the return trip.');
  }
};

// @route   POST /api/buses
const createBus = async (req, res) => {
  try {
    const bus = await createFleetBus(req.body);
    res.status(201).json(bus);
  } catch (error) {
    sendApiError(res, error, 'Server error creating bus', 'A bus with this bus number already exists.');
  }
};

// @route   GET /api/buses
const getBuses = async (req, res) => {
  try {
    const filter = {};
    if (req.query.route) filter.route = req.query.route;

    const buses = await Bus.find(filter)
      .populate('route', 'routeName')
      .populate('driver', 'name phone');

    const busIds = buses.map((bus) => bus._id);
    const routeIds = [...new Set(buses.map(bus => bus.route?._id || bus.route).filter(Boolean).map(String))];
    const operating = (await Promise.all(routeIds.map(id => getOperatingBusesForRoute(id)))).flat();
    const operatingById = new Map(operating.map(bus => [String(bus._id), bus]));
    res.status(200).json(buses.map(bus => {
      const active = operatingById.get(String(bus._id));
      return { ...bus.toObject(), status: active ? 'active' : bus.status === 'maintenance' ? 'maintenance' : 'idle', shiftActive: Boolean(active), operating: Boolean(active), shiftId: active?.shiftId || null, availableSeats: active?.availableSeats ?? null };
    }));
  } catch (err) {
    sendApiError(res, err, 'Could not load buses.');
  }
};

const getActiveBusesForRoute = async (req, res) => {
  try {
    const buses = await getOperatingBusesForRoute(req.params.routeId);
    const results = await Promise.all(buses.map(async bus => ({ ...bus, ...(await calculateNextStopAndETA(bus)) })));
    res.status(200).json(results);
  } catch (error) { sendApiError(res, error, 'Could not load operating buses.'); }
};

// @route   GET /api/buses/:id
const getBusById = async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id)
      .populate('route', 'routeName')
      .populate('driver', 'name phone');

    if (!bus) {
      return res.status(404).json({ message: 'Bus not found' });
    }
    const operatingBus = bus.driver ? await getOperatingBusForDriver(bus.driver._id || bus.driver) : null;
    const operating = String(operatingBus?._id || '') === String(bus._id);
    res.status(200).json({ ...bus.toObject(), status: operating ? 'active' : bus.status === 'maintenance' ? 'maintenance' : 'idle', operating, shift: operatingBus?.shiftId || null, availableSeats: operatingBus?.availableSeats ?? null });
  } catch (err) {
    sendApiError(res, err, 'Could not load this bus.');
  }
};

const getBusSeats = async (req,res) => {
  try {
    const bus=await Bus.findById(req.params.id);
    if(!bus) return res.status(404).json({message:'Bus not found.',code:'BUS_NOT_FOUND'});
    const operating=bus.driver?await getOperatingBusForDriver(bus.driver):null;
    if(!operating||String(operating._id)!==String(bus._id)) return res.status(409).json({message:'This bus has no open driver shift.',code:'SHIFT_NOT_OPEN'});
    const seats=(await Seat.find({shift:operating.shiftId}).select('seatNumber status updatedAt').lean()).sort((a,b)=>Number(a.seatNumber)-Number(b.seatNumber));
    res.json({busId:bus._id,shiftId:operating.shiftId,seats,capacity:bus.capacity,available:seats.filter(s=>s.status==='available').length,reserved:seats.filter(s=>s.status==='reserved').length,occupied:seats.filter(s=>s.status==='occupied').length});
  } catch(error){sendApiError(res,error,'Could not load seat map.');}
};

const getAssignedDriverSeats = async (req,res) => {
  try {
    const bus=await getOperatingBusForDriver(req.user._id);
    if(!bus) return res.status(409).json({message:'Start your assigned bus shift before managing seats.',code:'SHIFT_NOT_OPEN'});
    const seats=(await Seat.find({shift:bus.shiftId}).populate({path:'booking',select:'user locationSharingActive',populate:{path:'user',select:'name'}}).lean()).sort((a,b)=>Number(a.seatNumber)-Number(b.seatNumber));
    const safe=seats.map(s=>({seatNumber:s.seatNumber,status:s.status,bookingId:s.booking?._id||null,passengerName:s.booking?.user?.name?.split(' ')[0]||null,shareLocation:Boolean(s.booking?.locationSharingActive)}));
    res.json({busId:bus._id,busNumber:bus.busNumber,shiftId:bus.shiftId,seats:safe,capacity:bus.capacity,available:safe.filter(s=>s.status==='available').length,reserved:safe.filter(s=>s.status==='reserved').length,occupied:safe.filter(s=>s.status==='occupied').length});
  } catch(error){sendApiError(res,error,'Could not load driver seat map.');}
};

const emitSeatState = async (req,bus) => {
  const seats=(await Seat.find({shift:bus.shiftId}).select('seatNumber status updatedAt').lean()).sort((a,b)=>Number(a.seatNumber)-Number(b.seatNumber));
  const payload={busId:bus._id,shiftId:bus.shiftId,seats,capacity:bus.capacity,available:seats.filter(s=>s.status==='available').length,reserved:seats.filter(s=>s.status==='reserved').length,occupied:seats.filter(s=>s.status==='occupied').length};
  req.app.get('io')?.to(`bus:${bus._id}`).emit('seatStateUpdate',payload);
  req.app.get('io')?.to(`driver:${bus.driver?._id||bus.driver}`).emit('driverSeatStateUpdate',payload);
};

const updateAssignedSeat = async(req,res) => {
  try {
    const {action}=req.body||{};
    if(!['board','no_show','occupy','release'].includes(action)) return res.status(400).json({message:'Choose a valid seat action.',code:'INVALID_SEAT_ACTION'});
    const bus=await getOperatingBusForDriver(req.user._id);
    if(!bus) return res.status(409).json({message:'Only your own bus with an open shift can be managed.',code:'SHIFT_NOT_OPEN'});
    const seatNumber=String(req.params.seatNumber||'').trim();
    const seat=await Seat.findOne({bus:bus._id,shift:bus.shiftId,seatNumber});
    if(!seat) return res.status(404).json({message:'Seat number is not part of this bus shift.',code:'SEAT_NOT_FOUND'});
    const transitions={board:['reserved','occupied'],no_show:['reserved','available'],occupy:['available','occupied'],release:['occupied','available']};
    const [from,to]=transitions[action];
    if(seat.status!==from) return res.status(409).json({message:`Seat is ${seat.status}; action ${action} is not allowed.`,code:'SEAT_STATE_CONFLICT'});
    let notifyPassenger=null;
    await runInTransaction(async session => {
      const changed=await Seat.findOneAndUpdate({ _id:seat._id, status:from }, { $set:{ status:to, ...(to==='available'?{booking:null}:{}) } }, { new:true, session });
      if(!changed) { const conflict=new Error('Seat state changed; refresh the seat map.'); conflict.status=409; conflict.code='SEAT_STATE_CONFLICT'; throw conflict; }
      if(action==='board'||action==='no_show') {
        const booking=await Booking.findOneAndUpdate({ _id:seat.booking, status:'confirmed', shift:bus.shiftId }, { $set:{ status:action==='board'?'boarded':'no_show', locationSharingActive:false } }, { new:true, session }).select('user');
        if(!booking) { const conflict=new Error('Reservation is no longer active.'); conflict.status=409; conflict.code='BOOKING_STATE_CONFLICT'; throw conflict; }
        if(action==='no_show') notifyPassenger=booking.user;
      }
      if(action==='release'&&seat.booking) await Booking.updateOne({ _id:seat.booking, status:'boarded', shift:bus.shiftId }, { $set:{ status:'completed', locationSharingActive:false } }, { session });
    });
    seat.status=to;
    await emitSeatState(req,bus);
    if(action==='no_show'&&notifyPassenger) req.app.get('io')?.to(`passenger:${notifyPassenger}`).emit('bookingStatusUpdate',{status:'no_show',message:'Your driver marked this reservation as no-show.'});
    res.json({seat:{seatNumber:seat.seatNumber,status:seat.status}});
  } catch(error){sendApiError(res,error,'Could not update seat.');}
};

const addWalkIn = async(req,res) => {
  try {
    const bus=await getOperatingBusForDriver(req.user._id);
    if(!bus) return res.status(409).json({message:'Only your own bus with an open shift can be managed.',code:'SHIFT_NOT_OPEN'});
    const candidates=(await Seat.find({bus:bus._id,shift:bus.shiftId,status:'available'}).select('_id seatNumber').lean()).sort((a,b)=>Number(a.seatNumber)-Number(b.seatNumber));
    let seat=null;
    for(const candidate of candidates){ seat=await Seat.findOneAndUpdate({_id:candidate._id,status:'available'},{$set:{status:'occupied',booking:null}},{new:true}); if(seat) break; }
    if(!seat) return res.status(409).json({message:'No seats are available for a walk-in.',code:'NO_SEATS_AVAILABLE'});
    await emitSeatState(req,bus); res.status(201).json({seat:{seatNumber:seat.seatNumber,status:seat.status}});
  } catch(error){sendApiError(res,error,'Could not add walk-in.');}
};

// @route   GET /api/buses/:id/eta
// @desc    Get this bus's next stop and estimated time of arrival
// @access  Public
const getBusETA = async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) {
      return res.status(404).json({ message: 'Bus not found' });
    }

    const result = await calculateNextStopAndETA(bus);
    res.status(200).json(result);
  } catch (err) {
    sendApiError(res, err, 'Could not calculate the bus ETA.');
  }
};

// @route   PATCH /api/buses/:id/location
// @desc    Update a bus's live GPS location (called by the driver app).
//          Optionally accepts `speed` in km/h, as sent by the HTML5
//          Geolocation API on the driver's device.
// @access  Private (driver)
const updateBusLocation = async (req, res) => {
  try {
    const { latitude, longitude, speed } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    const bus = await Bus.findById(req.params.id);
    if (!bus) {
      return res.status(404).json({ message: 'Bus not found' });
    }
    if (!sameId(req.user.assignedBus, bus._id) || !sameId(bus.driver, req.user._id)) {
      return res.status(403).json({ message: 'Forbidden: this bus is not assigned to you.' });
    }
    const operatingBus = await getOperatingBusForDriver(req.user._id);
    if (!operatingBus || !sameId(operatingBus._id, bus._id)) {
      return res.status(409).json({ message: 'Start an active shift before updating location.' });
    }
    await Shift.updateOne({ _id: operatingBus.shiftId, status: 'active', endedAt: null }, { $set: { heartbeatAt: new Date() } });

    bus.currentLocation = { latitude, longitude };
    bus.lastLocationUpdate = new Date();

    // Maintain a rolling window of the last 5 speed readings
    if (speed != null && !Number.isNaN(speed)) {
      bus.recentSpeeds.push(speed);
      if (bus.recentSpeeds.length > 5) {
        bus.recentSpeeds.shift(); // drop the oldest reading
      }
    }

    // This also advances bus.currentStopIndex if the bus has arrived
    const etaInfo = await calculateNextStopAndETA(bus);

    await bus.save();

    // Broadcast this update (now including ETA) to anyone watching this bus
    const io = req.app.get('io');
    io.to(`bus:${bus._id}`).emit('locationUpdate', {
      busId: bus._id,
      latitude,
      longitude,
      lastLocationUpdate: bus.lastLocationUpdate,
      status: bus.status,
      ...etaInfo,
    });

    res.status(200).json({ ...bus.toObject(), ...etaInfo });
  } catch (err) {
    sendApiError(res, err, 'Could not update the bus location.');
  }
};

// @route   PATCH /api/buses/:id/seats
const updateSeatAvailability = async (req, res) => {
  return res.status(410).json({ message: 'Seat availability now comes from the active shift seat map.', code: 'USE_SHIFT_SEAT_MAP' });
};

// @route   PUT /api/buses/:id
const updateBus = async (req, res) => {
  try {
    const bus = await updateFleetBus(req.params.id, req.body);
    res.status(200).json(bus);
  } catch (error) {
    sendApiError(res, error, 'Server error updating bus', 'A bus with this bus number already exists.');
  }
};

// @route   DELETE /api/buses/:id
const deleteBus = async (req, res) => {
  try {
    await deleteFleetBus(req.params.id);
    res.status(200).json({ message: 'Bus deleted' });
  } catch (error) {
    sendApiError(res, error, 'Server error deleting bus');
  }
};

module.exports = {
  createBus,
  getBuses,
  getActiveBusesForRoute,
  getBusById,
  getBusSeats,
  getAssignedDriverSeats,
  updateAssignedSeat,
  addWalkIn,
  getBusETA,
  updateBusLocation,
  startReturnTrip,
  updateSeatAvailability,
  updateBus,
  deleteBus,
};
