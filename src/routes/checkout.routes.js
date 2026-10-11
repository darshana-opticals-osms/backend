const express = require('express');
const { checkout } = require('../controllers/checkout.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');

const validateCheckoutRequest = (req) => {
  const errors = [];
  const body = req.body;
  const originalBody = req.checkoutOriginalBody;
  const originalQuery = req.checkoutOriginalQuery || {};
  const hasPayload =
    Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding') !== undefined;

  if (hasPayload && !req.is('application/json')) {
    errors.push({ field: 'content-type', message: 'Checkout payloads must use application/json.' });
  }

  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body))) {
    errors.push({ field: 'body', message: 'Checkout accepts an empty JSON object only.' });
  } else if (body && Object.keys(body).length > 0) {
    errors.push({ field: 'body', message: 'Checkout does not accept client-supplied order data.' });
  }

  if (
    originalBody !== undefined &&
    (!originalBody || typeof originalBody !== 'object' || Array.isArray(originalBody))
  ) {
    errors.push({ field: 'body', message: 'Checkout accepts an empty JSON object only.' });
  } else if (originalBody && Object.keys(originalBody).length > 0) {
    errors.push({ field: 'body', message: 'Checkout does not accept client-supplied order data.' });
  }

  for (const field of Object.keys(originalQuery)) {
    errors.push({ field, message: `${field} is not supported for Checkout requests.` });
  }

  return errors;
};

const router = express.Router();

/**
 * @openapi
 * /checkout:
 *   post:
 *     summary: Securely check out the authenticated customer's persisted Cart
 *     description: CUSTOMER-only. Creates an Order from the backend Cart, validates current Inventory and prices, deducts stock, and deletes the Cart atomically. The request must not contain order, price, stock, total, or ownership data.
 *     tags: [Checkout]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             maxProperties: 0
 *             additionalProperties: false
 *           example: {}
 *     responses:
 *       201:
 *         description: Order created from the persisted Cart.
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
 *                   $ref: '#/components/schemas/CheckoutResult'
 *       400:
 *         description: Malformed JSON payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/checkout',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validateCheckoutRequest),
  checkout
);

module.exports = router;
