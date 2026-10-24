require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { Server } = require('socket.io');
const { apiRateLimiter } = require('./middleware/rateLimit');
const connectDB = require('./config/db');
const { activeDriverContext } = require('./services/bookingService');
const { closeStaleShifts } = require('./services/staleShiftService');
const User = require('./models/User');
const validateProductionConfiguration = require('./config/validateProductionConfiguration');
const { canJoinSocketRoom, canJoinBusRoom, installSocketEventRateLimit } = require('./middleware/socketSecurity');

const app = express();
const server = http.createServer(app);
app.disable('x-powered-by');
app.set('etag', 'weak');
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
app.set('trust proxy', Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
}));

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : (process.env.NODE_ENV === 'production' ? [] : ['*']);

let corsOrigin;
if (allowedOrigins.includes('*')) {
  corsOrigin = true;
} else if (allowedOrigins.length > 0) {
  corsOrigin = allowedOrigins;
} else {
  corsOrigin = false;
}

const io = new Server(server, {
  cors: { origin: corsOrigin },
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 10_000,
  pingTimeout: 10_000,
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(compression());
app.use(cors({ origin: corsOrigin }));
app.use((req, res, next) => {
  req.id = randomUUID();
  req.startedAt = performance.now();
  res.setHeader('X-Request-Id', req.id);
  res.vary('Origin');
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithTiming(...args) {
    const durationMs = Math.max(0, performance.now() - req.startedAt);
    res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    const durationMs = Math.max(0, performance.now() - req.startedAt);
    if (durationMs > 300 || res.statusCode >= 500) {
      const record = { requestId: req.id, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10 };
      if (res.statusCode >= 500) console.error(JSON.stringify(record));
      else console.warn(JSON.stringify({ event: 'slow_request', ...record }));
    }
  });
  next();
});
app.use(express.json({ limit: '64kb', strict: true }));

// Make io accessible inside controllers via req.app.get('io')
app.set('io', io);

app.get('/', (req, res) => {
  res.json({ message: 'Smart Public Transit Tracking System API is running' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', apiRateLimiter);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/routes', require('./routes/routeRoutes'));
app.use('/api/passenger', require('./routes/passengerRoutes'));
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
  installSocketEventRateLimit(socket);

  socket.on('watchBus', async (busId, acknowledge) => {
    const rejection = canJoinBusRoom(socket, busId);
    if (rejection) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, code: rejection });
      return;
    }
    try {
      await socket.join(`bus:${busId}`);
      if (typeof acknowledge === 'function') acknowledge({ ok: true, busId });
    } catch (_error) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, code: 'ROOM_JOIN_FAILED' });
    }
  });

  socket.on('unwatchBus', (busId) => {
    if (busId) socket.leave(`bus:${busId}`);
  });

  socket.on('watchPassengerBookings', async (payload = {}, acknowledge) => {
    try {
      const suppliedToken = typeof payload.token === 'string' ? payload.token : socket.handshake.auth?.token;
      const token = suppliedToken?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing token.');
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded.role !== 'commuter' || !await User.exists({ _id: decoded.id, role: 'commuter' })) throw new Error('Passenger authentication required.');
      const room = `passenger:${decoded.id}`;
      if (!canJoinSocketRoom(socket, room)) {
        if (typeof acknowledge === 'function') acknowledge({ ok: false, code: 'ROOM_LIMIT' });
        return;
      }
      await socket.join(room);
      socket.data.passengerBookingRoom = room;
      if (typeof acknowledge === 'function') acknowledge({ ok: true });
    } catch (_error) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, message: 'Passenger authentication is required.' });
    }
  });

  socket.on('unwatchPassengerBookings', async (acknowledge) => {
    if (socket.data.passengerBookingRoom) {
      await socket.leave(socket.data.passengerBookingRoom);
      delete socket.data.passengerBookingRoom;
    }
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('watchDriverBookings', async (payload = {}, acknowledge) => {
    try {
      const suppliedToken =
        typeof payload.token === 'string' ? payload.token : socket.handshake.auth?.token;
      const token = suppliedToken?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing token.');

      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const { driver, bus } = await activeDriverContext(decoded.id);
      const room = `driver:${driver._id}`;

      if (!canJoinSocketRoom(socket, room)) {
        if (typeof acknowledge === 'function') acknowledge({ ok: false, code: 'ROOM_LIMIT' });
        return;
      }

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
  validateProductionConfiguration();
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
module.exports = { app, server, io, startServer, validateProductionConfiguration };
