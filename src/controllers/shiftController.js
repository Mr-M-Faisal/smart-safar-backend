const { startDriverShift, endDriverShift } = require('../services/shiftService');
const { sendApiError } = require('../utils/apiError');

const startShift = async (req, res) => {
  try {
    const shift = await startDriverShift(req.user._id);
    res.status(201).json({ message: 'Shift started successfully', shift });
  } catch (error) {
    sendApiError(res, error, 'Server error starting shift');
  }
};

const endShift = async (req, res) => {
  try {
    const { shift, cancelledPassengerIds } = await endDriverShift(req.user._id);
    const bus = shift.bus;
    const io = req.app.get('io');
    io.to(`bus:${bus._id}`).emit('locationUpdate', {
      busId: bus._id,
      latitude: bus.currentLocation?.latitude ?? null,
      longitude: bus.currentLocation?.longitude ?? null,
      lastLocationUpdate: bus.lastLocationUpdate,
      status: bus.status,
      direction: bus.direction,
    });
    const driverRoom = `driver:${req.user._id}`;
    io.to(driverRoom).emit('passengerLocationAccessEnded', { reason: 'shift-ended' });
    io.in(driverRoom).socketsLeave(driverRoom);
    for (const passengerId of cancelledPassengerIds || []) io.to(`passenger:${passengerId}`).emit('bookingStatusUpdate', { status: 'cancelled_by_service', message: 'Your booking was cancelled because the driver ended the shift.' });
    res.status(200).json({ message: 'Shift ended successfully', shift });
  } catch (error) {
    sendApiError(res, error, 'Server error ending shift');
  }
};

module.exports = { startShift, endShift };
