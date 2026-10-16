const mongoose = require('mongoose');
const Payment = require('../models/payment.model');
const PaymentEvent = require('../models/paymentEvent.model');
const Order = require('../models/order.model');
const ManualRefundEvidence = require('../models/manualRefundEvidence.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { ROLE_VALUES } = require('../constants/roles');
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
  PAYHERE_STATUS_CODE,
} = require('../constants/payment');
const {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
} = require('../errors/AppError');
const auditService = require('./audit.service');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../constants/audit');
const { isIdentifier } = require('../validations/paymentMonitoring.validation');
const {
  validateManualRefundEvidence,
  assertFullRefundAmount,
  validAmount,
  validReference,
} = require('../validations/manualRefundEvidence.validation');
const { formatAmount } = require('./adapters/PayHerePaymentAdapter');
const { appendConfirmedManualRefundEvidence } = require('./manualRefundEvidence.service');
const loyaltyRefund = require('./loyaltyRefundBoundary.service');

// Records an already executed external full refund; never calls a provider refund API.
// Missing earning/reversal evidence on a completed Order, or unresolved policy,
// holds abort new refunds AND replays.
async function recordConfirmedManualFullRefund({ auth, paymentId, evidence, idempotencyKey }) {
  if (!auth) throw new UnauthorizedError('Authentication required.');
  if (auth.role !== ROLE_VALUES.BRANCH_MANAGER)
    throw new ForbiddenError('Manual refund recording requires BRANCH_MANAGER.');
  if (!isIdentifier(auth.userId)) throw new UnauthorizedError('Authenticated actor required.');
  if (!isIdentifier(paymentId) || !validReference(idempotencyKey))
    throw new ValidationError('Invalid Payment identifier or idempotency key.');
  const normalized = validateManualRefundEvidence(evidence);
  await ManualRefundEvidence.init();
  await LoyaltyTransaction.init();
  const identity = await Payment.findById(paymentId).select('orderId').lean();
  if (!identity) throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  const session = await mongoose.startSession();
  try {
    // A duplicate-key error aborts its transaction: recover only by starting a new one.
    // Shared Order locking normally serializes requests; this also covers Part 1 writers.
    for (let retry = 0; retry < 2; retry += 1) {
      try {
        let result;
        await session.withTransaction(async () => {
          const order = await Order.findOneAndUpdate(
            { _id: identity.orderId },
            { $inc: { __v: 1 } },
            { session, new: true }
          ).lean();
          if (!order) throw new NotFoundError('Order not found.', null, 'ORDER_NOT_FOUND');
          const payment = await Payment.findById(paymentId).session(session).lean();
          if (!payment || !payment.orderId.equals(order._id))
            throw new ConflictError('Payment source changed.', null, 'REFUND_SOURCE_CONFLICT');
          const flagged = await Payment.exists({
            orderId: order._id,
            reconciliationRequired: true,
          }).session(session);
          // No reconciliation resolution exists yet. Do not infer resolution from a missing flag.
          const reconciliationEvent = await PaymentEvent.exists({
            orderId: order._id,
            action: 'reconciliation_required',
          }).session(session);
          if (flagged || reconciliationEvent)
            throw new ConflictError(
              'Payment reconciliation must be resolved before recording a refund.',
              null,
              'PAYMENT_RECONCILIATION_REQUIRED'
            );
          const otherUncertain = await Payment.exists({
            orderId: order._id,
            _id: { $ne: payment._id },
            status: {
              $in: [
                PAYMENT_STATUS.PENDING,
                PAYMENT_STATUS.PROCESSING,
                PAYMENT_STATUS.COMPLETED,
                PAYMENT_STATUS.REFUNDED,
              ],
            },
          }).session(session);
          if (otherUncertain)
            throw new ConflictError(
              'Another payment attempt requires financial review.',
              null,
              'REFUND_OTHER_ATTEMPT_UNRESOLVED'
            );
          if (
            ![PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.REFUNDED].includes(payment.status) ||
            payment.method !== PAYMENT_METHOD.ONLINE_GATEWAY ||
            payment.provider !== PAYMENT_PROVIDER.PAYHERE ||
            !payment.providerOrderId ||
            !payment.providerTransactionId
          )
            throw new ConflictError(
              'A verified successful PayHere capture is required.',
              null,
              'REFUND_CAPTURE_UNVERIFIED'
            );
          assertFullRefundAmount(normalized, payment);
          if (
            !validAmount(order.orderAmount) ||
            formatAmount(order.orderAmount) !== formatAmount(payment.amount) ||
            payment.currency !== PAYMENT_CURRENCY.LKR
          )
            throw new ConflictError(
              'Stored Payment and Order amounts do not match.',
              null,
              'REFUND_SOURCE_MISMATCH'
            );
          const capture = await PaymentEvent.exists({
            paymentId: payment._id,
            orderId: order._id,
            provider: payment.provider,
            providerOrderId: payment.providerOrderId,
            providerTransactionId: payment.providerTransactionId,
            statusCode: PAYHERE_STATUS_CODE.SUCCESS,
            action: 'applied',
            amount: formatAmount(payment.amount),
            currency: payment.currency,
          }).session(session);
          if (!capture)
            throw new ConflictError(
              'Verified applied capture evidence is missing.',
              null,
              'REFUND_CAPTURE_UNVERIFIED'
            );
          if (
            payment.status === PAYMENT_STATUS.REFUNDED &&
            !(await ManualRefundEvidence.exists({ paymentId: payment._id }).session(session))
          )
            throw new ConflictError(
              'Refunded Payment has no replayable evidence.',
              null,
              'REFUND_SOURCE_CONFLICT'
            );
          // Submitted amount/currency are confirmations only; persistence uses stored values.
          const sourceEvidence = { amount: payment.amount, currency: payment.currency };
          if (normalized.refundChannel !== null)
            sourceEvidence.refundChannel = normalized.refundChannel;
          if (normalized.refundReference !== null)
            sourceEvidence.refundReference = normalized.refundReference;
          const refundEvidence = await appendConfirmedManualRefundEvidence({
            auth,
            paymentId,
            evidence: sourceEvidence,
            idempotencyKey,
            session,
          });
          if (payment.status === PAYMENT_STATUS.COMPLETED) {
            const update = await Payment.updateOne(
              {
                _id: payment._id,
                orderId: order._id,
                status: PAYMENT_STATUS.COMPLETED,
                reconciliationRequired: { $ne: true },
                providerTransactionId: payment.providerTransactionId,
                amount: payment.amount,
                currency: payment.currency,
              },
              { $set: { status: PAYMENT_STATUS.REFUNDED } },
              { session, runValidators: true }
            );
            if (update.modifiedCount !== 1)
              throw new ConflictError('Payment state changed.', null, 'REFUND_SOURCE_CONFLICT');

            const refundActor = auditService.buildUserActor(auth);
            await auditService.record({
              action: AUDIT_ACTION.PAYMENT_REFUNDED,
              actor: refundActor,
              target: {
                targetType: AUDIT_TARGET_TYPE.PAYMENT,
                targetId: payment._id.toString(),
              },
              outcome: AUDIT_OUTCOME.SUCCESS,
              eventId: `audit-payment-refund-${refundEvidence._id}`,
              metadata: {
                orderId: order._id.toString(),
                amount: payment.amount,
                currency: payment.currency,
                refundEvidenceId: refundEvidence._id.toString(),
              },
              session,
            });

            // An Order that never reached COMPLETED cannot have earned under ADR-005.
            // Otherwise a durable reversal is mandatory in this SAME transaction.
            const neverEarned = await loyaltyRefund.verifyNeverEarnedFullRefund({
              payment,
              order,
              refundEvidence,
              session,
            });
            if (!neverEarned)
              await loyaltyRefund.applyFullRefundReversal({
                payment,
                order,
                refundEvidence,
                session,
              });
          } else if (
            (await loyaltyRefund.verifyFullRefundReversal({
              payment,
              order,
              refundEvidence,
              session,
            })) !== true &&
            (await loyaltyRefund.verifyNeverEarnedFullRefund({
              payment,
              order,
              refundEvidence,
              session,
            })) !== true
          ) {
            throw new ConflictError(
              'Durable loyalty reversal completion is not confirmed.',
              null,
              'REFUND_LOYALTY_REVERSAL_UNCONFIRMED'
            );
          }
          result = {
            paymentId: payment._id.toString(),
            orderId: order._id.toString(),
            status: PAYMENT_STATUS.REFUNDED,
            amount: payment.amount,
            currency: payment.currency,
            refundEvidence,
          };
        });
        return result;
      } catch (error) {
        if (error.code !== 11000) throw error;
        if (retry === 1)
          throw new ConflictError(
            'Refund evidence already exists or the idempotency key conflicts.',
            null,
            'REFUND_EVIDENCE_CONFLICT'
          );
      }
    }
  } finally {
    await session.endSession();
  }
}

module.exports = { recordConfirmedManualFullRefund };
