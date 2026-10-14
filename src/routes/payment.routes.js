const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  initiatePayment,
  getOwnOrderPaymentStatus,
  receivePayHereNotification,
} = require('../controllers/payment.controller');
const {
  validatePaymentInitiation,
  validatePaymentStatusRequest,
} = require('../validations/payment.validation');

const paymentRouter = express.Router();
const paymentNotificationRouter = express.Router();

/**
 * @openapi
 * /payments/notify:
 *   post:
 *     summary: Receive a PayHere server-to-server payment notification
 *     description: Public provider callback. Trust is established by PayHere merchant and MD5 signature verification, not JWT authentication. Accepts form-encoded PayHere fields only. Browser return and cancel URLs are not payment proof.
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [merchant_id, order_id, payment_id, payhere_amount, payhere_currency, status_code, md5sig]
 *             properties:
 *               merchant_id: { type: string }
 *               order_id: { type: string, description: Unique OSMS Payment-attempt reference. }
 *               payment_id: { type: string }
 *               payhere_amount: { type: string, pattern: '^\\d+\\.\\d{2}$' }
 *               payhere_currency: { type: string, enum: [LKR] }
 *               status_code: { type: string, enum: ['2', '0', '-1', '-2', '-3'] }
 *               md5sig: { type: string, writeOnly: true }
 *     responses:
 *       200: { description: Verified notification acknowledged, including idempotent replay. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentNotificationRouter.post('/', receivePayHereNotification);

/**
 * @openapi
 * /payments/initiate:
 *   post:
 *     summary: Initiate or reuse PayHere checkout for the customer's own Order
 *     description: CUSTOMER-only. The backend derives ownership, amount, LKR currency, online_gateway method, expiry and provider attempt identity. Validated billing fields override profile defaults for this checkout request only and do not update the Customer profile.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [orderId, city]
 *             properties:
 *               orderId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *               city: { type: string, maxLength: 120, description: Billing city for this checkout request. }
 *               firstName: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *               lastName: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *               address: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *     responses:
 *       201: { description: Safe PayHere hosted-checkout fields and Payment status. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.post(
  '/payments/initiate',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validatePaymentInitiation),
  initiatePayment
);

/**
 * @openapi
 * /orders/{orderId}/payment-status:
 *   get:
 *     summary: Retrieve authoritative payment status for the customer's own Order
 *     description: CUSTOMER-only and ownership scoped. Provider internals, signatures and secrets are excluded.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *     responses:
 *       200:
 *         description: Safe Order-level payment summary with latest, completed and historical attempt information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string }
 *                     orderStatus: { type: string }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         paid: { type: boolean }
 *                         reconciliationRequired: { type: boolean }
 *                         activeAttempt: { type: boolean }
 *                         attemptCount: { type: integer }
 *                     latestAttempt: { type: object, nullable: true }
 *                     completedAttempt: { type: object, nullable: true }
 *                     attempts:
 *                       type: array
 *                       items: { type: object }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.get(
  '/orders/:orderId/payment-status',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validatePaymentStatusRequest),
  getOwnOrderPaymentStatus
);

module.exports = { paymentRouter, paymentNotificationRouter };
