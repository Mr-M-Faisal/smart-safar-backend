const Route = require('../models/Route');
const { ApiError, sendApiError } = require('../utils/apiError');
const { assertObjectId, requireObjectBody } = require('../utils/accountValidation');

const routeTextLimits = { routeName: 100, startPoint: 100, endPoint: 100, description: 500 };

function validateRouteFields(body, { partial = false } = {}) {
  requireObjectBody(body);
  const allowedFields = Object.keys(routeTextLimits);
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new ApiError(400, `Only ${allowedFields.join(', ')} can be provided.`);
  }

  const fields = {};
  for (const field of allowedFields) {
    if (!Object.hasOwn(body, field)) continue;
    if (typeof body[field] !== 'string') throw new ApiError(400, `${field} must be text.`);
    const value = body[field].trim();
    if (field !== 'description' && !value) throw new ApiError(400, `${field} is required.`);
    if (value.length > routeTextLimits[field]) throw new ApiError(400, `${field} must be ${routeTextLimits[field]} characters or fewer.`);
    fields[field] = value;
  }

  if (!partial) {
    for (const field of ['routeName', 'startPoint', 'endPoint']) {
      if (!fields[field]) throw new ApiError(400, `${field} is required.`);
    }
    fields.description ??= '';
  } else if (!Object.keys(fields).length) {
    throw new ApiError(400, 'Provide at least one route field to update.');
  }
  return fields;
}

async function createRoute(req, res) {
  try {
    const route = await Route.create(validateRouteFields(req.body));
    return res.status(201).json(route);
  } catch (error) {
    return sendApiError(res, error, 'Could not create route.');
  }
}

async function getRoutes(_req, res) {
  try {
    const routes = await Route.find({ isActive: true }).sort({ createdAt: -1 });
    return res.status(200).json(routes);
  } catch (error) {
    return sendApiError(res, error, 'Could not load routes.');
  }
}

async function getRouteById(req, res) {
  try {
    assertObjectId(req.params.id, 'Route ID');
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ message: 'Route not found.' });
    return res.status(200).json(route);
  } catch (error) {
    return sendApiError(res, error, 'Could not load route.');
  }
}

async function updateRoute(req, res) {
  try {
    assertObjectId(req.params.id, 'Route ID');
    const fields = validateRouteFields(req.body, { partial: true });
    const route = await Route.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true });
    if (!route) return res.status(404).json({ message: 'Route not found.' });
    return res.status(200).json(route);
  } catch (error) {
    return sendApiError(res, error, 'Could not update route.');
  }
}

async function deleteRoute(req, res) {
  try {
    assertObjectId(req.params.id, 'Route ID');
    const route = await Route.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!route) return res.status(404).json({ message: 'Route not found.' });
    return res.status(200).json({ message: 'Route removed from service.' });
  } catch (error) {
    return sendApiError(res, error, 'Could not remove route.');
  }
}

module.exports = { createRoute, getRoutes, getRouteById, updateRoute, deleteRoute };
