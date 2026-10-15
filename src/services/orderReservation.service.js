const mongoose = require('mongoose');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Inventory = require('../models/inventory.model');
const Payment = require('../models/payment.model');
const PaymentEvent = require('../models/paymentEvent.model');
const Customer = require('../models/customer.model');
const { PAYMENT_STATUS, PAYMENT_PROVIDER, PAYMENT_METHOD } = require('../constants/payment');
const { cancelExpiredActiveAttempts } = require('./payment.service');
const { ORDER_STATUS_VALUES } = require('../constants/orderStatuses');
const { ConflictError, ValidationError } = require('../errors/AppError');
const { evaluateReorderAlert } = require('./reorderAlert.service');
const { sendOrderCancellationNotification } = require('./notification.service');
const { restoreCartItems } = require('./cart.service');

const DEFAULT_BATCH_SIZE = 100;
const MAX_TRANSACTION_ATTEMPTS = 3;

async function notifyCancellation(order) {
  try {
    const customer = await Customer.findById(order.customerId).lean();
    if (customer?.email) {
      await sendOrderCancellationNotification({
        customerEmail: customer.email,
        customerName: customer.name,
        orderId: order._id.toString(),
        orderAmount: order.orderAmount,
      });
    }
  } catch (error) {
    console.warn(
      `[OrderReservation] Non-blocking notification failure for order ${order._id}:`,
      error.message
    );
  }
}

// Expiry and unpaid staff cancellation use the same Order write as verified IPNs.
// A competing transaction must retry and re-read all payment and reservation state.
async function cancelUnpaidReservation({
  orderId,
  now = new Date(),
  staffUserId = null,
  expiry = false,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    const cancelReservation = async () => {
      result = { action: 'skipped', reason: 'ORDER_NOT_ELIGIBLE' };
      const order = await Order.findOneAndUpdate(
        { _id: orderId, status: ORDER_STATUS_VALUES.ORDER_CREATED, inventoryRestoredAt: null },
        { $inc: { __v: 1 } },
        { session, new: true }
      );
      if (!order) return;
      if (expiry && (!order.reservationExpiresAt || order.reservationExpiresAt > now)) return;

      const payments = await Payment.find({ orderId: order._id }).session(session);
      if (
        payments.some((payment) => payment.reconciliationRequired) ||
        (await PaymentEvent.exists({
          orderId: order._id,
          action: 'reconciliation_required',
        }).session(session))
      ) {
        result = { action: 'held', reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
        return;
      }
      if (payments.some((payment) => payment.status === PAYMENT_STATUS.COMPLETED)) {
        result = { action: 'held', reason: 'ORDER_ALREADY_PAID' };
        return;
      }
      // ADR-011 sections 12/13 close stale local gateway sessions at the
      // original Order deadline. Preserve other financial states and all
      // uncertain attempts before that deadline (including staff cancellation).
      if (
        payments.some(
          (payment) =>
            ![PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELLED].includes(payment.status) &&
            !(
              expiry &&
              [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING].includes(payment.status) &&
              payment.provider === PAYMENT_PROVIDER.PAYHERE &&
              payment.method === PAYMENT_METHOD.ONLINE_GATEWAY
            )
        )
      ) {
        result = { action: 'held', reason: 'PAYMENT_OUTCOME_UNCERTAIN' };
        return;
      }
      if (
        await PaymentEvent.exists({
          orderId: order._id,
          statusCode: '2',
          action: 'applied',
        }).session(session)
      ) {
        result = { action: 'held', reason: 'ORDER_ALREADY_PAID' };
        return;
      }

      const items = await OrderItem.find({ orderId: order._id }).session(session);
      if (
        !items.length ||
        items.some(
          (item) => !item.inventoryId || !Number.isSafeInteger(item.quantity) || item.quantity < 1
        )
      ) {
        result = { action: 'held', reason: 'INVENTORY_RESTORATION_UNVERIFIABLE' };
        return;
      }
      const quantities = new Map();
      for (const item of items) {
        const id = item.inventoryId.toString();
        const quantity = (quantities.get(id) || 0) + item.quantity;
        if (!Number.isSafeInteger(quantity)) {
          throw new ConflictError(
            'Reservation quantities are invalid.',
            null,
            'INVALID_RESERVED_QUANTITY'
          );
        }
        quantities.set(id, quantity);
      }
      const inventories = await Inventory.find({
        _id: { $in: [...quantities.keys()] },
      }).session(session);
      if (
        inventories.length !== quantities.size ||
        inventories.some(
          (item) =>
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 0 ||
            !Number.isSafeInteger(item.quantity + quantities.get(item._id.toString()))
        )
      ) {
        result = { action: 'held', reason: 'INVENTORY_RESTORATION_UNVERIFIABLE' };
        return;
      }
      if (expiry) await cancelExpiredActiveAttempts(order._id, session);
      for (const inventory of inventories) {
        const restored = await Inventory.findOneAndUpdate(
          { _id: inventory._id },
          { $inc: { quantity: quantities.get(inventory._id.toString()) } },
          { session, new: true, runValidators: true }
        );
        if (!restored) throw new ConflictError('Inventory changed during restoration.');
        await evaluateReorderAlert(restored, null, session);
      }
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: ORDER_STATUS_VALUES.ORDER_CREATED,
          inventoryRestoredAt: null,
        },
        {
          $set: {
            status: ORDER_STATUS_VALUES.CANCELLED,
            statusUpdatedAt: now,
            inventoryRestoredAt: now,
          },
          $push: {
            statusHistory: {
              status: ORDER_STATUS_VALUES.CANCELLED,
              changedAt: now,
              changedBy: staffUserId,
              source: expiry ? 'RESERVATION_EXPIRY' : 'USER',
            },
          },
        },
        { session, new: true, runValidators: true }
      );
      if (!updatedOrder) throw new ConflictError('Order changed during restoration.');
      if (expiry) {
        await restoreCartItems(
          order.customerId,
          [...quantities].map(([inventoryId, quantity]) => ({ inventoryId, quantity })),
          session
        );
      }
      result = { action: 'cancelled', order: updatedOrder };
    };
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        await session.withTransaction(cancelReservation);
        break;
      } catch (error) {
        // Concurrent first-Cart creation can lose the unique Customer index race.
        // Retry only after withTransaction has aborted all expiry/stock/Cart writes.
        if (error.code !== 11000 || attempt === MAX_TRANSACTION_ATTEMPTS - 1) throw error;
      }
    }
  } finally {
    await session.endSession();
  }
  if (result.action === 'cancelled') await notifyCancellation(result.order);
  return result;
}

async function sweepExpiredReservations({
  now = new Date(),
  limit = DEFAULT_BATCH_SIZE,
  afterId = null,
} = {}) {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > DEFAULT_BATCH_SIZE ||
    (afterId && !mongoose.isValidObjectId(afterId))
  ) {
    throw new ValidationError('Invalid reservation sweep parameters.');
  }
  const filter = {
    status: ORDER_STATUS_VALUES.ORDER_CREATED,
    reservationExpiresAt: { $ne: null, $lte: now },
    inventoryRestoredAt: null,
  };
  if (afterId) filter._id = { $gt: afterId };
  const candidates = await Order.find(filter).sort({ _id: 1 }).limit(limit).select('_id').lean();
  const result = {
    examined: candidates.length,
    cancelled: 0,
    held: [],
    failed: [],
    nextCursor: null,
  };
  for (const candidate of candidates) {
    try {
      const outcome = await cancelUnpaidReservation({ orderId: candidate._id, now, expiry: true });
      if (outcome.action === 'cancelled') result.cancelled += 1;
      if (outcome.action === 'held')
        result.held.push({ orderId: candidate._id.toString(), reason: outcome.reason });
    } catch (error) {
      result.failed.push({
        orderId: candidate._id.toString(),
        code: error.errorCode || error.code || 'RESERVATION_TRANSACTION_FAILED',
      });
    }
  }
  if (candidates.length === limit) result.nextCursor = candidates.at(-1)._id.toString();
  return result;
}

module.exports = { DEFAULT_BATCH_SIZE, cancelUnpaidReservation, sweepExpiredReservations };
