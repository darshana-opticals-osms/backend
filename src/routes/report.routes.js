const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  validateSalesReportQuery,
  validateSalesOrdersQuery,
  validateSalesExportQuery,
  validateInventoryReportQuery,
  validateInventoryItemsQuery,
  validateInventoryExportQuery,
} = require('../validations/report.validation');
const {
  getSalesReport,
  getSalesOrders,
  exportSalesReport,
  getInventoryReport,
  getInventoryItems,
  exportInventoryReport,
} = require('../controllers/report.controller');

/**
 * @openapi
 * /reports/sales:
 *   get:
 *     summary: Retrieve sales performance summary metrics and breakdowns
 *     description: |
 *       Returns recognized sales revenue (SM-01 Gross Revenue, SM-02 Refunds, SM-03 Net Revenue),
 *       qualifying orders count (SM-04), average order value (SM-05), items sold (SM-06), and
 *       breakdowns by time, branch, category, and payment method according to ADR-014.
 *       Restricted to SYSTEM_ADMIN (organization-wide) and BRANCH_MANAGER (assigned branch only).
 *       Zero sales activity in the selected window returns an HTTP 200 payload with numeric zeroes.
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: preset
 *         schema:
 *           type: string
 *           enum: [today, last_7_days, last_30_days, this_month, custom]
 *         description: Reporting date preset evaluated in Asia/Colombo (+05:30).
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive start date (YYYY-MM-DD). Required when preset=custom.
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive end date (YYYY-MM-DD). Maximum range 365 days.
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Branch ObjectId. System Admin can filter by branch or omit for org-wide; Branch Managers are restricted to their assigned branch.
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [day, week, month, branch, category]
 *         description: Aggregation grouping for time-series and dimension breakdown.
 *     responses:
 *       200:
 *         description: Sales metrics and breakdowns retrieved successfully.
 *       400:
 *         description: Invalid query parameter or date range exceeds 365 days.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateSalesReportQuery),
  getSalesReport
);

/**
 * @openapi
 * /reports/sales/orders:
 *   get:
 *     summary: Retrieve paginated sales order records with masked PII
 *     description: |
 *       Returns paginated individual sales orders qualifying under ADR-014 (COMPLETED payment, non-cancelled order).
 *       PII is strictly masked (e.g. Kasun Perera -> K*** P***, email -> k***@..., address -> locality only).
 *       Clinical prescription fields (sphere, cylinder, axis, etc.) are omitted entirely.
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: preset
 *         schema:
 *           type: string
 *           enum: [today, last_7_days, last_30_days, this_month, custom]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [paidAt, createdAt, totalAmount, quantity]
 *           default: paidAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: orderStatus
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated orders retrieved successfully.
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales/orders',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateSalesOrdersQuery),
  getSalesOrders
);

/**
 * @openapi
 * /reports/sales/export:
 *   get:
 *     summary: Export qualifying sales records as RFC-4180 CSV
 *     description: |
 *       Generates and downloads an RFC-4180 CSV export of qualifying sales records.
 *       Protects against CSV injection (CWE-1236), masks customer PII, omits all clinical data,
 *       and records an immutable audit event (REPORT_EXPORT_GENERATED).
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: preset
 *         schema:
 *           type: string
 *           enum: [today, last_7_days, last_30_days, this_month, custom]
 *         description: Reporting date preset evaluated in Asia/Colombo (+05:30).
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive start date (YYYY-MM-DD). Required when preset=custom.
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive end date (YYYY-MM-DD). Maximum range 365 days.
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [xlsx, csv]
 *           default: xlsx
 *         description: Export file format. Default is xlsx (multi-sheet Excel workbook).
 *     responses:
 *       200:
 *         description: Report export file stream (Excel workbook or CSV).
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales/export',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateSalesExportQuery),
  exportSalesReport
);

/**
 * @openapi
 * /reports/inventory:
 *   get:
 *     summary: Retrieve current inventory snapshot metrics and breakdowns
 *     description: |
 *       Returns authoritative snapshot metrics (IM-01 Total Stock on Hand, IM-02 Branch breakdown,
 *       IM-03 Category breakdown, IM-04 Low Stock Count, IM-05 Reorder-Triggered Count, and
 *       IM-06 Total Retail Valuation in LKR) according to ADR-014 §9.
 *       Accessible by SYSTEM_ADMIN (organization-wide or branch filter) and BRANCH_MANAGER (assigned branch scope).
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Branch ObjectId to filter snapshot.
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by product category.
 *       - in: query
 *         name: reorderStatus
 *         schema:
 *           type: string
 *           enum: [OK, LOW_STOCK, REORDER_TRIGGERED]
 *         description: Filter by live reorder threshold state.
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [branch, category]
 *     responses:
 *       200:
 *         description: Inventory snapshot metrics retrieved successfully.
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateInventoryReportQuery),
  getInventoryReport
);

/**
 * @openapi
 * /reports/inventory/items:
 *   get:
 *     summary: Retrieve paginated stock items with live reorder states
 *     description: |
 *       Returns paginated inventory stock items enriched with current branch details, retail valuation,
 *       and evaluated reorder status (OK, LOW_STOCK, REORDER_TRIGGERED) evaluated against ADR-006 threshold.
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: reorderStatus
 *         schema:
 *           type: string
 *           enum: [OK, LOW_STOCK, REORDER_TRIGGERED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [quantity, unitPrice, name, category, sku]
 *           default: quantity
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Paginated stock items retrieved successfully.
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory/items',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateInventoryItemsQuery),
  getInventoryItems
);

/**
 * @openapi
 * /reports/inventory/export:
 *   get:
 *     summary: Export current inventory stock items as RFC-4180 CSV
 *     description: |
 *       Generates and downloads an RFC-4180 CSV export of current inventory items.
 *       Protects against CSV injection (CWE-1236) and records an immutable audit event (REPORT_EXPORT_GENERATED).
 *     tags:
 *       - Reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: reorderStatus
 *         schema:
 *           type: string
 *           enum: [OK, LOW_STOCK, REORDER_TRIGGERED]
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [xlsx, csv]
 *           default: xlsx
 *         description: Export file format. Default is xlsx (multi-sheet Excel workbook).
 *     responses:
 *       200:
 *         description: Inventory export file stream (Excel workbook or CSV).
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory/export',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER
  ),
  validate(validateInventoryExportQuery),
  exportInventoryReport
);

module.exports = router;
