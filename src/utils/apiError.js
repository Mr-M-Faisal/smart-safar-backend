class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendApiError(res, error, fallback, duplicateMessage = 'A record with those details already exists.') {
  const requestId = res.req?.id || null;
  const respond = (status, message, code) => res.status(status).json({ message, code, requestId });
  if (!(error instanceof ApiError) && (error.status >= 500 || !error.status)) console.error(JSON.stringify({ requestId, message: error.message, stack: error.stack }));
  if (error instanceof ApiError) return respond(error.status, error.message, error.code || 'API_ERROR');
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return respond(error.status, error.message || fallback, error.code || 'REQUEST_REJECTED');
  if (error.code === 11000) return respond(409, duplicateMessage, 'DUPLICATE_RECORD');
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return respond(400, 'Invalid request data. Check the supplied fields.', 'INVALID_REQUEST');
  }
  if (error.code === 20) {
    return respond(503, 'Assignment changes require a transaction-capable MongoDB deployment.', 'TRANSACTIONS_UNAVAILABLE');
  }
  return respond(500, fallback, 'INTERNAL_ERROR');
}

module.exports = { ApiError, sendApiError };
