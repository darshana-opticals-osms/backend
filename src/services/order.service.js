const mongoose = require('mongoose');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Customer = require('../models/customer.model');
const Payment = require('../models/payment.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { earnPurchasePoints } = require('./loyalty.service');
const { PAYMENT_STATUS } = require('../constants/payment');
const { ROLE_VALUES } = require('../constants/roles');
const {
  ORDER_STATUSES,
  ORDER_STATUS_VALUES,
  ORDER_TRACKING_VIEW_ROLES,
  isValidOrderStatus,
  isValidStatusTransition,
  isTerminalStatus,
} = require('../constants/orderStatuses');
const { sendOrderCancellationNotification } = require('./notification.service');
const { cancelUnpaidReservation } = require('./orderReservation.service');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const ORDER_NOT_FOUND = 'ORDER_NOT_FOUND';

// ─── Safe Response Shapers ────────────────────────────────────────────────────

/**
 * Shapes a single OrderItem document into the safe customer-facing response.
 *
 * Exposes only approved fields. Internal fields (_id raw, orderId, __v,
 * timestamps) are excluded unless they are part of the approved shape.
 *
 * AC9 – Include Order Items Safely.
 *
 * @param {object} item - Mongoose OrderItem document or plain object
 * @returns {object}
 */
function shapeOrderItem(item) {
  return {
    id: item._id.toString(),
    itemName: item.itemName,
    price: item.price,
    quantity: item.quantity,
  };
}

/**
 * Shapes a status-history entry into the safe customer-facing representation.
 *
 * AC8 – Return Tracking History According to ADR-004 (embedded history).
 * AC18 – Safe API Responses.
 * Review Comment 3 – changedBy internal identifier is omitted for customer views
 * to avoid leaking internal staff ObjectIds. Included only for authorized staff.
 *
 * @param {object} entry
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false] - Whether the caller has authorized staff role
 * @returns {object}
 */
function shapeHistoryEntry(entry, options = {}) {
  const isStaff = options.isStaff || false;
  const shaped = {
    status: entry.status,
    changedAt: entry.changedAt,
  };

  // Only expose internal staff identifier to authorized staff callers; omit for customer views
  if (isStaff && entry.changedBy) {
    shaped.changedBy = entry.changedBy.toString();
  }

  return shaped;
}

/**
 * Shapes an Order document into the safe customer-facing order summary used
 * in the order-history list endpoint.
 *
 * Does not include OrderItems (fetched separately on single-order request).
 *
 * AC1, AC7, AC8, AC18.
 *
 * @param {object} order - Mongoose Order document or plain object
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false]
 * @returns {object}
 */
function shapeOrderSummary(order, options = {}) {
  return {
    id: order._id.toString(),
    customerId: order.customerId.toString(),
    orderDate: order.orderDate,
    orderAmount: order.orderAmount,
    status: order.status,
    statusUpdatedAt: order.statusUpdatedAt,
    statusHistory: (order.statusHistory || []).map((entry) => shapeHistoryEntry(entry, options)),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Shapes a single Order document together with its OrderItems into the safe
 * single-order response.
 *
 * AC3, AC7, AC8, AC9, AC18.
 *
 * @param {object} order      - Mongoose Order document or plain object
 * @param {object[]} items    - Array of OrderItem documents
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false]
 * @returns {object}
 */
function shapeOrderDetail(order, items, options = {}) {
  return {
    ...shapeOrderSummary(order, options),
    items: items.map(shapeOrderItem),
  };
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Retrieves orders based on caller role.
 *
 * - CUSTOMER: Returns orders owned by that customer (scoped to customerId).
 * - Authorized Staff (BRANCH_ASSISTANT):
 *   Returns all orders in reverse chronological order for tracking and fulfillment.
 *
 * AC1, AC2, AC6, ADR-004 §12, §13.
 *
 * @param {object} params
 * @param {string} params.userId - Authenticated user's ID
 * @param {string} params.role   - Authenticated user's canonical role
 * @returns {Promise<object[]>} Safe shaped order summaries
 */
async function getOrders({ userId, role }) {
  if (role === ROLE_VALUES.CUSTOMER) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new ValidationError('Authenticated customer identity is invalid.');
    }
    const orders = await Order.find({ customerId: userId }).sort({ createdAt: -1 }).lean();
    return orders.map((order) => shapeOrderSummary(order, { isStaff: false }));
  }

  if (ORDER_TRACKING_VIEW_ROLES.includes(role)) {
    const orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    return orders.map((order) => shapeOrderSummary(order, { isStaff: true }));
  }

  throw new ValidationError('Role not authorized for order tracking retrieval.');
}

/**
 * Returns all Orders owned by the authenticated Customer, ordered newest-first.
 * Backwards-compatible convenience wrapper for getOrders.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @returns {Promise<object[]>} Array of safe order summary objects (may be empty)
 */
async function getCustomerOrders(authenticatedCustomerId) {
  return getOrders({ userId: authenticatedCustomerId, role: ROLE_VALUES.CUSTOMER });
}

/**
 * Retrieves a single Order with its OrderItems based on caller role.
 *
 * - CUSTOMER: Enforces ownership (scopes query to _id AND customerId) to prevent IDOR.
 * - Authorized Staff (BRANCH_ASSISTANT):
 *   Retrieves any order to inspect tracking status and fulfillment details.
 *
 * AC3, AC4, AC5, AC6, AC9, ADR-004 §12, §13.
 *
 * @param {object} params
 * @param {string} params.orderId - Target Order ObjectId
 * @param {string} params.userId  - Authenticated user's ID
 * @param {string} params.role    - Authenticated user's canonical role
 * @returns {Promise<object>} Safe shaped order-detail response with items
 */
async function getOrderById({ orderId, userId, role }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  const isStaff = ORDER_TRACKING_VIEW_ROLES.includes(role);
  let order;
  if (role === ROLE_VALUES.CUSTOMER) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new ValidationError('Authenticated customer identity is invalid.');
    }
    order = await Order.findOne({
      _id: orderId,
      customerId: userId,
    }).lean();
  } else if (isStaff) {
    order = await Order.findById(orderId).lean();
  } else {
    throw new ValidationError('Role not authorized for order tracking retrieval.');
  }

  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  // Retrieve associated OrderItems for this Order.
  const items = await OrderItem.find({ orderId: order._id }).lean();

  return shapeOrderDetail(order, items, { isStaff });
}

/**
 * Returns a single Order with its OrderItems, enforcing customer ownership.
 * Backwards-compatible convenience wrapper for getOrderById.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @param {string} orderId                 - Order ID from URL path parameter
 * @returns {Promise<object>} Safe shaped order-detail response with items
 */
async function getCustomerOrderById(authenticatedCustomerId, orderId) {
  return getOrderById({
    orderId,
    userId: authenticatedCustomerId,
    role: ROLE_VALUES.CUSTOMER,
  });
}

/**
 * Updates an Order's canonical tracking status by authorized staff.
 *
 * Implements ADR-004 §9, §10, §11, §15, §16, §17:
 * - Validates requested status against canonical values.
 * - Prevents updates on terminal states (COMPLETED, CANCELLED).
 * - Enforces allowed transition matrix (ALLOWED_STATUS_TRANSITIONS).
 * - Atomic conditional update: prevents race conditions and stale writes during concurrent updates (Comment 1).
 * - Appends audit entry into embedded statusHistory array with timestamp and staff identity.
 * - Dispatches automated cancellation notification to customer when status changes to CANCELLED (Comment 2 & 3).
 *
 * @param {string} orderId         - Target Order ObjectId
 * @param {string} requestedStatus - New canonical status requested
 * @param {string} staffUserId     - Authenticated staff user ID from JWT context
 * @returns {Promise<object>} Safe shaped order detail with items
 */
async function updateOrderStatus(orderId, requestedStatus, staffUserId) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  if (!requestedStatus || typeof requestedStatus !== 'string') {
    throw new ValidationError(
      'Order status is required.',
      [{ field: 'status', message: 'Order status must be provided as a non-empty string.' }],
      'MISSING_STATUS'
    );
  }

  const trimmedStatus = requestedStatus.trim();
  if (!isValidOrderStatus(trimmedStatus)) {
    throw new ValidationError(
      `Invalid order status '${trimmedStatus}'.`,
      [{ field: 'status', message: `Status must be one of: ${ORDER_STATUSES.join(', ')}.` }],
      'INVALID_STATUS'
    );
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  // ADR-004 §9: Terminal states must not undergo any further transition
  if (isTerminalStatus(order.status)) {
    throw new ValidationError(
      `Cannot update status of an order in terminal state '${order.status}'.`,
      [
        {
          field: 'status',
          message: `Order is already in terminal state '${order.status}' and cannot transition further.`,
        },
      ],
      'TERMINAL_STATUS'
    );
  }

  // ADR-004 §9: Verify requested transition is legal in transition matrix
  if (!isValidStatusTransition(order.status, trimmedStatus)) {
    throw new ValidationError(
      `Transition from '${order.status}' to '${trimmedStatus}' is not allowed.`,
      [
        {
          field: 'status',
          message: `Invalid status transition from '${order.status}' to '${trimmedStatus}'.`,
        },
      ],
      'INVALID_STATUS_TRANSITION'
    );
  }

  // ADR-011 makes the first online-fulfillment transition payment-controlled.
  if (
    order.status === ORDER_STATUS_VALUES.ORDER_CREATED &&
    trimmedStatus === ORDER_STATUS_VALUES.PROCESSING
  ) {
    const verifiedPayment = await Payment.exists({
      orderId: order._id,
      status: PAYMENT_STATUS.COMPLETED,
    });
    if (!verifiedPayment) {
      throw new ValidationError(
        'Order cannot enter processing before verified payment.',
        [{ field: 'status', message: 'A verified completed Payment is required.' }],
        'PAYMENT_REQUIRED'
      );
    }
  }

  const previousStatus = order.status;
  const now = new Date();

  if (trimmedStatus === ORDER_STATUS_VALUES.COMPLETED) {
    // Completion and its award commit together, coordinated with callbacks/refunds
    // through the same Order write. Unknown legacy context fails closed, not zero.
    await LoyaltyTransaction.init();
    const session = await mongoose.startSession();
    let completed;
    try {
      await session.withTransaction(async () => {
        completed = await Order.findOneAndUpdate(
          { _id: orderId, status: previousStatus, statusUpdatedAt: order.statusUpdatedAt },
          {
            $inc: { __v: 1 },
            $set: { status: trimmedStatus, statusUpdatedAt: now },
            $push: {
              statusHistory: { status: trimmedStatus, changedAt: now, changedBy: staffUserId },
            },
          },
          { session, new: true, runValidators: true }
        );
        if (!completed)
          throw new ValidationError(
            'Order changed concurrently.',
            null,
            'CONCURRENT_STATUS_UPDATE'
          );
        const payment = await Payment.findOne({ orderId, status: PAYMENT_STATUS.COMPLETED })
          .session(session)
          .lean();
        if (!payment)
          throw new ConflictError(
            'Verified completed Payment required.',
            null,
            'LOYALTY_PAYMENT_INELIGIBLE'
          );
        await earnPurchasePoints({ paymentId: payment._id.toString(), session });
      });
    } finally {
      await session.endSession();
    }
    const items = await OrderItem.find({ orderId }).lean();
    return shapeOrderDetail(completed, items, { isStaff: true });
  }

  if (
    previousStatus === ORDER_STATUS_VALUES.ORDER_CREATED &&
    trimmedStatus === ORDER_STATUS_VALUES.CANCELLED
  ) {
    const outcome = await cancelUnpaidReservation({ orderId, now, staffUserId });
    if (outcome.action !== 'cancelled') {
      throw new ValidationError(
        'Cancellation transition is unsafe or the Order changed concurrently.',
        null,
        outcome.reason || 'CONCURRENT_STATUS_UPDATE'
      );
    }
    const items = await OrderItem.find({ orderId: outcome.order._id }).lean();
    return shapeOrderDetail(outcome.order, items, { isStaff: true });
  }

  // Atomic conditional update to protect against concurrent updates (Comment 1)
  const updatedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: previousStatus,
      statusUpdatedAt: order.statusUpdatedAt,
    },
    {
      $set: {
        status: trimmedStatus,
        statusUpdatedAt: now,
      },
      $push: {
        statusHistory: {
          status: trimmedStatus,
          changedAt: now,
          changedBy: staffUserId,
        },
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedOrder) {
    throw new ValidationError(
      'Order status was updated concurrently by another request. Please refresh and try again.',
      [
        {
          field: 'status',
          message: 'Concurrent update conflict detected. Current order status has changed.',
        },
      ],
      'CONCURRENT_STATUS_UPDATE'
    );
  }

  // ADR-004 §17: Automated cancellation notification to customer
  if (trimmedStatus === ORDER_STATUS_VALUES.CANCELLED) {
    try {
      const customer = await Customer.findById(updatedOrder.customerId).lean();
      if (customer && customer.email) {
        await sendOrderCancellationNotification({
          customerEmail: customer.email,
          customerName: customer.name,
          orderId: updatedOrder._id.toString(),
          orderAmount: updatedOrder.orderAmount,
        });
      }
    } catch (notifyErr) {
      // Non-blocking: status update transaction is not broken if notification fails
      console.warn(
        `[OrderService] Non-blocking notification dispatch failure for order ${updatedOrder._id}:`,
        notifyErr.message
      );
    }
  }

  const items = await OrderItem.find({ orderId: updatedOrder._id }).lean();
  return shapeOrderDetail(updatedOrder, items, { isStaff: true });
}

module.exports = {
  getOrders,
  getOrderById,
  getCustomerOrders,
  getCustomerOrderById,
  updateOrderStatus,
  // Exported for unit testing of shaping logic
  shapeOrderSummary,
  shapeOrderDetail,
  shapeOrderItem,
  shapeHistoryEntry,
};
