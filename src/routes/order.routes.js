const express = require('express');
const mongoose = require('mongoose');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const { getMyOrders, getMyOrderById } = require('../controllers/order.controller');

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

const router = express.Router();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /orders:
 *   get:
 *     summary: Retrieve the authenticated customer's order history
 *     description: >
 *       CUSTOMER-only. Returns all Orders owned by the authenticated Customer,
 *       ordered newest-first. Customer identity is derived from the JWT — a
 *       client-supplied customerId is never accepted (AC1, AC17).
 *       Returns an empty array when no Orders exist — not an error (AC2).
 *       Responses do not expose password hashes, JWT secrets, stack traces, or
 *       unrelated PII (AC18).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer's order history (may be empty).
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
router.get(
  '/orders',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  getMyOrders
);

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     summary: Retrieve a single Order owned by the authenticated customer
 *     description: >
 *       CUSTOMER-only. Returns the specified Order and its OrderItems only if
 *       the Order is owned by the authenticated Customer.
 *
 *       Ownership is enforced server-side by scoping the database query to
 *       both the Order ID and the authenticated customer's ID (AC4 — IDOR
 *       prevention). A customer cannot retrieve another customer's Order by
 *       manipulating the ID.
 *
 *       A malformed Order ID returns a 422 Validation Error (AC5).
 *       A valid but inaccessible or non-existent Order returns a 404 response
 *       that does not leak whether the Order exists for a different customer (AC6).
 *
 *       The response includes the canonical ADR-004 Order status and embedded
 *       status history (AC7, AC8). OrderItems expose only approved
 *       customer-facing fields (AC9). Sensitive internal fields are not
 *       exposed (AC18).
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
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validateOrderId),
  getMyOrderById
);

module.exports = router;
