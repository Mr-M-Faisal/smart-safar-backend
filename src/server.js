require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { activeDriverContext } = require('./services/bookingService');
const { closeStaleShifts } = require('./services/staleShiftService');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  res.on('finish', () => {
    if (res.statusCode >= 500) console.error(JSON.stringify({ requestId: req.id, method: req.method, path: req.originalUrl, status: res.statusCode }));
  });
  next();
});
app.use(express.json());

// Make io accessible inside controllers via req.app.get('io')
app.set('io', io);

app.get('/', (req, res) => {
  res.json({ message: 'Smart Public Transit Tracking System API is running' });
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/routes', require('./routes/routeRoutes'));
app.use('/api/stops', require('./routes/stopRoutes'));
app.use('/api/buses', require('./routes/busRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/route-alerts', require('./routes/routeAlertRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/safety', require('./routes/safetyRoutes'));

app.use((req, res) => res.status(404).json({ message: 'API endpoint not found.', code: 'ENDPOINT_NOT_FOUND', requestId: req.id }));
app.use((error, req, res, _next) => {
  console.error(JSON.stringify({ requestId: req.id, message: error.message, stack: error.stack }));
  const status = error.status || 400;
  res.status(status).json({ message: status >= 500 ? 'The server could not complete this request.' : 'Invalid request data.', code: status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', requestId: req.id });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('watchBus', (busId) => {
    socket.join(`bus:${busId}`);
  });

  socket.on('watchPassengerBookings', async (payload = {}, acknowledge) => {
    try {
      const suppliedToken = typeof payload.token === 'string' ? payload.token : socket.handshake.auth?.token;
      const token = suppliedToken?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing token.');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'commuter' || !await User.exists({ _id: decoded.id, role: 'commuter' })) throw new Error('Passenger authentication required.');
      const room = `passenger:${decoded.id}`;
      await socket.join(room);
      socket.data.passengerBookingRoom = room;
      if (typeof acknowledge === 'function') acknowledge({ ok: true });
    } catch (_error) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, message: 'Passenger authentication is required.' });
    }
  });

  socket.on('watchDriverBookings', async (payload = {}, acknowledge) => {
    try {
      const suppliedToken =
        typeof payload.token === 'string' ? payload.token : socket.handshake.auth?.token;
      const token = suppliedToken?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing token.');

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { driver, bus } = await activeDriverContext(decoded.id);
      const room = `driver:${driver._id}`;

      if (socket.data.driverBookingRoom) {
        await socket.leave(socket.data.driverBookingRoom);
      }
      await socket.join(room);
      socket.data.driverBookingRoom = room;

      if (typeof acknowledge === 'function') {
        acknowledge({ ok: true, busId: bus._id.toString() });
      }
    } catch (_error) {
      if (typeof acknowledge === 'function') {
        acknowledge({ ok: false, message: 'Driver authentication and an active shift are required.' });
      }
    }
  });

  socket.on('unwatchDriverBookings', async (acknowledge) => {
    if (socket.data.driverBookingRoom) {
      await socket.leave(socket.data.driverBookingRoom);
      delete socket.data.driverBookingRoom;
    }
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  const sweep = async () => {
    try { const closed = await closeStaleShifts(io); if (closed) console.info(JSON.stringify({ event: 'stale_shifts_closed', count: closed })); }
    catch (error) { console.error(JSON.stringify({ event: 'stale_shift_sweep_failed', message: error.message, stack: error.stack })); }
  };
  await sweep();
  setInterval(sweep, 60 * 1000).unref();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

if (require.main === module) startServer();

// Tests can use the actual app and Socket.IO server with an isolated database.
module.exports = { app, server, io, startServer };
