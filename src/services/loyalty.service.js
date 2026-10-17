const mongoose = require('mongoose');
const Customer = require('../models/customer.model');
const Order = require('../models/order.model');
const Payment = require('../models/payment.model');
const PaymentEvent = require('../models/paymentEvent.model');
const ManualRefundEvidence = require('../models/manualRefundEvidence.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { LOYALTY_EVENT_TYPE: TYPE } = require('../constants/loyalty');
const {
  ORDER_STATUS_VALUES: ORDER,
  isValidStatusTransition,
} = require('../constants/orderStatuses');
const {
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_METHOD,
  PAYMENT_CURRENCY,
} = require('../constants/payment');
const { ConflictError, ValidationError, NotFoundError } = require('../errors/AppError');
const { isIdentifier } = require('../validations/paymentMonitoring.validation');
const { formatAmount } = require('./adapters/PayHerePaymentAdapter');
const { toMinor, fromMinor, calculateEarnedPoints } = require('../utils/loyaltyDecimal');
const eligibility = require('./loyaltyEligibility.service');

function conflict(message, code) {
  return new ConflictError(message, null, code);
}
function validateInput(input, refund = false) {
  if (
    !input ||
    Object.keys(input).some(
      (key) => !['paymentId', 'session', ...(refund ? ['refundEvidenceId'] : [])].includes(key)
    ) ||
    !isIdentifier(input.paymentId) ||
    (refund && !isIdentifier(input.refundEvidenceId))
  )
    throw new ValidationError(
      'Only authoritative source identifiers and an optional transaction session are accepted.'
    );
  if (input.session && !input.session.inTransaction())
    throw new ValidationError('Caller-owned session must have an active transaction.');
}
function shape(record) {
  return {
    transactionId: record._id.toString(),
    customerId: record.customerId.toString(),
    orderId: record.orderId.toString(),
    paymentId: record.paymentId.toString(),
    eventType: record.eventType,
    sourceEventId: record.sourceEventId.toString(),
    earningTransactionId: record.earningTransactionId?.toString() ?? null,
    pointsDelta: fromMinor(toMinor(record.pointsDelta)),
    balanceAfter: fromMinor(toMinor(record.balanceAfter)),
    createdAt: record.createdAt,
  };
}
async function inTransaction(session, work) {
  await LoyaltyTransaction.init();
  if (session) return work(session); // Never own, commit, retry or recover inside the caller's transaction.
  const owned = await mongoose.startSession();
  try {
    for (let retry = 0; retry < 2; retry += 1) {
      try {
        let result;
        await owned.withTransaction(async () => {
          result = await work(owned);
        });
        return result;
      } catch (error) {
        if (error.code !== 11000) throw error;
        if (retry === 1)
          throw conflict('Loyalty source identity conflicts.', 'LOYALTY_SOURCE_CONFLICT');
      }
    }
  } finally {
    await owned.endSession();
  }
}
async function source(paymentId, session, refunded) {
  const identity = await Payment.findById(paymentId).session(session).lean();
  if (!identity) throw new NotFoundError('Payment not found.');
  // Same Order coordination used by payment callbacks, reservation expiry and refunds.
  const order = await Order.findOneAndUpdate(
    { _id: identity.orderId },
    { $inc: { __v: 1 } },
    { session, new: true }
  ).lean();
  if (!order) throw new NotFoundError('Order not found.');
  const payment = await Payment.findById(paymentId).session(session).lean();
  if (
    !payment ||
    !payment.orderId.equals(order._id) ||
    payment.status !== (refunded ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.COMPLETED) ||
    payment.provider !== PAYMENT_PROVIDER.PAYHERE ||
    payment.method !== PAYMENT_METHOD.ONLINE_GATEWAY ||
    payment.currency !== PAYMENT_CURRENCY.LKR ||
    !payment.providerTransactionId ||
    !payment.providerOrderId ||
    formatAmount(payment.amount) !== formatAmount(order.orderAmount)
  )
    throw conflict(
      'A matching verified capture and authoritative Order are required.',
      'LOYALTY_PAYMENT_INELIGIBLE'
    );
  if (await Payment.exists({ orderId: order._id, reconciliationRequired: true }).session(session))
    throw conflict('Unresolved payment reconciliation.', 'PAYMENT_RECONCILIATION_REQUIRED');
  if (
    await PaymentEvent.exists({ orderId: order._id, action: 'reconciliation_required' }).session(
      session
    )
  )
    throw conflict('Unresolved provider evidence.', 'PAYMENT_RECONCILIATION_REQUIRED');
  const capture = await PaymentEvent.findOne({
    paymentId: payment._id,
    orderId: order._id,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerTransactionId: payment.providerTransactionId,
    statusCode: '2',
    action: 'applied',
    amount: formatAmount(payment.amount),
    currency: payment.currency,
  })
    .session(session)
    .lean();
  if (!capture)
    throw conflict('Verified applied capture evidence is missing.', 'LOYALTY_PAYMENT_INELIGIBLE');
  return { payment, order, capture };
}
async function balance(customerId, session) {
  const customer = await Customer.findById(customerId)
    .select('+loyaltyBalance')
    .session(session)
    .lean();
  if (!customer) throw new NotFoundError('Customer not found.');
  if (customer.loyaltyBalance === undefined || customer.loyaltyBalance === null)
    throw conflict(
      'Legacy balance requires authoritative initialization.',
      'LOYALTY_BALANCE_UNINITIALIZED'
    );
  const current = toMinor(customer.loyaltyBalance);
  if (current < 0n)
    throw conflict(
      'Existing negative balance needs an approved policy.',
      'LOYALTY_NEGATIVE_BALANCE_POLICY_REQUIRED'
    );
  const totals = await LoyaltyTransaction.aggregate([
    { $match: { customerId: customer._id } },
    { $group: { _id: null, total: { $sum: '$pointsDelta' } } },
  ]).session(session);
  if (current !== (totals.length ? toMinor(totals[0].total) : 0n))
    throw conflict('Balance/history mismatch requires review.', 'LOYALTY_BALANCE_HISTORY_MISMATCH');
  return { customer, current };
}
function matches(record, context) {
  return (
    record.customerId.equals(context.order.customerId) &&
    record.orderId.equals(context.order._id) &&
    record.paymentId.equals(context.payment._id) &&
    record.providerTransactionId === context.payment.providerTransactionId
  );
}
async function append(context, data, session) {
  const { customer, current } = await balance(context.order.customerId, session);
  const next = current + toMinor(data.pointsDelta);
  if (next < 0n)
    throw conflict(
      'Refund deduction needs an approved negative-balance policy.',
      'LOYALTY_NEGATIVE_BALANCE_POLICY_REQUIRED'
    );
  const document = new LoyaltyTransaction({
    customerId: customer._id,
    orderId: context.order._id,
    paymentId: context.payment._id,
    providerTransactionId: context.payment.providerTransactionId,
    ...data,
    balanceAfter: fromMinor(next),
    createdAt: new Date(),
  });
  await document.validate();
  const update = await Customer.collection.updateOne(
    { _id: customer._id, loyaltyBalance: customer.loyaltyBalance },
    {
      $set: {
        loyaltyBalance: mongoose.Types.Decimal128.fromString(fromMinor(next)),
        updatedAt: new Date(),
      },
    },
    { session }
  );
  if (update.matchedCount !== 1)
    throw conflict('Loyalty balance changed.', 'LOYALTY_SOURCE_CONFLICT');
  await LoyaltyTransaction.collection.insertOne(document.toObject(), { session });
  return shape(document);
}

// Internal only; the authorized COMPLETED transition supplies its transaction session.
async function earnPurchasePoints(input) {
  validateInput(input);
  return inTransaction(input.session, async (session) => {
    const context = await source(input.paymentId, session, false);
    await eligibility.assertEarningContract(context.order, session);
    const previous = await LoyaltyTransaction.findOne({
      paymentId: context.payment._id,
      eventType: TYPE.EARN_PURCHASE,
    })
      .session(session)
      .lean();
    if (previous) {
      if (!matches(previous, context) || !previous.sourceEventId.equals(context.capture._id))
        throw conflict('Earning source conflicts.', 'LOYALTY_SOURCE_CONFLICT');
      await balance(context.order.customerId, session);
      return shape(previous);
    }
    const spend = await eligibility.deriveEligibleSpendForOrder(context.order._id, session);
    if (toMinor(spend) > BigInt(formatAmount(context.order.orderAmount).replace('.', '')))
      throw conflict(
        'Eligible spend exceeds authoritative Order total.',
        'LOYALTY_SOURCE_CONFLICT'
      );
    return append(
      context,
      {
        eventType: TYPE.EARN_PURCHASE,
        sourceEventId: context.capture._id,
        eligibleSpend: spend,
        pointsDelta: calculateEarnedPoints(spend),
      },
      session
    );
  });
}

async function refundEvidenceSource(input, session) {
  const context = await source(input.paymentId, session, true);
  const evidence = await ManualRefundEvidence.findById(input.refundEvidenceId)
    .session(session)
    .lean();
  if (
    !evidence ||
    !evidence.paymentId.equals(context.payment._id) ||
    !evidence.orderId.equals(context.order._id) ||
    evidence.providerTransactionId !== context.payment.providerTransactionId ||
    evidence.providerOrderId !== context.payment.providerOrderId ||
    evidence.currency !== context.payment.currency ||
    formatAmount(evidence.amount) !== formatAmount(context.payment.amount)
  )
    throw conflict(
      'Full-refund evidence does not match its capture.',
      'LOYALTY_REFUND_SOURCE_MISMATCH'
    );
  return { ...context, evidence };
}
async function refundSource(input, session) {
  const context = await refundEvidenceSource(input, session);
  const earning = await LoyaltyTransaction.findOne({
    paymentId: context.payment._id,
    eventType: TYPE.EARN_PURCHASE,
  })
    .session(session)
    .lean();
  if (!earning)
    throw conflict(
      'No authoritative earning history exists; absence is not a zero-point award.',
      'LOYALTY_EARNING_HISTORY_MISSING'
    );
  if (
    !matches(earning, context) ||
    !earning.sourceEventId.equals(context.capture._id) ||
    toMinor(earning.pointsDelta) < 0n
  )
    throw conflict('Original earning identity conflicts.', 'LOYALTY_SOURCE_CONFLICT');
  return { ...context, earning };
}
// A valid ADR-004 history proves this Order has never reached ADR-005's award trigger.
// Absence of ledger rows by itself is never proof, especially for COMPLETED Orders.
function hasNeverCompleted(order) {
  const history = order.statusHistory;
  return (
    [ORDER.PROCESSING, ORDER.READY_FOR_PICKUP, ORDER.PICKED_UP, ORDER.CANCELLED].includes(
      order.status
    ) &&
    Array.isArray(history) &&
    history.length >= 2 &&
    history[0]?.status === ORDER.ORDER_CREATED &&
    history.at(-1)?.status === order.status &&
    history.some((entry) => entry?.status === ORDER.PROCESSING) &&
    history.every(
      (entry, index) =>
        entry?.status !== ORDER.COMPLETED &&
        (index === 0 || isValidStatusTransition(history[index - 1]?.status, entry?.status))
    )
  );
}
async function verifyNeverEarnedFullRefund(input) {
  validateInput(input, true);
  return inTransaction(input.session, async (session) => {
    const context = await refundEvidenceSource(input, session);
    if (!hasNeverCompleted(context.order)) return false;
    if (await LoyaltyTransaction.exists({ paymentId: context.payment._id }).session(session))
      return false;
    await balance(context.order.customerId, session);
    return true;
  });
}
function matchesReversal(reversal, context) {
  return (
    matches(reversal, context) &&
    reversal.sourceEventId.equals(context.evidence._id) &&
    reversal.earningTransactionId?.equals(context.earning._id) &&
    toMinor(reversal.pointsDelta) === -toMinor(context.earning.pointsDelta)
  );
}
async function reverseFullRefundPoints(input) {
  validateInput(input, true);
  return inTransaction(input.session, async (session) => {
    const context = await refundSource(input, session);
    const previous = await LoyaltyTransaction.findOne({
      paymentId: context.payment._id,
      eventType: TYPE.REFUND_REVERSAL,
    })
      .session(session)
      .lean();
    if (previous) {
      if (!matchesReversal(previous, context))
        throw conflict('Reversal identity conflicts.', 'LOYALTY_SOURCE_CONFLICT');
      await balance(context.order.customerId, session);
      return shape(previous);
    }
    return append(
      context,
      {
        eventType: TYPE.REFUND_REVERSAL,
        sourceEventId: context.evidence._id,
        earningTransactionId: context.earning._id,
        pointsDelta: fromMinor(-toMinor(context.earning.pointsDelta)),
      },
      session
    );
  });
}
async function verifyFullRefundPoints(input) {
  validateInput(input, true);
  return inTransaction(input.session, async (session) => {
    let context;
    try {
      context = await refundSource(input, session);
    } catch (error) {
      if (error.errorCode === 'LOYALTY_EARNING_HISTORY_MISSING') return false;
      throw error;
    }
    const reversal = await LoyaltyTransaction.findOne({
      paymentId: context.payment._id,
      eventType: TYPE.REFUND_REVERSAL,
    })
      .session(session)
      .lean();
    if (!reversal || !matchesReversal(reversal, context)) return false;
    await balance(context.order.customerId, session);
    return true;
  });
}

module.exports = {
  earnPurchasePoints,
  reverseFullRefundPoints,
  verifyFullRefundPoints,
  verifyNeverEarnedFullRefund,
};
