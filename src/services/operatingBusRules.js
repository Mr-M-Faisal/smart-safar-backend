const sameId = (a, b) => a != null && b != null && String(a._id || a) === String(b._id || b);

function isOperatingShift(shift, routeId) {
  return Boolean(shift && shift.status === 'active' && shift.endedAt == null && shift.bus && shift.driver
    && shift.driver.role === 'driver' && sameId(shift.route, routeId)
    && sameId(shift.bus.route, routeId) && sameId(shift.bus.driver, shift.driver._id)
    && sameId(shift.driver.assignedBus, shift.bus._id));
}

module.exports = { isOperatingShift };
