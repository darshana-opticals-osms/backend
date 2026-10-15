const Payment = require('../models/payment.model');
const PaymentEvent = require('../models/paymentEvent.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ForbiddenError, NotFoundError, ValidationError } = require('../errors/AppError');
const {
  parseMonitoringQuery,
  isIdentifier,
} = require('../validations/paymentMonitoring.validation');

const PAYMENT_FIELDS =
  '_id orderId amount currency method status provider providerOrderId providerTransactionId providerPaymentMethod failureReason expiresAt reconciliationRequired reconciliationReason createdAt updatedAt';
const EVENT_FIELDS =
  '_id paymentId orderId provider providerOrderId providerTransactionId statusCode amount currency action reason verifiedAt createdAt';
const SAFE_REASONS = new Set([
  'PAYHERE_PAYMENT_FAILED',
  'PAYHERE_AMOUNT_CURRENCY_MISMATCH',
  'PAYHERE_CHARGEBACK_REVIEW',
  'DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION',
  'LATE_SUCCESS_TERMINAL_ATTEMPT',
  'SUCCESS_WHILE_RECONCILIATION_PENDING',
  'OTHER_PAYMENT_RECONCILIATION_PENDING',
  'DUPLICATE_SUCCESSFUL_CHARGE',
  'LATE_SUCCESS_ORDER_NOT_PAYABLE',
  'LATE_SUCCESS_RESERVATION_EXPIRED',
]);
const safeReason = (reason) => (SAFE_REASONS.has(reason) ? reason : null);

function assertManager(role) {
  if (role !== ROLE_VALUES.BRANCH_MANAGER)
    throw new ForbiddenError('Payment monitoring requires BRANCH_MANAGER.');
}

function assertPaymentId(paymentId) {
  if (!isIdentifier(paymentId))
    throw new ValidationError('Invalid Payment identifier.', [
      { field: 'paymentId', message: 'paymentId must be a valid MongoDB ObjectId.' },
    ]);
}

function shapeManagementPayment(payment) {
  return {
    paymentId: payment._id.toString(),
    orderId: payment.orderId.toString(),
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId || null,
    providerTransactionId: payment.providerTransactionId || null,
    providerPaymentMethod: payment.providerPaymentMethod || null,
    failureReason: safeReason(payment.failureReason),
    expiresAt: payment.expiresAt || null,
    reconciliationRequired: Boolean(payment.reconciliationRequired),
    reconciliationReason: safeReason(payment.reconciliationReason),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function shapeManagementEvent(event) {
  return {
    eventId: event._id.toString(),
    paymentId: event.paymentId.toString(),
    orderId: event.orderId.toString(),
    provider: event.provider,
    providerOrderId: event.providerOrderId,
    providerTransactionId: event.providerTransactionId || null,
    statusCode: event.statusCode,
    amount: event.amount,
    currency: event.currency,
    action: event.action,
    reason: safeReason(event.reason),
    verifiedAt: event.verifiedAt,
    createdAt: event.createdAt,
  };
}

async function paginated(model, fields, options, shape) {
  // Independent live reads: no transaction/session, no financial writes.
  const [records, total] = await Promise.all([
    model
      .find(options.filter)
      .select(fields)
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .maxTimeMS(5000)
      .lean(),
    model.countDocuments(options.filter).maxTimeMS(5000),
  ]);
  return {
    items: records.map(shape),
    pagination: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.ceil(total / options.limit),
    },
  };
}

async function listManagementPayments({ role, query = {} }) {
  assertManager(role);
  return paginated(Payment, PAYMENT_FIELDS, parseMonitoringQuery(query), shapeManagementPayment);
}

async function getManagementPayment({ role, paymentId }) {
  assertManager(role);
  assertPaymentId(paymentId);
  const payment = await Payment.findById(paymentId).select(PAYMENT_FIELDS).lean();
  if (!payment) throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  return shapeManagementPayment(payment);
}

async function listManagementPaymentEvents({ role, paymentId, query = {} }) {
  assertManager(role);
  assertPaymentId(paymentId);
  const options = parseMonitoringQuery(query, true);
  if (!(await Payment.exists({ _id: paymentId })))
    throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  options.filter.paymentId = paymentId;
  return paginated(PaymentEvent, EVENT_FIELDS, options, shapeManagementEvent);
}

module.exports = {
  listManagementPayments,
  getManagementPayment,
  listManagementPaymentEvents,
  shapeManagementPayment,
  shapeManagementEvent,
};
