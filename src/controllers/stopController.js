const Route = require('../models/Route');
const Stop = require('../models/Stop');
const { ApiError, sendApiError } = require('../utils/apiError');
const { assertObjectId, requireObjectBody } = require('../utils/accountValidation');

function validateStopFields(body, { partial = false } = {}) {
  requireObjectBody(body);
  const allowedFields = partial
    ? ['stopName', 'latitude', 'longitude', 'stopOrder']
    : ['route', 'stopName', 'latitude', 'longitude', 'stopOrder'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new ApiError(400, `Only ${allowedFields.join(', ')} can be provided.`);
  }

  const fields = {};
  if (!partial || Object.hasOwn(body, 'route')) {
    assertObjectId(body.route, 'Route ID');
    fields.route = body.route;
  }
  if (!partial || Object.hasOwn(body, 'stopName')) {
    if (typeof body.stopName !== 'string' || !body.stopName.trim()) throw new ApiError(400, 'Stop name is required.');
    fields.stopName = body.stopName.trim();
    if (fields.stopName.length > 120) throw new ApiError(400, 'Stop name must be 120 characters or fewer.');
  }
  for (const field of ['latitude', 'longitude']) {
    if (partial && !Object.hasOwn(body, field)) continue;
    const value = body[field];
    const minimum = field === 'latitude' ? 30.9 : 72.6;
    const maximum = field === 'latitude' ? 32.0 : 73.7;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new ApiError(400, `${field} must be within the Faisalabad service area (${minimum} to ${maximum}).`);
    }
    fields[field] = value;
  }
  if (!partial || Object.hasOwn(body, 'stopOrder')) {
    if (!Number.isInteger(body.stopOrder) || body.stopOrder < 1) throw new ApiError(400, 'Stop order must be a positive whole number.');
    fields.stopOrder = body.stopOrder;
  }
  if (partial && !Object.keys(fields).length) throw new ApiError(400, 'Provide at least one stop field to update.');
  return fields;
}

async function createStop(req, res) {
  try {
    const fields = validateStopFields(req.body);
    const routeExists = await Route.exists({ _id: fields.route, isActive: true });
    if (!routeExists) return res.status(404).json({ message: 'Active route not found.' });
    if (await Stop.exists({ route: fields.route, stopOrder: fields.stopOrder })) {
      return res.status(409).json({ message: 'That stop order is already used on this route. Choose another order.' });
    }
    const stop = await Stop.create(fields);
    return res.status(201).json(stop);
  } catch (error) {
    return sendApiError(res, error, 'Could not create stop.');
  }
}

async function getStopsByRoute(req, res) {
  try {
    assertObjectId(req.params.routeId, 'Route ID');
    const stops = await Stop.find({ route: req.params.routeId }).sort({ stopOrder: 1, _id: 1 }).lean();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(stops);
  } catch (error) {
    return sendApiError(res, error, 'Could not load route stops.');
  }
}

async function getStopById(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const stop = await Stop.findById(req.params.id).populate('route', 'routeName').lean();
    if (!stop) return res.status(404).json({ message: 'Stop not found.' });
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    return res.status(200).json(stop);
  } catch (error) {
    return sendApiError(res, error, 'Could not load stop.');
  }
}

async function updateStop(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const fields = validateStopFields(req.body, { partial: true });
    if (fields.stopOrder !== undefined) {
      const current = await Stop.findById(req.params.id).select('route').lean();
      if (!current) return res.status(404).json({ message: 'Stop not found.' });
      if (await Stop.exists({ route: current.route, stopOrder: fields.stopOrder, _id: { $ne: req.params.id } })) {
        return res.status(409).json({ message: 'That stop order is already used on this route. Choose another order.' });
      }
    }
    const stop = await Stop.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true });
    if (!stop) return res.status(404).json({ message: 'Stop not found.' });
    return res.status(200).json(stop);
  } catch (error) {
    return sendApiError(res, error, 'Could not update stop.');
  }
}

async function deleteStop(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const stop = await Stop.findByIdAndDelete(req.params.id);
    if (!stop) return res.status(404).json({ message: 'Stop not found.' });
    return res.status(200).json({ message: 'Stop removed.' });
  } catch (error) {
    return sendApiError(res, error, 'Could not remove stop.');
  }
}

async function reorderStop(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const direction = req.body?.direction;
    if (!['up', 'down'].includes(direction)) throw new ApiError(400, 'Direction must be up or down.');
    const current = await Stop.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ message: 'Stop not found.' });
    const routeStops = await Stop.find({ route: current.route }).sort({ stopOrder: 1, _id: 1 }).lean();
    const index = routeStops.findIndex((stop) => String(stop._id) === String(current._id));
    const neighbor = routeStops[index + (direction === 'up' ? -1 : 1)];
    if (!neighbor) return res.status(200).json({ message: 'Stop is already at the end of the route.', stops: routeStops });

    // Move the current row to a temporary order while the adjacent rows
    // exchange positions, so the ordering remains deterministic throughout.
    const temporaryOrder = Math.max(0, ...routeStops.map((stop) => Number(stop.stopOrder) || 0)) + 1;
    await Stop.findByIdAndUpdate(current._id, { $set: { stopOrder: temporaryOrder } }, { runValidators: true });
    await Stop.findByIdAndUpdate(neighbor._id, { $set: { stopOrder: current.stopOrder } }, { runValidators: true });
    await Stop.findByIdAndUpdate(current._id, { $set: { stopOrder: neighbor.stopOrder } }, { runValidators: true });
    const stops = await Stop.find({ route: current.route }).sort({ stopOrder: 1, _id: 1 }).lean();
    return res.status(200).json({ message: 'Stop order updated.', stops });
  } catch (error) {
    return sendApiError(res, error, 'Could not reorder stop.');
  }
}

module.exports = { createStop, getStopsByRoute, getStopById, updateStop, deleteStop, reorderStop };
