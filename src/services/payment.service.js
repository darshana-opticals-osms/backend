const crypto = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/payment.model');
const PaymentEvent = require('../models/paymentEvent.model');
const PaymentRetrievalEvidence = require('../models/paymentRetrievalEvidence.model');
const Order = require('../models/order.model');
const Customer = require('../models/customer.model');
const { loadConfig } = require('../config/env');
const { PayHerePaymentAdapter, formatAmount } = require('./adapters/PayHerePaymentAdapter');
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
  PAYHERE_STATUS_CODE,
} = require('../constants/payment');
const { ORDER_STATUS_VALUES } = require('../constants/orderStatuses');
const {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../errors/AppError');

const RESERVATION_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_PAYMENT_STATUSES = [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING];
// Documented Checkout method labels only. Unsigned metadata must not persist
// arbitrary text/PII; future labels can still be accepted without being stored.
const SAFE_PAYHERE_METHODS = new Set([
  'VISA',
  'MASTER',
  'AMEX',
  'EZCASH',
  'MCASH',
  'GENIE',
  'VISHWA',
  'PAYAPP',
  'HNB',
  'FRIMI',
  'HELAPAY',
  'QPLUS',
]);

function getAdapter() {
  return new PayHerePaymentAdapter(loadConfig());
}

function getReservationExpiry(order) {
  if (order.reservationExpiresAt) return new Date(order.reservationExpiresAt);
  const originalBoundary = order.createdAt || order.orderDate;
  return new Date(new Date(originalBoundary).getTime() + RESERVATION_WINDOW_MS);
}

function resolveBilling(customer, supplied = {}) {
  const nameParts = customer.name.trim().split(/\s+/).filter(Boolean);
  const firstName = supplied.firstName || nameParts[0];
  const lastName = supplied.lastName || nameParts.slice(1).join(' ');
  const address = supplied.address || customer.address?.trim();
  const city = supplied.city;
  const missing = [];
  if (!firstName) missing.push('firstName');
  if (!lastName) missing.push('lastName');
  if (!address) missing.push('address');
  if (!city) missing.push('city');
  if (missing.length) {
    throw new ValidationError(
      'Required PayHere billing information is missing.',
      missing.map((field) => ({ field, message: `${field} is required for payment checkout.` })),
      'PAYMENT_BILLING_REQUIRED'
    );
  }
  return { firstName, lastName, address, city };
}

function shapePayment(payment) {
  return {
    paymentId: payment._id.toString(),
    orderId: payment.orderId.toString(),
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    expiresAt: payment.expiresAt,
    reconciliationRequired: Boolean(payment.reconciliationRequired),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

async function findActiveAttempt(orderId, session = null) {
  const query = Payment.findOne({ orderId, status: { $in: ACTIVE_PAYMENT_STATUSES } }).sort({
    createdAt: -1,
    _id: -1,
  });
  if (session) query.session(session);
  return query;
}

function assertReusableAttempt(payment, order, expiresAt, now) {
  if (!payment) {
    throw new ConflictError(
      'A concurrent payment request could not be reused.',
      null,
      'PAYMENT_ATTEMPT_NOT_REUSABLE'
    );
  }
  if (payment.reconciliationRequired) {
    throw new ConflictError(
      'The active payment attempt requires reconciliation before it can be reused.',
      null,
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
  }
  const canonicalAttempt =
    payment.amount === order.orderAmount &&
    payment.currency === PAYMENT_CURRENCY.LKR &&
    payment.provider === PAYMENT_PROVIDER.PAYHERE &&
    payment.method === PAYMENT_METHOD.ONLINE_GATEWAY &&
    typeof payment.providerOrderId === 'string' &&
    payment.providerOrderId.length > 0 &&
    payment.expiresAt > now &&
    payment.expiresAt.getTime() === expiresAt.getTime();
  if (!canonicalAttempt) {
    throw new ConflictError(
      'The active payment attempt does not match the current Order payment context.',
      null,
      'PAYMENT_ATTEMPT_NOT_REUSABLE'
    );
  }
  return payment;
}

function assertNoUnresolvedReconciliation(payment) {
  if (payment) {
    throw new ConflictError(
      'A payment attempt for this Order requires reconciliation before payment can continue.',
      null,
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
  }
}

async function assertOrderNotRefunded(orderId, session = null) {
  const query = Payment.exists({ orderId, status: PAYMENT_STATUS.REFUNDED });
  if (session) query.session(session);
  if (await query) {
    throw new ConflictError(
      'Order has already been refunded and cannot be paid again.',
      null,
      'ORDER_ALREADY_REFUNDED'
    );
  }
}

// Caller must hold the Order write lock in this session, verify the original
// reservation has expired, and exclude captures/refunds/reconciliation first.
// This closes a local checkout session; it does not assert a provider refund.
async function cancelExpiredActiveAttempts(orderId, session) {
  if (
    await PaymentEvent.exists({
      orderId,
      $or: [{ action: 'reconciliation_required' }, { statusCode: '2', action: 'applied' }],
    }).session(session)
  ) {
    throw new ConflictError(
      'Verified payment evidence requires review before local session expiry.',
      null,
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
  }
  return Payment.updateMany(
    {
      orderId,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: { $in: ACTIVE_PAYMENT_STATUSES },
      reconciliationRequired: { $ne: true },
    },
    { $set: { status: PAYMENT_STATUS.CANCELLED, failureReason: 'session_expired' } },
    { session }
  );
}

async function initiatePayment({ customerId, orderId, billingInput = {}, now = new Date() }) {
  if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(orderId)) {
    throw new ValidationError('Payment identifiers are invalid.');
  }

  const adapter = getAdapter();
  adapter.assertConfigured();
  const session = await mongoose.startSession();
  let payment;
  let customer;
  let reservationExpired = false;

  try {
    await session.withTransaction(async () => {
      reservationExpired = false;
      const orderDocument = await Order.findOneAndUpdate(
        { _id: orderId, customerId },
        { $inc: { __v: 1 } },
        { session, new: true }
      );
      const customerDocument = await Customer.findById(customerId).session(session);
      if (!orderDocument) throw new NotFoundError('Order not found.', null, 'ORDER_NOT_FOUND');
      if (!customerDocument) {
        throw new NotFoundError('Customer not found.', null, 'CUSTOMER_NOT_FOUND');
      }
      const reconciliationRequired = await Payment.exists({
        orderId: orderDocument._id,
        reconciliationRequired: true,
      }).session(session);
      assertNoUnresolvedReconciliation(reconciliationRequired);
      if (orderDocument.status !== ORDER_STATUS_VALUES.ORDER_CREATED) {
        throw new ConflictError('Order is not eligible for payment.', null, 'ORDER_NOT_PAYABLE');
      }

      const expiresAt = getReservationExpiry(orderDocument);
      await assertOrderNotRefunded(orderDocument._id, session);
      const completed = await Payment.exists({
        orderId: orderDocument._id,
        status: PAYMENT_STATUS.COMPLETED,
      }).session(session);
      if (completed) {
        throw new ConflictError('Order has already been paid.', null, 'ORDER_ALREADY_PAID');
      }
      if (expiresAt <= now) {
        await cancelExpiredActiveAttempts(orderDocument._id, session);
        // Commit stale-session cleanup, then reject outside the transaction.
        // ADR-011 section 8 forbids extending this Order's reservation for retry.
        reservationExpired = true;
        return;
      }

      payment = await findActiveAttempt(orderDocument._id, session);
      if (payment) {
        assertReusableAttempt(payment, orderDocument, expiresAt, now);
      } else {
        const paymentDocument = new Payment({
          orderId: orderDocument._id,
          amount: orderDocument.orderAmount,
          currency: PAYMENT_CURRENCY.LKR,
          method: PAYMENT_METHOD.ONLINE_GATEWAY,
          provider: PAYMENT_PROVIDER.PAYHERE,
          status: PAYMENT_STATUS.PENDING,
          expiresAt,
        });
        paymentDocument.providerOrderId = `PAY-${paymentDocument._id}`;
        await paymentDocument.save({ session });
        payment = paymentDocument;
      }
      customer = customerDocument;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const [orderDocument, customerDocument] = await Promise.all([
      Order.findOne({ _id: orderId, customerId }),
      Customer.findById(customerId),
    ]);
    if (!orderDocument) throw new NotFoundError('Order not found.', null, 'ORDER_NOT_FOUND');
    if (!customerDocument) {
      throw new NotFoundError('Customer not found.', null, 'CUSTOMER_NOT_FOUND');
    }
    const reconciliationRequired = await Payment.exists({
      orderId: orderDocument._id,
      reconciliationRequired: true,
    });
    assertNoUnresolvedReconciliation(reconciliationRequired);
    if (orderDocument.status !== ORDER_STATUS_VALUES.ORDER_CREATED) {
      throw new ConflictError('Order is not eligible for payment.', null, 'ORDER_NOT_PAYABLE');
    }
    const expiresAt = getReservationExpiry(orderDocument);
    if (expiresAt <= now) {
      throw new ConflictError('Order payment window has expired.', null, 'ORDER_PAYMENT_EXPIRED');
    }
    await assertOrderNotRefunded(orderDocument._id);
    const completed = await Payment.exists({
      orderId: orderDocument._id,
      status: PAYMENT_STATUS.COMPLETED,
    });
    if (completed) {
      throw new ConflictError('Order has already been paid.', null, 'ORDER_ALREADY_PAID');
    }
    payment = await findActiveAttempt(orderDocument._id);
    assertReusableAttempt(payment, orderDocument, expiresAt, now);
    customer = customerDocument;
  } finally {
    await session.endSession();
  }

  if (reservationExpired) {
    throw new ConflictError('Order payment window has expired.', null, 'ORDER_PAYMENT_EXPIRED');
  }
  const billing = resolveBilling(customer, billingInput);
  return {
    payment: shapePayment(payment),
    gateway: adapter.buildCheckoutPayload({ payment, customer, billing }),
  };
}

async function getOwnOrderPaymentStatus({ customerId, orderId }) {
  if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(orderId)) {
    throw new ValidationError('Payment identifiers are invalid.');
  }
  const order = await Order.findOne({ _id: orderId, customerId }).select('_id status').lean();
  if (!order) throw new NotFoundError('Order not found.', null, 'ORDER_NOT_FOUND');
  const payments = await Payment.find({ orderId }).sort({ createdAt: -1, _id: -1 });
  const attempts = payments.map(shapePayment);
  const latestAttempt = attempts[0] || null;
  const completedAttempt = attempts.find((attempt) => attempt.status === PAYMENT_STATUS.COMPLETED);
  const reconciliationRequired = attempts.some((attempt) => attempt.reconciliationRequired);
  return {
    ...(latestAttempt || { orderId: order._id.toString() }),
    orderStatus: order.status,
    summary: {
      paid: Boolean(completedAttempt),
      reconciliationRequired,
      activeAttempt: attempts.some((attempt) => ACTIVE_PAYMENT_STATUSES.includes(attempt.status)),
      attemptCount: attempts.length,
    },
    latestAttempt,
    completedAttempt: completedAttempt || null,
    attempts,
  };
}

function buildEventKey(fields) {
  return crypto
    .createHash('sha256')
    .update(
      [
        fields.order_id,
        fields.payment_id,
        fields.status_code,
        fields.payhere_amount,
        fields.payhere_currency,
      ].join('|')
    )
    .digest('hex');
}

function eventData(payment, fields, action, reason = null) {
  return {
    eventKey: buildEventKey(fields),
    paymentId: payment._id,
    orderId: payment.orderId,
    provider: PAYMENT_PROVIDER.PAYHERE,
    providerOrderId: fields.order_id,
    providerTransactionId: fields.payment_id || null,
    statusCode: fields.status_code,
    amount: fields.payhere_amount,
    currency: fields.payhere_currency,
    action,
    reason,
  };
}

async function markReconciliation(payment, fields, reason, session) {
  await Payment.updateOne(
    { _id: payment._id },
    { $set: { reconciliationRequired: true, reconciliationReason: reason } },
    { session }
  );
  await PaymentEvent.create([eventData(payment, fields, 'reconciliation_required', reason)], {
    session,
  });
  return { action: 'reconciliation_required' };
}

async function recordReconciliationEvidence(payment, fields, reason, session) {
  await PaymentEvent.create([eventData(payment, fields, 'reconciliation_required', reason)], {
    session,
  });
  return { action: 'reconciliation_required' };
}

async function lockOrderPaymentState(orderId, session) {
  await Order.updateOne({ _id: orderId }, { $inc: { __v: 1 } }, { session });
}

async function recordVerifiedMismatch(payment, fields) {
  const eventKey = buildEventKey(fields);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await PaymentEvent.exists({ eventKey }).session(session)) return;
      const currentPayment = await Payment.findById(payment._id).session(session);
      if (!currentPayment) throw new NotFoundError('Payment attempt not found.');
      await lockOrderPaymentState(currentPayment.orderId, session);
      await markReconciliation(currentPayment, fields, 'PAYHERE_AMOUNT_CURRENCY_MISMATCH', session);
    });
  } catch (error) {
    if (!(error?.code === 11000 && (await PaymentEvent.exists({ eventKey })))) throw error;
  } finally {
    await session.endSession();
  }
}

async function processVerifiedNotification(fields) {
  const adapter = getAdapter();
  if (!adapter.verifyNotification(fields)) {
    throw new ForbiddenError('Invalid payment notification.', null, 'INVALID_PAYMENT_SIGNATURE');
  }
  const providerPaymentMethod = SAFE_PAYHERE_METHODS.has(fields.method) ? fields.method : null;

  const payment = await Payment.findOne({ providerOrderId: fields.order_id });
  if (!payment) throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  if (
    formatAmount(payment.amount) !== fields.payhere_amount ||
    payment.currency !== fields.payhere_currency
  ) {
    await recordVerifiedMismatch(payment, fields);
    throw new BadRequestError(
      'Payment notification does not match the expected transaction.',
      null,
      'PAYMENT_MISMATCH'
    );
  }

  const eventKey = buildEventKey(fields);
  if (await PaymentEvent.exists({ eventKey })) return { action: 'duplicate' };

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const currentPayment = await Payment.findById(payment._id).session(session);
      if (!currentPayment) throw new NotFoundError('Payment attempt not found.');
      if (await PaymentEvent.exists({ eventKey }).session(session)) {
        result = { action: 'duplicate' };
        return;
      }
      await lockOrderPaymentState(currentPayment.orderId, session);

      if (fields.status_code === PAYHERE_STATUS_CODE.CHARGEBACK) {
        result = await markReconciliation(
          currentPayment,
          fields,
          'PAYHERE_CHARGEBACK_REVIEW',
          session
        );
        return;
      }

      if (fields.status_code === PAYHERE_STATUS_CODE.SUCCESS) {
        if (currentPayment.status === PAYMENT_STATUS.COMPLETED) {
          if (currentPayment.providerTransactionId !== fields.payment_id) {
            result = await markReconciliation(
              currentPayment,
              fields,
              'DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION',
              session
            );
            return;
          }
          await PaymentEvent.create([eventData(currentPayment, fields, 'duplicate')], { session });
          result = { action: 'duplicate' };
          return;
        }
        if (!ACTIVE_PAYMENT_STATUSES.includes(currentPayment.status)) {
          result = await markReconciliation(
            currentPayment,
            fields,
            'LATE_SUCCESS_TERMINAL_ATTEMPT',
            session
          );
          return;
        }
        if (currentPayment.reconciliationRequired) {
          result = await recordReconciliationEvidence(
            currentPayment,
            fields,
            'SUCCESS_WHILE_RECONCILIATION_PENDING',
            session
          );
          return;
        }
        // Retrieval cannot complete a payment, but a previously observed distinct
        // capture is a real conflict, not merely a delayed matching IPN.
        const distinctRetrievedCapture = await PaymentRetrievalEvidence.exists({
          paymentId: currentPayment._id,
          records: {
            $elemMatch: {
              providerOrderId: currentPayment.providerOrderId,
              status: 'RECEIVED',
              providerTransactionId: { $ne: fields.payment_id },
            },
          },
        }).session(session);
        if (distinctRetrievedCapture) {
          result = await markReconciliation(
            currentPayment,
            fields,
            'DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION',
            session
          );
          return;
        }

        const order = await Order.findById(currentPayment.orderId).session(session);
        const otherCompleted = await Payment.exists({
          _id: { $ne: currentPayment._id },
          orderId: currentPayment.orderId,
          status: PAYMENT_STATUS.COMPLETED,
        }).session(session);
        const otherReconciliation = await Payment.exists({
          _id: { $ne: currentPayment._id },
          orderId: currentPayment.orderId,
          reconciliationRequired: true,
        }).session(session);
        if (otherReconciliation) {
          result = await recordReconciliationEvidence(
            currentPayment,
            fields,
            'OTHER_PAYMENT_RECONCILIATION_PENDING',
            session
          );
          return;
        }
        if (!order || order.status !== ORDER_STATUS_VALUES.ORDER_CREATED || otherCompleted) {
          result = await markReconciliation(
            currentPayment,
            fields,
            otherCompleted ? 'DUPLICATE_SUCCESSFUL_CHARGE' : 'LATE_SUCCESS_ORDER_NOT_PAYABLE',
            session
          );
          return;
        }

        const now = new Date();
        if (getReservationExpiry(order) <= now) {
          result = await markReconciliation(
            currentPayment,
            fields,
            'LATE_SUCCESS_RESERVATION_EXPIRED',
            session
          );
          return;
        }
        const paymentUpdate = await Payment.updateOne(
          { _id: currentPayment._id, status: { $in: ACTIVE_PAYMENT_STATUSES } },
          {
            $set: {
              status: PAYMENT_STATUS.COMPLETED,
              providerTransactionId: fields.payment_id,
              providerPaymentMethod,
              failureReason: null,
            },
          },
          { session }
        );
        const orderFilter = { _id: order._id, status: ORDER_STATUS_VALUES.ORDER_CREATED };
        if (order.reservationExpiresAt) {
          orderFilter.reservationExpiresAt = { $gt: now };
        }
        const orderUpdate = await Order.updateOne(
          orderFilter,
          {
            $set: { status: ORDER_STATUS_VALUES.PROCESSING, statusUpdatedAt: now },
            $push: {
              statusHistory: {
                status: ORDER_STATUS_VALUES.PROCESSING,
                changedAt: now,
                changedBy: null,
                source: 'PAYMENT_SYSTEM',
                paymentId: currentPayment._id,
              },
            },
          },
          { session }
        );
        if (paymentUpdate.modifiedCount !== 1 || orderUpdate.modifiedCount !== 1) {
          throw new ConflictError('Payment completion raced with another state change.');
        }
        await PaymentEvent.create([eventData(currentPayment, fields, 'applied')], { session });
        result = { action: 'applied', successBoundary: true };
        return;
      }

      let targetStatus = null;
      if (fields.status_code === PAYHERE_STATUS_CODE.PENDING) {
        targetStatus = PAYMENT_STATUS.PROCESSING;
      } else if (fields.status_code === PAYHERE_STATUS_CODE.FAILED) {
        targetStatus = PAYMENT_STATUS.FAILED;
      } else if (fields.status_code === PAYHERE_STATUS_CODE.CANCELLED) {
        targetStatus = PAYMENT_STATUS.CANCELLED;
      }

      if (!targetStatus || !ACTIVE_PAYMENT_STATUSES.includes(currentPayment.status)) {
        await PaymentEvent.create([eventData(currentPayment, fields, 'duplicate')], { session });
        result = { action: 'duplicate' };
        return;
      }

      const update = {
        status: targetStatus,
        providerTransactionId: fields.payment_id,
        providerPaymentMethod,
      };
      if (targetStatus === PAYMENT_STATUS.FAILED) update.failureReason = 'PAYHERE_PAYMENT_FAILED';
      await Payment.updateOne({ _id: currentPayment._id }, { $set: update }, { session });
      await PaymentEvent.create([eventData(currentPayment, fields, 'applied')], { session });
      result = { action: 'applied', successBoundary: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000 && (await PaymentEvent.exists({ eventKey }))) {
      return { action: 'duplicate' };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  initiatePayment,
  getOwnOrderPaymentStatus,
  processVerifiedNotification,
  resolveBilling,
  shapePayment,
  buildEventKey,
  cancelExpiredActiveAttempts,
};
