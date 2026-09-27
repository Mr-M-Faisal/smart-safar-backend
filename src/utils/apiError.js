class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendApiError(res, error, fallback, duplicateMessage = 'A record with those details already exists.') {
  if (error instanceof ApiError) return res.status(error.status).json({ message: error.message });
  if (error.code === 11000) return res.status(409).json({ message: duplicateMessage });
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid request data. Check the supplied fields.' });
  }
  if (error.code === 20) {
    return res.status(503).json({ message: 'Assignment changes require a transaction-capable MongoDB deployment.' });
  }
  return res.status(500).json({ message: fallback });
}

module.exports = { ApiError, sendApiError };
