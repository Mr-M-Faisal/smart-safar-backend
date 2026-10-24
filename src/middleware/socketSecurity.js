const MAX_SOCKET_ROOMS = 20;
const SOCKET_EVENT_WINDOW_MS = 10_000;
const SOCKET_EVENT_LIMIT = 60;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function joinedRoomCount(socket) {
  return [...socket.rooms].filter((room) => room !== socket.id).length;
}

function canJoinSocketRoom(socket, room, maxRooms = MAX_SOCKET_ROOMS) {
  if (socket.rooms.has(room)) return true;
  return joinedRoomCount(socket) < maxRooms;
}

function canJoinBusRoom(socket, busId, maxRooms = MAX_SOCKET_ROOMS) {
  if (typeof busId !== 'string' || !OBJECT_ID_PATTERN.test(busId)) return 'INVALID_BUS_ID';
  if (!canJoinSocketRoom(socket, `bus:${busId}`, maxRooms)) return 'ROOM_LIMIT';
  return null;
}

function installSocketEventRateLimit(socket, { windowMs = SOCKET_EVENT_WINDOW_MS, maxEvents = SOCKET_EVENT_LIMIT, now = Date.now } = {}) {
  let windowStartedAt = now();
  let eventCount = 0;
  socket.use((packet, next) => {
    const currentTime = now();
    if (currentTime - windowStartedAt >= windowMs) {
      windowStartedAt = currentTime;
      eventCount = 0;
    }
    eventCount += 1;
    if (eventCount > maxEvents) {
      const error = new Error('Too many socket events. Please slow down.');
      error.data = { code: 'SOCKET_RATE_LIMITED' };
      next(error);
      return;
    }
    next();
  });
}

module.exports = { MAX_SOCKET_ROOMS, SOCKET_EVENT_WINDOW_MS, SOCKET_EVENT_LIMIT, canJoinSocketRoom, canJoinBusRoom, installSocketEventRateLimit };
