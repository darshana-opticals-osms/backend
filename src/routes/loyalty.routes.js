const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const { validateOwnLoyaltyRequest } = require('../validations/loyalty.validation');
const { getOwnLoyalty } = require('../controllers/loyalty.controller');

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

module.exports = router;
