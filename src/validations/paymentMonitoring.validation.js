const { PAYMENT_STATUS_VALUES, PAYHERE_STATUS_CODE_VALUES } = require('../constants/payment');
const { ValidationError } = require('../errors/AppError');

const PAYMENT_SORT_FIELDS = ['createdAt', 'updatedAt', 'amount', 'status'];
const EVENT_SORT_FIELDS = ['verifiedAt', 'createdAt'];
const EVENT_ACTIONS = ['applied', 'duplicate', 'reconciliation_required'];
const isIdentifier = (value) => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);

function queryErrors(query = {}, events = false) {
  if (!query || typeof query !== 'object' || Array.isArray(query))
    return [{ field: 'query', message: 'Query parameters must be an object.' }];
  const errors = [];
  const allowed = events
    ? ['page', 'limit', 'sortBy', 'sortOrder', 'providerTransactionId', 'action', 'statusCode']
    : [
        'page',
        'limit',
        'sortBy',
        'sortOrder',
        'providerTransactionId',
        'status',
        'orderId',
        'reconciliationRequired',
      ];
  for (const field of Object.keys(query)) {
    if (!allowed.includes(field))
      errors.push({ field, message: 'Unsupported monitoring query parameter.' });
  }
  for (const [field, max] of [
    ['page', 10000],
    ['limit', 100],
  ]) {
    const value = query[field];
    if (
      value !== undefined &&
      (typeof value !== 'string' ||
        value.length > 5 ||
        !/^[1-9]\d*$/.test(value) ||
        Number(value) > max)
    ) {
      errors.push({ field, message: `${field} must be an integer from 1 to ${max}.` });
    }
  }
  for (const [field, values] of [
    ['sortBy', events ? EVENT_SORT_FIELDS : PAYMENT_SORT_FIELDS],
    ['sortOrder', ['asc', 'desc']],
    ['status', PAYMENT_STATUS_VALUES],
    ['reconciliationRequired', ['true', 'false']],
    ['action', EVENT_ACTIONS],
    ['statusCode', PAYHERE_STATUS_CODE_VALUES],
  ]) {
    if (query[field] !== undefined && !values.includes(query[field]))
      errors.push({ field, message: `Invalid ${field}.` });
  }
  if (query.orderId !== undefined && !isIdentifier(query.orderId))
    errors.push({ field: 'orderId', message: 'orderId must be a valid MongoDB ObjectId.' });
  if (
    query.providerTransactionId !== undefined &&
    (typeof query.providerTransactionId !== 'string' ||
      !query.providerTransactionId.trim() ||
      query.providerTransactionId.length > 120 ||
      Array.from(query.providerTransactionId).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ))
  ) {
    errors.push({
      field: 'providerTransactionId',
      message:
        'Provider reference must be a non-empty scalar string of at most 120 characters without control characters.',
    });
  }
  return errors;
}

function parseMonitoringQuery(query = {}, events = false) {
  const errors = queryErrors(query, events);
  if (errors.length) throw new ValidationError('Invalid payment monitoring query.', errors);
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 25);
  const sortBy = query.sortBy || (events ? 'verifiedAt' : 'createdAt');
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const filter = {};
  if (query.providerTransactionId !== undefined)
    filter.providerTransactionId = query.providerTransactionId;
  if (events) {
    if (query.action !== undefined) filter.action = query.action;
    if (query.statusCode !== undefined) filter.statusCode = query.statusCode;
  } else {
    if (query.status !== undefined) filter.status = query.status;
    if (query.orderId !== undefined) filter.orderId = query.orderId;
    if (query.reconciliationRequired !== undefined)
      filter.reconciliationRequired =
        query.reconciliationRequired === 'true' ? true : { $ne: true };
  }
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    filter,
    sort: { [sortBy]: direction, _id: direction },
  };
}

const identifierErrors = (req) =>
  isIdentifier(req.params.paymentId)
    ? []
    : [{ field: 'paymentId', message: 'paymentId must be a valid MongoDB ObjectId.' }];
const validatePaymentMonitoringList = (req) => queryErrors(req.query);
const validatePaymentMonitoringDetail = (req) => [
  ...identifierErrors(req),
  ...Object.keys(req.query || {}).map((field) => ({
    field,
    message: 'Payment detail does not accept query parameters.',
  })),
];
const validatePaymentMonitoringEvents = (req) => [
  ...identifierErrors(req),
  ...queryErrors(req.query, true),
];

module.exports = {
  parseMonitoringQuery,
  isIdentifier,
  validatePaymentMonitoringList,
  validatePaymentMonitoringDetail,
  validatePaymentMonitoringEvents,
};
