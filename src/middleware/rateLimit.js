function createMemoryStore({ maxKeys = 20000, now = Date.now } = {}) {
  const requestsByClient = new Map();
  const cleanupInterval = setInterval(() => {
    const currentTime = Date.now();
    for (const [key, entry] of requestsByClient) {
      if (entry.resetAt <= currentTime) requestsByClient.delete(key);
    }
  }, 60_000);
  cleanupInterval.unref?.();

  return {
    increment(key, windowMs) {
      const currentTime = now();
      let entry = requestsByClient.get(key);
      if (!entry || entry.resetAt <= currentTime) {
        if (requestsByClient.size >= maxKeys) {
          for (const [storedKey, value] of requestsByClient) {
            if (value.resetAt <= currentTime) requestsByClient.delete(storedKey);
          }
        }
        if (requestsByClient.size >= maxKeys && !entry) return { busy: true };
        entry = { count: 0, resetAt: currentTime + windowMs };
        requestsByClient.set(key, entry);
      }
      entry.count += 1;
      return { count: entry.count, resetAt: entry.resetAt };
    },
  };
}

function createRateLimiter({ windowMs, max, message, code = 'RATE_LIMITED', keyGenerator, store = createMemoryStore() }) {

  return function rateLimitMiddleware(req, res, next) {
    const currentTime = Date.now();
    const clientKey = keyGenerator ? keyGenerator(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const result = store.increment(clientKey || 'unknown', windowMs);
    if (result.busy) return res.status(503).json({ message: 'Request protection is temporarily busy. Try again shortly.', code: 'RATE_LIMITER_BUSY', requestId: req.id || null });

    if (result.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - currentTime) / 1000))));
      return res.status(429).json({ message, code, requestId: req.id || null });
    }
    return next();
  };
}

function authenticatedUserId(req) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !process.env.JWT_SECRET) return null;
  try { return require('jsonwebtoken').verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }).id || null; }
  catch { return null; }
}
function apiKey(req) {
  const userId = authenticatedUserId(req);
  return userId ? `user:${userId}` : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}
function loginKey(req) {
  return `login:${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(req.body?.email || '').trim().toLowerCase()}`;
}

const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  message: 'Too many requests. Please wait and try again.',
  keyGenerator: apiKey,
});

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  code: 'LOGIN_RATE_LIMITED',
  keyGenerator: loginKey,
});

const registrationRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many account creation attempts. Please try again later.',
  code: 'REGISTRATION_RATE_LIMITED',
});

module.exports = { apiKey, apiRateLimiter, createMemoryStore, createRateLimiter, loginKey, loginRateLimiter, registrationRateLimiter };
