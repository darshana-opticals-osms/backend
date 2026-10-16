const catchAsync = require('../utils/catchAsync');
const { ValidationError } = require('../errors/AppError');
const {
  initiatePayment: initiatePaymentService,
  getOwnOrderPaymentStatus: getOwnOrderPaymentStatusService,
  processVerifiedNotification,
} = require('../services/payment.service');
const { validatePayHereNotification } = require('../validations/payment.validation');
const monitoring = require('../services/paymentMonitoring.service');
const { recordConfirmedManualFullRefund } = require('../services/manualRefund.service');
const recovery = require('../services/paymentRecovery.service');

const recoverPayment = catchAsync(async (req, res) => {
  const result = await recovery.recoverPayment({
    auth: req.auth,
    paymentId: req.params.paymentId,
    dryRun: req.body?.dryRun ?? true,
  });
  return res.status(200).json({ success: true, data: result });
});
const listRetrievalEvidence = catchAsync(async (req, res) => {
  const result = await recovery.listRetrievalEvidence({
    auth: req.auth,
    paymentId: req.params.paymentId,
    query: req.query,
  });
  return res.status(200).json({ success: true, data: result });
});

const recordManualFullRefund = catchAsync(async (req, res) => {
  const result = await recordConfirmedManualFullRefund({
    auth: req.auth,
    paymentId: req.params.paymentId,
    evidence: req.body,
    idempotencyKey: req.get('Idempotency-Key'),
  });
  return res.status(200).json({ success: true, data: result });
});

const initiatePayment = catchAsync(async (req, res) => {
  const result = await initiatePaymentService({
    customerId: req.auth.userId,
    orderId: req.body.orderId,
    billingInput: req.body,
  });
  return res.status(201).json({ success: true, data: result });
});

const getOwnOrderPaymentStatus = catchAsync(async (req, res) => {
  const result = await getOwnOrderPaymentStatusService({
    customerId: req.auth.userId,
    orderId: req.params.orderId,
  });
  return res.status(200).json({ success: true, data: result });
});

const receivePayHereNotification = catchAsync(async (req, res) => {
  const errors = validatePayHereNotification(req);
  if (errors.length) throw new ValidationError('Invalid PayHere notification.', errors);
  await processVerifiedNotification(req.body);
  return res.status(200).type('text/plain').send('OK');
});

const listManagementPayments = catchAsync(async (req, res) => {
  const result = await monitoring.listManagementPayments({ role: req.auth.role, query: req.query });
  return res.status(200).json({ success: true, data: result });
});
const getManagementPayment = catchAsync(async (req, res) => {
  const result = await monitoring.getManagementPayment({
    role: req.auth.role,
    paymentId: req.params.paymentId,
  });
  return res.status(200).json({ success: true, data: result });
});
const listManagementPaymentEvents = catchAsync(async (req, res) => {
  const result = await monitoring.listManagementPaymentEvents({
    role: req.auth.role,
    paymentId: req.params.paymentId,
    query: req.query,
  });
  return res.status(200).json({ success: true, data: result });
});

module.exports = {
  recoverPayment,
  listRetrievalEvidence,
  recordManualFullRefund,
  initiatePayment,
  getOwnOrderPaymentStatus,
  receivePayHereNotification,
  listManagementPayments,
  getManagementPayment,
  listManagementPaymentEvents,
};
