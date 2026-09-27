const { ApiError } = require('./apiError');

function requireObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Provide a JSON object with the required fields.');
  }
}

function assertObjectId(value, label = 'Record ID') {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new ApiError(400, label + ' must be a valid MongoDB ObjectId.');
  }
}

function validateAccountFields(body, { create = false } = {}) {
  requireObjectBody(body);
  const allowed = create ? ['name', 'email', 'password', 'phone'] : ['name', 'email', 'phone'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'Only ' + allowed.join(', ') + ' can be provided.');
  }
  const values = {};
  for (const field of ['name', 'email']) {
    if (create || Object.hasOwn(body, field)) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        throw new ApiError(400, field + ' is required.');
      }
      values[field] = body[field].trim();
    }
  }
  if (values.email !== undefined) {
    values.email = values.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      throw new ApiError(400, 'Provide a valid email address.');
    }
  }
  if (create) {
    if (typeof body.password !== 'string' || body.password.length < 6) {
      throw new ApiError(400, 'Password must contain at least 6 characters.');
    }
    values.password = body.password;
  }
  if (Object.hasOwn(body, 'phone')) {
    if (typeof body.phone !== 'string') throw new ApiError(400, 'Phone must be a string.');
    values.phone = body.phone.trim();
  }
  if (!create && !Object.keys(values).length) throw new ApiError(400, 'Provide at least one editable driver field.');
  return values;
}

module.exports = { requireObjectBody, assertObjectId, validateAccountFields };
