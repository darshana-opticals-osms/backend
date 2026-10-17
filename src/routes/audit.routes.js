const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { ROLE_VALUES } = require('../constants/roles');
const { getAuditEvents } = require('../controllers/audit.controller');

/**
 * @openapi
 * /audit-events:
 *   get:
 *     summary: Retrieve immutable audit trail records
 *     description: Restricted strictly to SYSTEM_ADMIN. Returns chronologically ordered audit events with safe filters and bounded pagination (ADR-012 AC53–AC58).
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by canonical AUDIT_ACTION value (e.g. INVENTORY_QUANTITY_ADJUSTED, PAYMENT_COMPLETED, PRESCRIPTION_RECORDED).
 *       - in: query
 *         name: targetType
 *         schema:
 *           type: string
 *         description: Filter by target resource type (INVENTORY, PAYMENT, ORDER, PRESCRIPTION, LOYALTY_TRANSACTION).
 *       - in: query
 *         name: targetId
 *         schema:
 *           type: string
 *         description: Filter by specific target identifier.
 *       - in: query
 *         name: actorId
 *         schema:
 *           type: string
 *         description: Filter by actor identifier.
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter by branch identifier.
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date (inclusive, ISO 8601).
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date (inclusive, ISO 8601).
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 1-indexed page number.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of events per page (maximum 100).
 *     responses:
 *       200:
 *         description: Audit records retrieved successfully.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/audit-events', authenticate, authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN), getAuditEvents);

module.exports = router;
