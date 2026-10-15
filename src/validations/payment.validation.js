const mongoose = require('mongoose');
const { PAYHERE_STATUS_CODE_VALUES } = require('../constants/payment');

const ALLOWED_INITIATION_FIELDS = new Set(['orderId', 'city', 'firstName', 'lastName', 'address']);
const PAYHERE_NOTIFICATION_FIELDS = Object.freeze([
  'merchant_id',
  'order_id',
  'payment_id',
  'payhere_amount',
  'payhere_currency',
  'status_code',
  'md5sig',
  'custom_1',
  'custom_2',
  'method',
  'status_message',
  // Sandbox Checkout notifications may include this unsigned provider metadata.
  // Financial verification still uses payhere_amount, never captured_amount.
  'captured_amount',
  'card_holder_name',
  'card_no',
  'card_expiry',
]);
const REQUIRED_NOTIFICATION_FIELDS = Object.freeze([
  'merchant_id',
  'order_id',
  'payment_id',
  'payhere_amount',
  'payhere_currency',
  'status_code',
  'md5sig',
]);

function validatePaymentInitiation(req) {
  const errors = [];
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'A JSON object is required.' }];
  }

  for (const field of Object.keys(body)) {
    if (!ALLOWED_INITIATION_FIELDS.has(field)) {
      errors.push({ field, message: `${field} is not supported for payment initiation.` });
    }
  }

  if (!mongoose.isValidObjectId(body.orderId)) {
    errors.push({ field: 'orderId', message: 'orderId must be a valid MongoDB ObjectId.' });
  }

  for (const field of ['city', 'firstName', 'lastName', 'address']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 120) {
        errors.push({
          field,
          message: `${field} must be a non-empty string of at most 120 characters.`,
        });
      }
    }
  }
  return errors;
}

function validatePaymentStatusRequest(req) {
  return mongoose.isValidObjectId(req.params.orderId)
    ? []
    : [{ field: 'orderId', message: 'orderId must be a valid MongoDB ObjectId.' }];
}

function validatePayHereNotification(req) {
  const errors = [];
  if (!req.is('application/x-www-form-urlencoded')) {
    errors.push({ field: 'content-type', message: 'PayHere notification must be form encoded.' });
    return errors;
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'A form-encoded object is required.' }];
  }

  for (const [field, value] of Object.entries(body)) {
    if (!PAYHERE_NOTIFICATION_FIELDS.includes(field)) {
      errors.push({ field, message: 'Unsupported PayHere notification field.' });
    } else if (typeof value !== 'string') {
      errors.push({ field, message: `${field} must be a single string value.` });
    }
  }

  for (const field of REQUIRED_NOTIFICATION_FIELDS) {
    if (typeof body[field] !== 'string' || body[field] === '') {
      errors.push({ field, message: `${field} is required.` });
    }
  }

  if (
    typeof body.status_code === 'string' &&
    !PAYHERE_STATUS_CODE_VALUES.includes(body.status_code)
  ) {
    errors.push({ field: 'status_code', message: 'Unsupported PayHere status code.' });
  }
  if (typeof body.md5sig === 'string' && !/^[A-F0-9]{32}$/.test(body.md5sig)) {
    errors.push({ field: 'md5sig', message: 'Invalid PayHere signature format.' });
  }
  if (typeof body.payhere_amount === 'string' && !/^\d+\.\d{2}$/.test(body.payhere_amount)) {
    errors.push({ field: 'payhere_amount', message: 'Invalid PayHere amount format.' });
  }
  if (
    body.captured_amount !== undefined &&
    (typeof body.captured_amount !== 'string' || !/^\d+\.\d{2}$/.test(body.captured_amount))
  ) {
    errors.push({ field: 'captured_amount', message: 'Invalid PayHere captured amount format.' });
  }

  return errors;
}

module.exports = {
  validatePaymentInitiation,
  validatePaymentStatusRequest,
  validatePayHereNotification,
};
