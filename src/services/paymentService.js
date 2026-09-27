const crypto = require('crypto');
const { ApiError } = require('../utils/apiError');
const { requireObjectBody } = require('../utils/accountValidation');

function getBookingPrice() {
  const fare = Number(process.env.BOOKING_FARE ?? 0);
  if (!Number.isFinite(fare) || fare < 0) {
    throw new ApiError(503, 'BOOKING_FARE must be configured as a non-negative number.');
  }

  const currency = String(process.env.BOOKING_CURRENCY || 'PKR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(503, 'BOOKING_CURRENCY must be a three-letter currency code.');
  }

  return { fare, currency };
}

function notificationMessage(notification) {
  return JSON.stringify([
    notification.paymentReference,
    notification.status,
    notification.amount,
    notification.currency,
    notification.providerTransactionId,
    notification.failureReason || null,
  ]);
}

function validatePaymentNotification(body) {
  requireObjectBody(body);
  const allowed = [
    'paymentReference',
    'status',
    'amount',
    'currency',
    'providerTransactionId',
    'failureReason',
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'Payment notification contains unsupported fields.');
  }

  const paymentReference =
    typeof body.paymentReference === 'string' ? body.paymentReference.trim() : '';
  const providerTransactionId =
    typeof body.providerTransactionId === 'string' ? body.providerTransactionId.trim() : '';
  const status = body.status;
  const amount = Number(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';

  if (!paymentReference) throw new ApiError(400, 'paymentReference is required.');
  if (!['paid', 'failed'].includes(status)) {
    throw new ApiError(400, 'Payment status must be paid or failed.');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, 'Payment amount must be a non-negative number.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(400, 'Payment currency must be a three-letter currency code.');
  }
  if (!providerTransactionId) {
    throw new ApiError(400, 'providerTransactionId is required.');
  }
  if (
    Object.hasOwn(body, 'failureReason') &&
    body.failureReason !== null &&
    typeof body.failureReason !== 'string'
  ) {
    throw new ApiError(400, 'failureReason must be a string.');
  }

  return {
    paymentReference,
    status,
    amount,
    currency,
    providerTransactionId,
    failureReason:
      typeof body.failureReason === 'string' ? body.failureReason.trim().slice(0, 500) : null,
  };
}

function verifyPaymentNotification(body, signatureHeader) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(503, 'Payment verification is not configured.');
  }

  const notification = validatePaymentNotification(body);
  const supplied = String(signatureHeader || '').replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[a-f\d]{64}$/.test(supplied)) {
    throw new ApiError(401, 'Invalid payment notification signature.');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(notificationMessage(notification))
    .digest('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
  if (!valid) throw new ApiError(401, 'Invalid payment notification signature.');

  return notification;
}

module.exports = {
  getBookingPrice,
  notificationMessage,
  verifyPaymentNotification,
};
