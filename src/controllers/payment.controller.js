const catchAsync = require('../utils/catchAsync');
const { ValidationError } = require('../errors/AppError');
const {
  initiatePayment: initiatePaymentService,
  getOwnOrderPaymentStatus: getOwnOrderPaymentStatusService,
  processVerifiedNotification,
} = require('../services/payment.service');
const { validatePayHereNotification } = require('../validations/payment.validation');

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

module.exports = { initiatePayment, getOwnOrderPaymentStatus, receivePayHereNotification };
