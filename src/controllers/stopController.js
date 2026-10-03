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
    const minimum = field === 'latitude' ? -90 : -180;
    const maximum = field === 'latitude' ? 90 : 180;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new ApiError(400, `${field} must be a valid geographic coordinate.`);
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
    const stop = await Stop.create(fields);
    return res.status(201).json(stop);
  } catch (error) {
    return sendApiError(res, error, 'Could not create stop.');
  }
}

async function getStopsByRoute(req, res) {
  try {
    assertObjectId(req.params.routeId, 'Route ID');
    const stops = await Stop.find({ route: req.params.routeId }).sort({ stopOrder: 1 });
    return res.status(200).json(stops);
  } catch (error) {
    return sendApiError(res, error, 'Could not load route stops.');
  }
}

async function getStopById(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const stop = await Stop.findById(req.params.id).populate('route', 'routeName');
    if (!stop) return res.status(404).json({ message: 'Stop not found.' });
    return res.status(200).json(stop);
  } catch (error) {
    return sendApiError(res, error, 'Could not load stop.');
  }
}

async function updateStop(req, res) {
  try {
    assertObjectId(req.params.id, 'Stop ID');
    const fields = validateStopFields(req.body, { partial: true });
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

module.exports = { createStop, getStopsByRoute, getStopById, updateStop, deleteStop };
