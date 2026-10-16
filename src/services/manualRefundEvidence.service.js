const crypto = require('crypto');
const mongoose = require('mongoose');
const ManualRefundEvidence = require('../models/manualRefundEvidence.model');
const Payment = require('../models/payment.model');
const { ROLE_VALUES } = require('../constants/roles');
const { PAYMENT_STATUS } = require('../constants/payment');
const {
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../errors/AppError');
const {
  validateManualRefundEvidence,
  assertFullRefundAmount,
  validReference,
} = require('../validations/manualRefundEvidence.validation');
const { formatAmount } = require('./adapters/PayHerePaymentAdapter');

function shapeManualRefundEvidence(record) {
  return {
    evidenceId: record._id.toString(),
    paymentId: record.paymentId.toString(),
    orderId: record.orderId.toString(),
    providerOrderId: record.providerOrderId ?? null,
    providerTransactionId: record.providerTransactionId ?? null,
    amount: record.amount,
    currency: record.currency,
    refundChannel: record.refundChannel ?? null,
    refundReference: record.refundReference ?? null,
    recordedBy: record.recordedBy.toString(),
    createdAt: record.createdAt,
  };
}

// Internal append primitive only: intentionally not wired to routes/controllers.
// The trusted caller supplies evidence of an already confirmed external refund.
// This does not independently verify a transfer or apply any financial state change.
async function appendConfirmedManualRefundEvidence({
  auth,
  paymentId,
  evidence,
  idempotencyKey,
  session = null,
}) {
  if (auth?.role !== ROLE_VALUES.BRANCH_MANAGER)
    throw new ForbiddenError('Refund evidence requires BRANCH_MANAGER.');
  if (
    !mongoose.isValidObjectId(auth.userId) ||
    typeof auth.userId !== 'string' ||
    typeof paymentId !== 'string' ||
    !/^[a-fA-F0-9]{24}$/.test(paymentId) ||
    !validReference(idempotencyKey)
  ) {
    throw new ValidationError('Invalid refund audit identifiers or idempotency key.');
  }
  const normalized = validateManualRefundEvidence(evidence);
  const requestHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        paymentId.toLowerCase(),
        auth.userId.toLowerCase(),
        formatAmount(normalized.amount),
        normalized.currency,
        normalized.refundChannel,
        normalized.refundReference,
      ])
    )
    .digest('hex');
  const conflict = () =>
    new ConflictError(
      'Refund evidence already exists or the idempotency key was reused with different data.',
      null,
      'REFUND_EVIDENCE_CONFLICT'
    );
  // Do not race the model's initial unique-index build on first internal use.
  await ManualRefundEvidence.init();
  const callerOwnsTransaction = session?.inTransaction() === true;
  const existing = await ManualRefundEvidence.findOne({ idempotencyKey })
    .session(session)
    .select('+requestHash')
    .lean();
  if (existing && existing.requestHash !== requestHash) throw conflict();

  const payment = await Payment.findById(paymentId).session(session).lean();
  if (!payment) throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  if (
    payment.reconciliationRequired ||
    (await Payment.exists({ orderId: payment.orderId, reconciliationRequired: true }).session(
      session
    ))
  ) {
    throw new ConflictError(
      'Payment reconciliation must be resolved before appending refund evidence.',
      null,
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
  }
  // Only the approved canonical capture/refund relationship is represented here.
  // Failed/cancelled attempts with late-capture events require the later reconciliation design.
  if (![PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.REFUNDED].includes(payment.status)) {
    throw new ConflictError(
      'Refund evidence source is not a canonical completed/refunded Payment.',
      null,
      'REFUND_EVIDENCE_SOURCE_UNSUPPORTED'
    );
  }
  assertFullRefundAmount(normalized, payment);
  if (existing) return shapeManualRefundEvidence(existing);
  try {
    const [record] = await ManualRefundEvidence.create(
      [
        {
          paymentId: payment._id,
          orderId: payment.orderId,
          providerOrderId: payment.providerOrderId ?? null,
          providerTransactionId: payment.providerTransactionId ?? null,
          ...normalized,
          recordedBy: auth.userId,
          idempotencyKey,
          requestHash,
        },
      ],
      { session }
    );
    return shapeManualRefundEvidence(record);
  } catch (error) {
    if (error.code !== 11000) throw error;
    // A duplicate key aborts a MongoDB transaction. Leave abort/retry to its owner;
    // querying for a winner here would use an aborted transaction and mask the cause.
    if (callerOwnsTransaction) throw error;
    const winner = await ManualRefundEvidence.findOne({ idempotencyKey })
      .session(session)
      .select('+requestHash')
      .lean();
    if (winner?.requestHash === requestHash) return shapeManualRefundEvidence(winner);
    throw conflict();
  }
}

module.exports = { appendConfirmedManualRefundEvidence, shapeManualRefundEvidence };
