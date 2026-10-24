const test = require('node:test');
const assert = require('node:assert/strict');
const { canJoinBusRoom, canJoinSocketRoom, installSocketEventRateLimit } = require('../src/middleware/socketSecurity');

test('watchBus accepts only strict ObjectId room names', () => {
  const socket = { id: 'socket-1', rooms: new Set(['socket-1']) };
  assert.equal(canJoinBusRoom(socket, '507f1f77bcf86cd799439011'), null);
  assert.equal(canJoinBusRoom(socket, 'not-an-object-id'), 'INVALID_BUS_ID');
  assert.equal(canJoinBusRoom(socket, '507f1f77bcf86cd79943901'), 'INVALID_BUS_ID');
});

test('socket room cap counts all joined application rooms and permits idempotent joins', () => {
  const rooms = new Set(['socket-1', ...Array.from({ length: 20 }, (_, index) => `bus:${index}`)]);
  const socket = { id: 'socket-1', rooms };
  assert.equal(canJoinSocketRoom(socket, 'bus:0'), true);
  assert.equal(canJoinBusRoom(socket, '507f1f77bcf86cd799439011'), 'ROOM_LIMIT');
});

test('socket event limiter blocks events above its per-connection limit and resets', async () => {
  let now = 1_000;
  let middleware;
  const socket = { use(callback) { middleware = callback; } };
  installSocketEventRateLimit(socket, { maxEvents: 2, windowMs: 1_000, now: () => now });
  const run = () => new Promise((resolve) => middleware(['watchBus', 'id'], (error) => resolve(error || null)));
  assert.equal(await run(), null);
  assert.equal(await run(), null);
  assert.equal((await run()).data.code, 'SOCKET_RATE_LIMITED');
  now += 1_000;
  assert.equal(await run(), null);
});
