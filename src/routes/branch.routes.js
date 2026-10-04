const express = require('express');
const { getBranches } = require('../controllers/branch.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { ROLE_VALUES } = require('../constants/roles');

const router = express.Router();

/**
 * @openapi
 * /branches:
 *   get:
 *     summary: List Branch references
 *     description: Returns safe Branch reference metadata for approved authenticated staff workflows. Branch metadata does not grant access to Inventory, reports, Staff, Customer, or clinical data; those domain APIs enforce their own authorization and scope.
 *     tags:
 *       - Branches
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Branch references returned successfully. An empty Branch collection returns an empty data array.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BranchReference'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/branches',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.INVENTORY_MANAGER,
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.MANAGEMENT
  ),
  getBranches
);

module.exports = router;
