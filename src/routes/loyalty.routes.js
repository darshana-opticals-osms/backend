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
 *     description: >
 *       CUSTOMER only. Customer identity is derived exclusively from the verified JWT;
 *       no Customer ID is accepted from the client. This read-only endpoint returns the
 *       backend-authoritative balance and paginated own history as exact two-decimal strings.
 *       Clients cannot submit balances, awarded points or conversion rates. Arbitrary
 *       adjustment is prohibited; redemption and partial-refund processing are not
 *       available. A legacy Customer with a missing or null balance receives 409 and is
 *       not silently initialized, migrated or backfilled.
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         description: One-based history page.
 *         schema: { type: integer, minimum: 1, maximum: 10000, default: 1 }
 *       - in: query
 *         name: limit
 *         description: History records per page.
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
 *     description: >
 *       BRANCH_MANAGER only. Read-only monitoring of backend-authoritative persisted
 *       loyalty transactions using the documented allowlisted filters. Customer profiles
 *       are not populated, and the minimal response excludes Customer PII, payment-provider
 *       secrets and references, source-event identifiers, credentials and internal metadata.
 *       Results sort by createdAt and then _id for deterministic pagination. Clients cannot
 *       submit balances or awarded points; arbitrary adjustment is prohibited, and redemption
 *       and partial-refund processing are not available.
 *     tags: [Loyalty]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         description: One-based monitoring page.
 *         schema: { type: integer, minimum: 1, maximum: 10000, default: 1 }
 *       - in: query
 *         name: limit
 *         description: Transactions per page.
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: customerId
 *         description: Exact Customer ObjectId filter.
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: orderId
 *         description: Exact Order ObjectId filter.
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: paymentId
 *         description: Exact Payment ObjectId filter.
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: eventType
 *         description: Exact persisted loyalty event category filter.
 *         schema: { type: string, enum: [EARN_PURCHASE, REFUND_REVERSAL, REDEMPTION_DEDUCTION] }
 *       - in: query
 *         name: sortOrder
 *         description: Direction for createdAt and _id sorting.
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
