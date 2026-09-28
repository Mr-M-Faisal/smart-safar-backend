const test = require('node:test');
const assert = require('node:assert/strict');
const { isOperatingShift } = require('../src/services/operatingBusRules');

const valid = () => ({ _id: 's1', route: 'r1', status: 'active', endedAt: null, bus: { _id: 'b1', route: 'r1', driver: 'd1' }, driver: { _id: 'd1', role: 'driver', assignedBus: 'b1' } });

test('an open assigned shift is operating; end shift removes it', () => {
  const shift = valid();
  assert.equal(isOperatingShift(shift, 'r1'), true);
  shift.status = 'completed'; shift.endedAt = new Date();
  assert.equal(isOperatingShift(shift, 'r1'), false);
});
test('active bus status alone cannot make a bus operating', () => {
  const shift = valid(); shift.endedAt = new Date();
  assert.equal(isOperatingShift(shift, 'r1'), false);
});
test('route identifier strings are compared consistently; duplicate route name is irrelevant', () => {
  assert.equal(isOperatingShift(valid(), { _id: 'r1', routeName: 'JWR - FSD' }), true);
  assert.equal(isOperatingShift(valid(), 'different-route-id'), false);
});
test('driver, bus and route assignment mismatches cannot become operating', () => {
  const shift = valid(); shift.bus.driver = 'd2';
  assert.equal(isOperatingShift(shift, 'r1'), false);
});
