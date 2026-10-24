const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apiKey, createMemoryStore, createRateLimiter, loginKey } = require('../src/middleware/rateLimit');

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; return this; },
  };
}

test('login limiter identity includes normalized email and client IP', () => {
  assert.equal(loginKey({ ip: '198.51.100.1', body: { email: ' User@Example.com ' } }), 'login:198.51.100.1:user@example.com');
  assert.notEqual(loginKey({ ip: '198.51.100.1', body: { email: 'first@example.com' } }), loginKey({ ip: '198.51.100.1', body: { email: 'second@example.com' } }));
  assert.notEqual(loginKey({ ip: '198.51.100.1', body: { email: 'user@example.com' } }), loginKey({ ip: '198.51.100.2', body: { email: 'user@example.com' } }));
});

test('authenticated API identity uses user id and unauthenticated identity uses IP', () => {
  const jwt = require('jsonwebtoken');
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-signing';
  const token = jwt.sign({ id: 'user-123' }, process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
  assert.equal(apiKey({ ip: '198.51.100.1', headers: { authorization: `Bearer ${token}` } }), 'user:user-123');
  assert.equal(apiKey({ ip: '198.51.100.2', headers: {} }), 'ip:198.51.100.2');
});

test('rate limiter blocks only the key that reaches its limit', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, message: 'slow down', keyGenerator: loginKey, store: createMemoryStore() });
  const first = response();
  let passed = 0;
  limiter({ ip: '198.51.100.1', body: { email: 'a@example.com' } }, first, () => { passed += 1; });
  const blocked = response();
  limiter({ ip: '198.51.100.1', body: { email: 'A@example.com' } }, blocked, () => { passed += 1; });
  const other = response();
  limiter({ ip: '198.51.100.1', body: { email: 'b@example.com' } }, other, () => { passed += 1; });
  assert.equal(passed, 2);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.equal(other.statusCode, 200);
});
