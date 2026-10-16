const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  validateOwnLoyaltyRequest,
  validateManagementLoyaltyRequest,
} = require('../validations/loyalty.validation');
const { getOwnLoyalty, listManagementLoyalty } = require('../controllers/loyalty.controller');

const router = express.Router();

/**
 * @openapi
 * /loyalty/me:
 *   get:
 *     summary: Retrieve the authenticated Customer's loyalty balance and history
 *     description: CUSTOMER only. Customer identity is derived exclusively from the verified JWT; client-supplied Customer identifiers are rejected. This endpoint is read-only and returns a minimal loyalty DTO with fixed two-decimal point strings. A legacy Customer without an initialized loyalty balance receives a 409 conflict and is not silently backfilled.
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, maximum: 10000, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: Own current loyalty balance and paginated history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/OwnLoyaltyResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
router.get(
  '/loyalty/me',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validateOwnLoyaltyRequest),
  getOwnLoyalty
);

/**
 * @openapi
 * /loyalty:
 *   get:
 *     summary: Monitor loyalty transaction history
 *     description: BRANCH_MANAGER only. Read-only monitoring of persisted loyalty transactions using exact allowlisted filters. Customer profiles are not populated and responses exclude Customer PII, provider references, source-event identifiers, credentials and internal metadata. Results sort by createdAt and then _id for deterministic pagination.
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, maximum: 10000, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: customerId
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: orderId
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: paymentId
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: eventType
 *         schema: { type: string, enum: [EARN_PURCHASE, REFUND_REVERSAL, REDEMPTION_DEDUCTION] }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Safe paginated loyalty transaction history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ManagementLoyaltyResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
router.get(
  '/loyalty',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(validateManagementLoyaltyRequest),
  listManagementLoyalty
);

module.exports = router;
