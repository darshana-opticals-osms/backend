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
 *                   type: object
 *                   required: [currency, timezone, dateRange, summary, breakdowns]
 *                   properties:
 *                     currency:
 *                       type: string
 *                       example: LKR
 *                     timezone:
 *                       type: string
 *                       example: Asia/Colombo
 *                     dateRange:
 *                       type: object
 *                       required: [preset, startDate, endDate]
 *                       properties:
 *                         preset:
 *                           type: string
 *                           example: today
 *                         startDate:
 *                           type: string
 *                           format: date
 *                           example: '2026-10-19'
 *                         endDate:
 *                           type: string
 *                           format: date
 *                           example: '2026-10-19'
 *                     summary:
 *                       type: object
 *                       required: [grossRevenue, netRevenue, totalOrders, itemsSold, cancelledOrdersCount, cancelledOrdersValue]
 *                       properties:
 *                         grossRevenue:
 *                           type: number
 *                           example: 25000
 *                         refundDeductions:
 *                           type: number
 *                           description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                           example: 2000
 *                         netRevenue:
 *                           type: number
 *                           example: 23000
 *                         totalOrders:
 *                           type: integer
 *                           example: 2
 *                         itemsSold:
 *                           type: integer
 *                           example: 3
 *                         averageOrderValue:
 *                           type: number
 *                           description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                           example: 12500
 *                         cancelledOrdersCount:
 *                           type: integer
 *                           example: 1
 *                         cancelledOrdersValue:
 *                           type: number
 *                           example: 4000
 *                     breakdowns:
 *                       type: object
 *                       required: [byTime, byBranch, byCategory, byPaymentMethod]
 *                       properties:
 *                         byTime:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [period, grossRevenue, netRevenue, orderCount]
 *                             properties:
 *                               period:
 *                                 type: string
 *                                 example: '2026-10-19'
 *                               grossRevenue:
 *                                 type: number
 *                                 example: 25000
 *                               netRevenue:
 *                                 type: number
 *                                 example: 23000
 *                               orderCount:
 *                                 type: integer
 *                                 example: 2
 *                         byBranch:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [branchName, grossRevenue, netRevenue, orderCount, itemCount]
 *                             properties:
 *                               branchId:
 *                                 type: string
 *                                 nullable: true
 *                                 example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                               branchName:
 *                                 type: string
 *                                 example: Colombo Central
 *                               grossRevenue:
 *                                 type: number
 *                                 example: 25000
 *                               refundDeductions:
 *                                 type: number
 *                                 description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                                 example: 2000
 *                               netRevenue:
 *                                 type: number
 *                                 example: 23000
 *                               orderCount:
 *                                 type: integer
 *                                 example: 2
 *                               itemCount:
 *                                 type: integer
 *                                 example: 3
 *                         byCategory:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [category, quantity, revenue]
 *                             properties:
 *                               category:
 *                                 type: string
 *                                 example: Sunglasses
 *                               quantity:
 *                                 type: integer
 *                                 example: 3
 *                               revenue:
 *                                 type: number
 *                                 example: 25000
 *                         byPaymentMethod:
 *                           type: array
 *                           description: Restricted payment method breakdown (SM-09); omitted for BRANCH_MANAGER per ADR-014 §10.1.
 *                           items:
 *                             type: object
 *                             required: [method, count, volume]
 *                             properties:
 *                               method:
 *                                 type: string
 *                                 example: card
 *                               count:
 *                                 type: integer
 *                                 example: 1
 *                               volume:
 *                                 type: number
 *                                 example: 15000
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
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
 *                   type: object
 *                   required: [orders, pagination, dateRange]
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [orderId, paymentId, paidAt, orderDate, paidAmount, orderAmount, orderStatus, paymentMethod, branchName, itemCount, customer]
 *                         properties:
 *                           orderId:
 *                             type: string
 *                             example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                           paymentId:
 *                             type: string
 *                             example: '60d5ec49f1b2c8b1f8e4e1a2'
 *                           paidAt:
 *                             type: string
 *                             format: date-time
 *                           orderDate:
 *                             type: string
 *                             format: date-time
 *                           paidAmount:
 *                             type: number
 *                             example: 15000
 *                           orderAmount:
 *                             type: number
 *                             example: 15000
 *                           orderStatus:
 *                             type: string
 *                             example: COMPLETED
 *                           paymentMethod:
 *                             type: string
 *                             example: card
 *                           branchId:
 *                             type: string
 *                             nullable: true
 *                             example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                           branchName:
 *                             type: string
 *                             example: Colombo Central
 *                           itemCount:
 *                             type: integer
 *                             example: 2
 *                           customer:
 *                             type: object
 *                             required: [name, email, phone, address]
 *                             properties:
 *                               name:
 *                                 type: string
 *                                 example: K*** P***
 *                               email:
 *                                 type: string
 *                                 example: k***@gmail.com
 *                               phone:
 *                                 type: string
 *                                 example: +94 77 **** 567
 *                               address:
 *                                 type: string
 *                                 example: Colombo 03
 *                     pagination:
 *                       type: object
 *                       required: [page, limit, totalRecords, totalPages, isTruncated, totalMatching, exportedCount]
 *                       properties:
 *                         page:
 *                           type: integer
 *                           example: 1
 *                         limit:
 *                           type: integer
 *                           example: 20
 *                         totalRecords:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 1
 *                         isTruncated:
 *                           type: boolean
 *                           example: false
 *                         totalMatching:
 *                           type: integer
 *                           example: 1
 *                         exportedCount:
 *                           type: integer
 *                           example: 1
 *                     dateRange:
 *                       type: object
 *                       required: [preset, startDate, endDate]
 *                       properties:
 *                         preset:
 *                           type: string
 *                           example: today
 *                         startDate:
 *                           type: string
 *                           format: date
 *                           example: '2026-10-19'
 *                         endDate:
 *                           type: string
 *                           format: date
 *                           example: '2026-10-19'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales/orders',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
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
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/sales/export',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
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
 *                   type: object
 *                   required: [currency, snapshotTimestamp, reorderThresholdUsed, summary, breakdowns]
 *                   properties:
 *                     currency:
 *                       type: string
 *                       example: LKR
 *                     snapshotTimestamp:
 *                       type: string
 *                       format: date-time
 *                     reorderThresholdUsed:
 *                       type: integer
 *                       example: 5
 *                     summary:
 *                       type: object
 *                       required: [totalStockOnHand, totalUniqueProducts, lowStockCount, reorderTriggeredCount, okStockCount]
 *                       properties:
 *                         totalStockOnHand:
 *                           type: integer
 *                           example: 15
 *                         totalRetailValuation:
 *                           type: number
 *                           description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                           example: 435000
 *                         totalUniqueProducts:
 *                           type: integer
 *                           example: 3
 *                         lowStockCount:
 *                           type: integer
 *                           example: 1
 *                         reorderTriggeredCount:
 *                           type: integer
 *                           example: 1
 *                         okStockCount:
 *                           type: integer
 *                           example: 1
 *                     breakdowns:
 *                       type: object
 *                       required: [byBranch, byCategory]
 *                       properties:
 *                         byBranch:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [branchName, totalStock, itemCount, lowStockCount, reorderTriggeredCount]
 *                             properties:
 *                               branchId:
 *                                 type: string
 *                                 nullable: true
 *                                 example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                               branchName:
 *                                 type: string
 *                                 example: Colombo Central
 *                               totalStock:
 *                                 type: integer
 *                                 example: 15
 *                               totalRetailValuation:
 *                                 type: number
 *                                 description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                                 example: 435000
 *                               itemCount:
 *                                 type: integer
 *                                 example: 2
 *                               lowStockCount:
 *                                 type: integer
 *                                 example: 1
 *                               reorderTriggeredCount:
 *                                 type: integer
 *                                 example: 0
 *                         byCategory:
 *                           type: array
 *                           items:
 *                             type: object
 *                             required: [category, totalStock, itemCount]
 *                             properties:
 *                               category:
 *                                 type: string
 *                                 example: Frames
 *                               totalStock:
 *                                 type: integer
 *                                 example: 15
 *                               totalRetailValuation:
 *                                 type: number
 *                                 description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                                 example: 435000
 *                               itemCount:
 *                                 type: integer
 *                                 example: 2
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
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
 *                   type: object
 *                   required: [items, reorderThresholdUsed, pagination]
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [id, sku, name, category, brand, unitPrice, quantity, reorderThreshold, reorderStatus, branchName]
 *                         properties:
 *                           id:
 *                             type: string
 *                             example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                           sku:
 *                             type: string
 *                             example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                           name:
 *                             type: string
 *                             example: RayBan Aviator Classic
 *                           category:
 *                             type: string
 *                             example: Frames
 *                           brand:
 *                             type: string
 *                             example: RayBan
 *                           unitPrice:
 *                             type: number
 *                             description: Operational item retail price; retained across roles for store operations and stocktaking.
 *                             example: 25000
 *                           quantity:
 *                             type: integer
 *                             example: 12
 *                           reorderThreshold:
 *                             type: integer
 *                             example: 5
 *                           reorderStatus:
 *                             type: string
 *                             enum: [OK, LOW_STOCK, REORDER_TRIGGERED]
 *                             example: OK
 *                           retailValuation:
 *                             type: number
 *                             description: Restricted financial metric; omitted for BRANCH_MANAGER per ADR-014.
 *                             example: 300000
 *                           branchId:
 *                             type: string
 *                             nullable: true
 *                             example: '60d5ec49f1b2c8b1f8e4e1a1'
 *                           branchName:
 *                             type: string
 *                             example: Colombo Central
 *                     reorderThresholdUsed:
 *                       type: integer
 *                       example: 5
 *                     pagination:
 *                       type: object
 *                       required: [page, limit, totalRecords, totalPages, isTruncated, totalMatching, exportedCount]
 *                       properties:
 *                         page:
 *                           type: integer
 *                           example: 1
 *                         limit:
 *                           type: integer
 *                           example: 20
 *                         totalRecords:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 1
 *                         isTruncated:
 *                           type: boolean
 *                           example: false
 *                         totalMatching:
 *                           type: integer
 *                           example: 1
 *                         exportedCount:
 *                           type: integer
 *                           example: 1
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory/items',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
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
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/reports/inventory/export',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER),
  validate(validateInventoryExportQuery),
  exportInventoryReport
);

module.exports = router;
