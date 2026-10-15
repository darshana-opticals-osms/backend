const express = require('express');
const mongoose = require('mongoose');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  ORDER_STATUS_UPDATE_ROLES,
  ORDER_TRACKING_VIEW_ROLES,
  ORDER_STATUSES,
  isValidOrderStatus,
} = require('../constants/orderStatuses');
const { getOrders, getOrderById, updateOrderStatus } = require('../controllers/order.controller');

const ALL_ORDER_VIEW_ROLES = [ROLE_VALUES.CUSTOMER, ...ORDER_TRACKING_VIEW_ROLES];

// ─── Request Validators ───────────────────────────────────────────────────────

/**
 * Validates the :id path parameter for single-order requests.
 *
 * AC5 – Invalid Order Identifier must be rejected using the project's
 * standardized validation/error-handling behaviour.
 *
 * @param {import('express').Request} req
 * @returns {Array<{field: string, message: string}>}
 */
const validateOrderId = (req) => {
  const errors = [];

  if (!mongoose.isValidObjectId(req.params.id)) {
    errors.push({
      field: 'id',
      message: 'Order ID must be a valid MongoDB ObjectId.',
    });
  }

  return errors;
};

/**
 * Validates path parameters and request body for order status update requests.
 *
 * ADR-004 §9, §10, §11.
 *
 * @param {import('express').Request} req
 * @returns {Array<{field: string, message: string}>}
 */
const validateUpdateOrderStatus = (req) => {
  const errors = [];

  if (!mongoose.isValidObjectId(req.params.id)) {
    errors.push({
      field: 'id',
      message: 'Order ID must be a valid MongoDB ObjectId.',
    });
  }

  const { status } = req.body || {};
  if (!status || typeof status !== 'string' || status.trim() === '') {
    errors.push({
      field: 'status',
      message: 'Status is required and must be a non-empty string.',
    });
  } else if (!isValidOrderStatus(status.trim())) {
    errors.push({
      field: 'status',
      message: `Invalid order status '${status}'. Must be one of: ${ORDER_STATUSES.join(', ')}.`,
    });
  }

  return errors;
};

const router = express.Router();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /orders:
 *   get:
 *     summary: Retrieve order history or fulfillment orders
 *     description: >
 *       Accessible to CUSTOMER and authorized branch staff (BRANCH_ASSISTANT) per ADR-004 §12, §13.
 *
 *       For CUSTOMER: Returns only Orders owned by the authenticated Customer,
 *       ordered newest-first. Customer identity is derived from the JWT (AC1, AC17).
 *       Returns an empty array when no Orders exist — not an error (AC2).
 *
 *       For authorized staff: Returns all Orders in reverse chronological order
 *       for operational tracking, inspection, and fulfillment (AC6, ADR-004 §13).
 *
 *       Responses do not expose password hashes, JWT secrets, stack traces, or
 *       unrelated PII (AC18).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Accessible orders returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/OrderSummary'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/orders', authenticate, authorizeRoles(...ALL_ORDER_VIEW_ROLES), getOrders);

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     summary: Retrieve a single Order and its tracking details
 *     description: >
 *       Accessible to CUSTOMER and authorized branch staff (BRANCH_ASSISTANT) per ADR-004 §12, §13.
 *
 *       For CUSTOMER: Returns the specified Order and its OrderItems only if
 *       the Order is owned by the authenticated Customer. Ownership is enforced
 *       server-side to prevent IDOR (AC4).
 *
 *       For authorized staff: Returns tracking information, audit history, and
 *       line items for the requested order to facilitate customer care and fulfillment.
 *
 *       A malformed Order ID returns a 422 Validation Error (AC5).
 *       A valid but inaccessible or non-existent Order returns a 404 response
 *       that does not leak whether the Order exists for a different customer (AC6).
 *
 *       The response includes canonical ADR-004 Order status and embedded
 *       status history (AC7, AC8). OrderItems expose only approved fields (AC9).
 *       Sensitive internal fields are not exposed (AC18).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: MongoDB ObjectId of the Order to retrieve.
 *         example: '507f1f77bcf86cd799439021'
 *     responses:
 *       200:
 *         description: Order with OrderItems returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/OrderDetail'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/orders/:id',
  authenticate,
  authorizeRoles(...ALL_ORDER_VIEW_ROLES),
  validate(validateOrderId),
  getOrderById
);

/**
 * @openapi
 * /orders/{id}/status:
 *   patch:
 *     summary: Update an Order's canonical tracking status
 *     description: >
 *       Authorized branch staff only (BRANCH_ASSISTANT and BRANCH_MANAGER).
 *       Validates canonical status value, ensures transition is permitted by
 *       the authoritative ADR-004 lifecycle matrix, and rejects changes to
 *       terminal states (COMPLETED, CANCELLED).
 *
 *       On successful transition, updates status, records timestamp, and appends
 *       audit entry to embedded statusHistory. When transitioning to CANCELLED,
 *       dispatches an automated notification to the customer with branch refund guidance.
 *       COMPLETED requires a verified completed Payment and resolvable checkout item
 *       classification. Order completion, Customer balance and idempotent loyalty history
 *       commit atomically. Unresolved classification, legacy balance/history or
 *       reconciliation holds return 409 without completing the Order. No earning at PROCESSING.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: MongoDB ObjectId of the Order.
 *         example: '507f1f77bcf86cd799439021'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateOrderStatusRequest'
 *     responses:
 *       200:
 *         description: Order status successfully updated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/OrderDetail'
 *       409:
 *         description: Loyalty classification, verified capture, legacy balance/history or reconciliation prevents atomic Order completion.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.patch(
  '/orders/:id/status',
  authenticate,
  authorizeRoles(...ORDER_STATUS_UPDATE_ROLES),
  validate(validateUpdateOrderStatus),
  updateOrderStatus
);

module.exports = router;
