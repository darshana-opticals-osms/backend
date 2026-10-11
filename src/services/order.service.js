const mongoose = require('mongoose');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Customer = require('../models/customer.model');
const {
  ORDER_STATUSES,
  ORDER_STATUS_VALUES,
  isValidOrderStatus,
  isValidStatusTransition,
  isTerminalStatus,
} = require('../constants/orderStatuses');
const { sendOrderCancellationNotification } = require('./notification.service');
const { NotFoundError, ValidationError } = require('../errors/AppError');

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
 *
 * @param {object} entry
 * @returns {object}
 */
function shapeHistoryEntry(entry) {
  return {
    status: entry.status,
    changedAt: entry.changedAt,
    changedBy: entry.changedBy.toString(),
  };
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
 * @returns {object}
 */
function shapeOrderSummary(order) {
  return {
    id: order._id.toString(),
    customerId: order.customerId.toString(),
    orderDate: order.orderDate,
    orderAmount: order.orderAmount,
    status: order.status,
    statusUpdatedAt: order.statusUpdatedAt,
    statusHistory: (order.statusHistory || []).map(shapeHistoryEntry),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Shapes a single Order document together with its OrderItems into the safe
 * customer-facing single-order response.
 *
 * AC3, AC7, AC8, AC9, AC18.
 *
 * @param {object} order      - Mongoose Order document or plain object
 * @param {object[]} items    - Array of OrderItem documents
 * @returns {object}
 */
function shapeOrderDetail(order, items) {
  return {
    ...shapeOrderSummary(order),
    items: items.map(shapeOrderItem),
  };
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Returns all Orders owned by the authenticated Customer, ordered newest-first.
 *
 * Customer identity is derived entirely from the authenticated backend context
 * (JWT). A client-supplied customerId is never trusted.
 *
 * AC1 – Customer Order History Endpoint.
 * AC2 – Customer with No Orders returns empty array (not an error).
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @returns {object[]} Array of safe order summary objects (may be empty)
 */
async function getCustomerOrders(authenticatedCustomerId) {
  if (!mongoose.isValidObjectId(authenticatedCustomerId)) {
    throw new ValidationError('Authenticated customer identity is invalid.');
  }

  // AC1: scope retrieval strictly to the authenticated customer's ID.
  // AC2: empty array is a valid result — not an error.
  const orders = await Order.find({ customerId: authenticatedCustomerId })
    .sort({ createdAt: -1 })
    .lean();

  return orders.map(shapeOrderSummary);
}

/**
 * Returns a single Order with its OrderItems, enforcing customer ownership.
 *
 * The ownership check is performed in the database query by scoping the lookup
 * to both orderId AND authenticatedCustomerId. This prevents IDOR: a customer
 * cannot retrieve another customer's Order by guessing or supplying a different
 * Order ID.
 *
 * AC3  – Retrieve Single Customer Order.
 * AC4  – Prevent Cross-Customer Access.
 * AC5  – Invalid Order Identifier returns validation error.
 * AC6  – Non-Existent Order returns not-found without leaking information.
 * AC9  – Include Order Items Safely.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @param {string} orderId                 - Order ID from the URL path parameter
 * @returns {object} Safe shaped order-detail response with items
 */
async function getCustomerOrderById(authenticatedCustomerId, orderId) {
  // AC5: validate the ID format before touching the database.
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  if (!mongoose.isValidObjectId(authenticatedCustomerId)) {
    throw new ValidationError('Authenticated customer identity is invalid.');
  }

  // AC4: scope retrieval to BOTH orderId AND the authenticated customer's ID.
  // If Customer B tries to access Customer A's Order, this query returns null
  // because the customerId will not match. The response is indistinguishable
  // from a genuinely non-existent order — no information leakage.
  const order = await Order.findOne({
    _id: orderId,
    customerId: authenticatedCustomerId,
  }).lean();

  // AC6: unified not-found response — does not reveal whether the Order exists
  // for a different customer.
  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  // Retrieve associated OrderItems for this Order.
  const items = await OrderItem.find({ orderId: order._id }).lean();

  return shapeOrderDetail(order, items);
}

/**
 * Updates an Order's canonical tracking status by authorized staff.
 *
 * Implements ADR-004 §9, §10, §11, §15, §16, §17:
 * - Validates requested status against canonical values.
 * - Prevents updates on terminal states (COMPLETED, CANCELLED).
 * - Enforces allowed transition matrix (ALLOWED_STATUS_TRANSITIONS).
 * - Appends audit entry into embedded statusHistory array with timestamp and staff identity.
 * - Dispatches automated cancellation notification to customer when status changes to CANCELLED.
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

  const now = new Date();
  order.status = trimmedStatus;
  order.statusUpdatedAt = now;

  // ADR-004 §15 & §16: Append to embedded status history
  order.statusHistory.push({
    status: trimmedStatus,
    changedAt: now,
    changedBy: staffUserId,
  });

  await order.save();

  // ADR-004 §17: Automated cancellation notification to customer
  if (trimmedStatus === ORDER_STATUS_VALUES.CANCELLED) {
    try {
      const customer = await Customer.findById(order.customerId).lean();
      if (customer && customer.email) {
        await sendOrderCancellationNotification({
          customerEmail: customer.email,
          customerName: customer.name,
          orderId: order._id.toString(),
          orderAmount: order.orderAmount,
        });
      }
    } catch (notifyErr) {
      // Non-blocking: status update transaction is not broken if notification fails
      console.warn(
        `[OrderService] Non-blocking notification dispatch failure for order ${order._id}:`,
        notifyErr.message
      );
    }
  }

  const items = await OrderItem.find({ orderId: order._id }).lean();
  return shapeOrderDetail(order, items);
}

module.exports = {
  getCustomerOrders,
  getCustomerOrderById,
  updateOrderStatus,
  // Exported for unit testing of shaping logic
  shapeOrderSummary,
  shapeOrderDetail,
  shapeOrderItem,
  shapeHistoryEntry,
};
