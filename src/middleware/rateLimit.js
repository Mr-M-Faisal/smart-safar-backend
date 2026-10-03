function createRateLimiter({ windowMs, max, message, code = 'RATE_LIMITED', maxKeys = 20000, now = Date.now }) {
  const requestsByClient = new Map();
  const cleanupInterval = setInterval(() => {
    const currentTime = now();
    for (const [key, entry] of requestsByClient) {
      if (entry.resetAt <= currentTime) requestsByClient.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanupInterval.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const currentTime = now();
    const clientKey = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = requestsByClient.get(clientKey);

    if (!entry || entry.resetAt <= currentTime) {
      if (requestsByClient.size >= maxKeys) {
        for (const [key, value] of requestsByClient) {
          if (value.resetAt <= currentTime) requestsByClient.delete(key);
        }
      }
      if (requestsByClient.size >= maxKeys && !entry) {
        return res.status(503).json({ message: 'Request protection is temporarily busy. Try again shortly.', code: 'RATE_LIMITER_BUSY', requestId: req.id || null });
      }
      entry = { count: 0, resetAt: currentTime + windowMs };
      requestsByClient.set(clientKey, entry);
    }

    if (entry.count >= max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000))));
      return res.status(429).json({ message, code, requestId: req.id || null });
    }

    entry.count += 1;
    return next();
  };
}

const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many requests. Please wait and try again.',
});

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  code: 'LOGIN_RATE_LIMITED',
});

const registrationRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: 'Too many account creation attempts. Please try again later.',
  code: 'REGISTRATION_RATE_LIMITED',
});

module.exports = { apiRateLimiter, createRateLimiter, loginRateLimiter, registrationRateLimiter };
