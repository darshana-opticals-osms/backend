const ExcelJS = require('exceljs');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../constants/audit');
const { ROLE_VALUES } = require('../constants/roles');
const { resolveReportScope } = require('../utils/reportScope');
const { getSalesOrdersList, getSalesReport } = require('./reportSales.service');
const { getInventoryItemsList, getInventoryReport } = require('./reportInventory.service');
const auditService = require('./audit.service');

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME_TYPE = 'text/csv; charset=utf-8';

/**
 * Escapes a single cell value for RFC-4180 compliance with CSV injection protection (CWE-1236).
 *
 * @param {any} value
 * @returns {string}
 */
function escapeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);

  // Prevent formula injection: if first character is =, +, -, @, \t, or \r, prepend a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC-4180: If cell contains quotes, commas, or line breaks, enclose in quotes and double internal quotes
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds RFC-4180 compliant CSV string from headers and array of row arrays.
 *
 * @param {Array<string>} headers
 * @param {Array<Array<any>>} rows
 * @returns {string}
 */
function buildCsvString(headers, rows) {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\r\n') + '\r\n';
}

/**
 * Sanitizes worksheet name for Excel compliance:
 * - Max length 31 characters
 * - No forbidden characters: \ / ? * [ ] :
 * - Case-insensitive uniqueness within workbook
 *
 * @param {string} name
 * @param {Set<string>} existingNames
 * @returns {string}
 */
function sanitizeSheetName(name, existingNames = new Set()) {
  let clean = String(name || 'Branch')
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  if (!clean) clean = 'Branch';

  let candidate = clean;
  let counter = 1;
  while (existingNames.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
    counter += 1;
  }
  existingNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Builds an ExcelJS Workbook aligned with ADR-014:
 * For SYSTEM_ADMIN (isOrgWide = true):
 *   1. Executive Summary
 *   2. Branch Breakdowns
 *   3. Inventory Snapshot
 *   4. Orders Breakdown
 *
 * For BRANCH_MANAGER (isOrgWide = false):
 *   1. Executive Summary
 *   2. Orders Breakdown
 *
 * @param {Object} options
 * @param {Array<Object>} options.orders
 * @param {Object} [options.summary]
 * @param {Object} [options.inventorySnapshot]
 * @param {boolean} options.isOrgWide
 * @param {boolean} [options.isTruncated=false]
 * @param {string|null} [options.userRole]
 * @returns {Promise<Buffer>}
 */
async function buildSalesExcelWorkbook({
  orders,
  summary = null,
  inventorySnapshot = null,
  isOrgWide,
  isTruncated = false,
  totalMatching = 0,
  userRole = null,
}) {
  const isBranchManager = userRole === ROLE_VALUES.BRANCH_MANAGER;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OSMS Darshana Opticals';
  workbook.created = new Date();

  const existingSheetNames = new Set();
  const summaryData = summary?.summary || summary || {};

  // 1. Executive Summary Sheet (ADR-014 §11 requirement)
  const summarySheetName = sanitizeSheetName('Executive Summary', existingSheetNames);
  const summarySheet = workbook.addWorksheet(summarySheetName);
  summarySheet.columns = [
    { header: 'KPI / Metric Description', key: 'metric', width: 36 },
    { header: 'Reported Value', key: 'value', width: 26 },
    { header: 'ADR-014 Reference', key: 'refId', width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9E1F2' },
  };

  summarySheet.addRow({
    metric: 'Recognized Gross Revenue (LKR)',
    value: Number(summaryData.grossRevenue || 0).toFixed(2),
    refId: 'SM-01',
  });
  if (!isBranchManager) {
    summarySheet.addRow({
      metric: 'Refund Deductions (LKR)',
      value: Number(summaryData.refundDeductions || 0).toFixed(2),
      refId: 'SM-02',
    });
  }
  summarySheet.addRow({
    metric: 'Recognized Net Revenue (LKR)',
    value: Number(summaryData.netRevenue || 0).toFixed(2),
    refId: 'SM-03',
  });
  summarySheet.addRow({
    metric: 'Total Qualifying Orders',
    value: summaryData.totalOrders ?? 0,
    refId: 'SM-04',
  });
  if (!isBranchManager) {
    summarySheet.addRow({
      metric: 'Average Order Value (LKR)',
      value: Number(summaryData.averageOrderValue || 0).toFixed(2),
      refId: 'SM-05',
    });
  }
  summarySheet.addRow({
    metric: 'Items Sold Quantity',
    value: summaryData.itemsSold ?? 0,
    refId: 'SM-06',
  });
  summarySheet.addRow({
    metric: 'Cancelled Orders Count',
    value: summaryData.cancelledOrdersCount ?? 0,
    refId: 'SM-10',
  });
  summarySheet.addRow({
    metric: 'Cancelled Orders Value (LKR)',
    value: Number(summaryData.cancelledOrdersValue || 0).toFixed(2),
    refId: 'SM-10',
  });

  if (isTruncated) {
    summarySheet.addRow({
      metric: 'Export Row Limit Notice',
      value: `Export capped at row limit. Total matching in database: ${totalMatching}`,
      refId: 'NOTICE (TRUNCATED)',
    });
  }

  // 2. Branch Breakdowns Sheet (System Admin org-wide only per ADR-014)
  if (isOrgWide) {
    const branchBreakdownsName = sanitizeSheetName('Branch Breakdowns', existingSheetNames);
    const branchSheet = workbook.addWorksheet(branchBreakdownsName);
    branchSheet.columns = [
      { header: 'Branch Name', key: 'branchName', width: 28 },
      { header: 'Gross Revenue (LKR)', key: 'grossRevenue', width: 22 },
      { header: 'Refund Deductions (LKR)', key: 'refundDeductions', width: 22 },
      { header: 'Net Revenue (LKR)', key: 'netRevenue', width: 22 },
      { header: 'Total Orders', key: 'orderCount', width: 16 },
      { header: 'Items Sold', key: 'itemCount', width: 16 },
    ];
    branchSheet.getRow(1).font = { bold: true };
    branchSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };

    const branchList = summary?.breakdowns?.byBranch || [];
    for (const b of branchList) {
      branchSheet.addRow({
        branchName: b.branchName || 'Unassigned',
        grossRevenue: Number(b.grossRevenue || 0).toFixed(2),
        refundDeductions: Number(b.refundDeductions || 0).toFixed(2),
        netRevenue: Number(b.netRevenue || 0).toFixed(2),
        orderCount: b.orderCount ?? 0,
        itemCount: b.itemCount ?? 0,
      });
    }

    // 3. Inventory Snapshot Sheet (System Admin org-wide only per ADR-014)
    const invSnapshotName = sanitizeSheetName('Inventory Snapshot', existingSheetNames);
    const invSheet = workbook.addWorksheet(invSnapshotName);
    invSheet.columns = [
      { header: 'Branch / Metric Description', key: 'name', width: 32 },
      { header: 'Total Stock on Hand', key: 'totalStock', width: 22 },
      { header: 'Retail Valuation (LKR)', key: 'retailValuation', width: 24 },
      { header: 'Low Stock Items', key: 'lowStockCount', width: 18 },
      { header: 'Reorder Triggered Items', key: 'reorderTriggeredCount', width: 24 },
    ];
    invSheet.getRow(1).font = { bold: true };
    invSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' },
    };

    const invSummary = inventorySnapshot?.data?.summary;
    if (invSummary) {
      invSheet.addRow({
        name: 'TOTAL ORGANIZATION INVENTORY',
        totalStock: invSummary.totalStockOnHand ?? 0,
        retailValuation: Number(invSummary.totalRetailValuation || 0).toFixed(2),
        lowStockCount: invSummary.lowStockCount ?? 0,
        reorderTriggeredCount: invSummary.reorderTriggeredCount ?? 0,
      });
    }

    const invBranches = inventorySnapshot?.data?.breakdowns?.byBranch || [];
    for (const ib of invBranches) {
      invSheet.addRow({
        name: ib.branchName || 'Unassigned Branch',
        totalStock: ib.totalStock ?? 0,
        retailValuation: Number(ib.totalRetailValuation || 0).toFixed(2),
        lowStockCount: ib.lowStockCount ?? 0,
        reorderTriggeredCount: ib.reorderTriggeredCount ?? 0,
      });
    }
  }

  // 4. Orders Breakdown Sheet
  const ordersSheetName = sanitizeSheetName('Orders Breakdown', existingSheetNames);
  const ordersSheet = workbook.addWorksheet(ordersSheetName);
  ordersSheet.columns = [
    { header: 'Order ID', key: 'orderId', width: 28 },
    { header: 'Payment ID', key: 'paymentId', width: 28 },
    { header: 'Order Date', key: 'orderDate', width: 22 },
    { header: 'Paid At', key: 'paidAt', width: 22 },
    { header: 'Order Status', key: 'orderStatus', width: 18 },
    { header: 'Payment Method', key: 'paymentMethod', width: 16 },
    { header: 'Branch', key: 'branchName', width: 22 },
    { header: 'Customer Name', key: 'customerName', width: 20 },
    { header: 'Customer Email', key: 'customerEmail', width: 24 },
    { header: 'Customer Phone', key: 'customerPhone', width: 18 },
    { header: 'Delivery Locality', key: 'customerAddress', width: 22 },
    { header: 'Items Count', key: 'itemCount', width: 14 },
    { header: 'Order Amount (LKR)', key: 'orderAmount', width: 20 },
    { header: 'Paid Amount (LKR)', key: 'paidAmount', width: 20 },
  ];
  ordersSheet.getRow(1).font = { bold: true };
  ordersSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFEFEF' },
  };

  const mapOrderToRow = (order) => ({
    orderId: order.orderId,
    paymentId: order.paymentId,
    orderDate: order.orderDate ? new Date(order.orderDate).toISOString() : '',
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : '',
    orderStatus: order.orderStatus,
    paymentMethod: order.paymentMethod,
    branchName: order.branchName,
    customerName: order.customer?.name || 'N/A',
    customerEmail: order.customer?.email || 'N/A',
    customerPhone: order.customer?.phone || 'N/A',
    customerAddress: order.customer?.address || 'N/A',
    itemCount: order.itemCount || 0,
    orderAmount: Number(order.orderAmount || 0).toFixed(2),
    paidAmount: Number(order.paidAmount || 0).toFixed(2),
  });

  orders.forEach((o) => ordersSheet.addRow(mapOrderToRow(o)));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

/**
 * Builds an ExcelJS Workbook with separate sheets per branch for inventory items.
 *
 * @param {Object} options
 * @param {Array<Object>} options.items
 * @param {boolean} options.isOrgWide
 * @param {boolean} [options.isTruncated=false]
 * @param {string|null} [options.userRole]
 * @returns {Promise<Buffer>}
 */
async function buildInventoryExcelWorkbook({
  items,
  isOrgWide,
  isTruncated = false,
  totalMatching = 0,
  userRole = null,
}) {
  const isBranchManager = userRole === ROLE_VALUES.BRANCH_MANAGER;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OSMS Darshana Opticals';
  workbook.created = new Date();

  const existingSheetNames = new Set();

  if (isTruncated) {
    const noticeSheet = workbook.addWorksheet(sanitizeSheetName('Notice', existingSheetNames));
    noticeSheet.columns = [
      { header: 'Topic', key: 'topic', width: 30 },
      { header: 'Details', key: 'details', width: 50 },
    ];
    noticeSheet.addRow({
      topic: 'Export Truncation Notice',
      details: `Export capped at 10,000 items. Total matching in database: ${totalMatching}`,
    });
  }

  // Policy Clarification (ADR-014 §9, §11 & Finding 4):
  // Unit Price (LKR) and Quantity are operational store metrics retained in Branch Manager exports
  // for store operations and stocktaking. Precomputed executive valuation metrics ('Retail Valuation (LKR)')
  // are omitted for BRANCH_MANAGER to avoid macro balance-sheet metric exposure.
  const columns = [
    { header: 'SKU', key: 'sku', width: 20 },
    { header: 'Item Name', key: 'name', width: 30 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Quantity', key: 'quantity', width: 14 },
    { header: 'Unit Price (LKR)', key: 'unitPrice', width: 18 },
    ...(!isBranchManager
      ? [{ header: 'Retail Valuation (LKR)', key: 'retailValuation', width: 22 }]
      : []),
    { header: 'Reorder Status', key: 'reorderStatus', width: 20 },
    { header: 'Branch', key: 'branchName', width: 22 },
  ];

  const mapItemToRow = (item) => {
    const row = {
      sku: item.sku || item.id,
      name: item.name,
      category: item.category,
      brand: item.brand || '',
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice || 0).toFixed(2),
      reorderStatus: item.reorderStatus,
      branchName: item.branchName,
    };
    if (!isBranchManager) {
      row.retailValuation = Number(item.retailValuation || 0).toFixed(2);
    }
    return row;
  };

  const setupSheet = (sheetName, sheetItems) => {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    sheetItems.forEach((i) => sheet.addRow(mapItemToRow(i)));
  };

  if (isOrgWide) {
    const allBranchesName = sanitizeSheetName('All Branches', existingSheetNames);
    setupSheet(allBranchesName, items);

    const branchMap = new Map();
    for (const item of items) {
      const bName = item.branchName || 'Unassigned';
      if (!branchMap.has(bName)) {
        branchMap.set(bName, []);
      }
      branchMap.get(bName).push(item);
    }

    for (const [branchName, branchItems] of branchMap.entries()) {
      const sheetName = sanitizeSheetName(branchName, existingSheetNames);
      setupSheet(sheetName, branchItems);
    }
  } else {
    const branchName = items[0]?.branchName || 'Branch Inventory';
    const sheetName = sanitizeSheetName(branchName, existingSheetNames);
    setupSheet(sheetName, items);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

/**
 * Resolves request context and user for report scoping and audit logging.
 *
 * @param {Object} options
 * @returns {{ effectiveReq: Object, authUser: Object, correlationId: string|null }}
 */
function resolveRequestContext({ req, user, branchId }) {
  const effectiveReq = req || {
    user: user || {},
    auth: user || {},
    query: { branchId },
  };

  const authUser = user || effectiveReq.user || effectiveReq.auth || {};
  const correlationId = (req && req.headers ? req.headers['x-correlation-id'] : null) || null;

  return { effectiveReq, authUser, correlationId };
}

/**
 * Exports sales report as multi-sheet Excel (.xlsx) or RFC-4180 CSV with PII masking and audit logging.
 *
 * @param {Object} options
 * @param {string} [options.preset]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string} [options.branchId]
 * @param {string} [options.orderStatus]
 * @param {'xlsx'|'csv'} [options.format='xlsx']
 * @param {Object} [options.user]
 * @param {Object} [options.req]
 * @returns {Promise<{ filename: string, contentType: string, buffer?: Buffer, csvContent?: string, rowCount: number, isTruncated: boolean, totalMatching: number, exportedCount: number, dateRange: Object }>}
 */
async function exportSalesReport({
  preset,
  startDate,
  endDate,
  branchId,
  orderStatus,
  format = 'xlsx',
  user,
  req,
} = {}) {
  const { effectiveReq, authUser, correlationId } = resolveRequestContext({ req, user, branchId });

  // 1. Enforce RBAC & branch scope (ADR-014 §10)
  const scope = resolveReportScope(effectiveReq, 'sales');

  // 2. Fetch sales orders list, executive summary, and inventory snapshot (org-wide)
  const [result, salesReportResult, inventoryReportResult] = await Promise.all([
    getSalesOrdersList({
      preset,
      startDate,
      endDate,
      branchId: scope.branchId,
      orderStatus,
      isExport: true,
      limit: null,
      userRole: scope.role,
    }),
    getSalesReport({
      preset,
      startDate,
      endDate,
      branchId: scope.branchId,
      userRole: scope.role,
    }),
    scope.isOrgWide
      ? getInventoryReport({ branchId: null, userRole: scope.role }).catch(() => null)
      : null,
  ]);

  const orders = result?.data?.orders || [];
  const dateRange = result?.data?.dateRange || {};
  const pagination = result?.data?.pagination || {};
  const isTruncated = Boolean(pagination.isTruncated);
  const totalMatching = pagination.totalMatching || orders.length;

  const startStr = dateRange.startDate || 'start';
  const endStr = dateRange.endDate || 'end';

  let filename;
  let contentType;
  let buffer;
  let csvContent;

  if (format === 'csv') {
    const headers = [
      'Order ID',
      'Payment ID',
      'Order Date',
      'Paid At',
      'Order Status',
      'Payment Method',
      'Branch',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'Delivery Locality',
      'Items Count',
      'Order Amount (LKR)',
      'Paid Amount (LKR)',
    ];

    const rows = orders.map((order) => [
      order.orderId,
      order.paymentId,
      order.orderDate ? new Date(order.orderDate).toISOString() : '',
      order.paidAt ? new Date(order.paidAt).toISOString() : '',
      order.orderStatus,
      order.paymentMethod,
      order.branchName,
      order.customer?.name || 'N/A',
      order.customer?.email || 'N/A',
      order.customer?.phone || 'N/A',
      order.customer?.address || 'N/A',
      order.itemCount || 0,
      Number(order.orderAmount || 0).toFixed(2),
      Number(order.paidAmount || 0).toFixed(2),
    ]);

    csvContent = buildCsvString(headers, rows);
    filename = `sales-report-${startStr}-to-${endStr}.csv`;
    contentType = CSV_MIME_TYPE;
  } else {
    buffer = await buildSalesExcelWorkbook({
      orders,
      summary: salesReportResult?.data,
      inventorySnapshot: inventoryReportResult,
      isOrgWide: scope.isOrgWide,
      isTruncated,
      totalMatching,
      userRole: scope.role,
    });
    filename = `sales-report-${startStr}-to-${endStr}.xlsx`;
    contentType = EXCEL_MIME_TYPE;
  }

  // 3. Emit Audit Event (ADR-014 §14.2)
  const actor = auditService.buildUserActor({
    userId: authUser.userId || authUser.id || authUser._id,
    role: authUser.role,
  });

  await auditService.record({
    action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
    actor,
    target: {
      targetType: AUDIT_TARGET_TYPE.REPORT,
      targetId: 'SALES_REPORT',
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    correlationId,
    metadata: {
      reportType: 'sales',
      format,
      filters: {
        preset: dateRange.preset || null,
        startDate: dateRange.startDate || null,
        endDate: dateRange.endDate || null,
        branchId: scope.branchId ? String(scope.branchId) : null,
        orderStatus: orderStatus || null,
      },
      rowCount: orders.length,
      isTruncated,
      totalMatching,
      generatedAt: new Date().toISOString(),
    },
  });

  return {
    filename,
    contentType,
    buffer,
    csvContent,
    rowCount: orders.length,
    isTruncated,
    totalMatching,
    exportedCount: orders.length,
    dateRange,
  };
}

/**
 * Backward-compatible helper for CSV exports.
 */
async function exportSalesReportCsv(options = {}) {
  return exportSalesReport({ ...options, format: 'csv' });
}

/**
 * Exports current inventory report as multi-sheet Excel (.xlsx) or RFC-4180 CSV with audit logging.
 *
 * @param {Object} options
 * @param {string} [options.branchId]
 * @param {string} [options.category]
 * @param {string} [options.reorderStatus]
 * @param {'xlsx'|'csv'} [options.format='xlsx']
 * @param {Object} [options.user]
 * @param {Object} [options.req]
 * @returns {Promise<{ filename: string, contentType: string, buffer?: Buffer, csvContent?: string, rowCount: number, isTruncated: boolean, totalMatching: number, exportedCount: number }>}
 */
async function exportInventoryReport({
  branchId,
  category,
  reorderStatus,
  format = 'xlsx',
  user,
  req,
} = {}) {
  const { effectiveReq, authUser, correlationId } = resolveRequestContext({ req, user, branchId });

  // 1. Enforce RBAC & branch scope (ADR-014 §10)
  const scope = resolveReportScope(effectiveReq, 'inventory');

  // 2. Fetch inventory items (unbounded complete export)
  const isBranchManager = scope.role === ROLE_VALUES.BRANCH_MANAGER;
  const result = await getInventoryItemsList({
    branchId: scope.branchId,
    category,
    reorderStatus,
    isExport: true,
    limit: null,
    userRole: scope.role,
  });

  const items = result?.data?.items || [];
  const pagination = result?.data?.pagination || {};
  const isTruncated = Boolean(pagination.isTruncated);
  const totalMatching = pagination.totalMatching || items.length;

  const todayStr = new Date().toISOString().slice(0, 10);

  let filename;
  let contentType;
  let buffer;
  let csvContent;

  if (format === 'csv') {
    const headers = [
      'SKU',
      'Item Name',
      'Category',
      'Brand',
      'Quantity',
      'Unit Price (LKR)',
      ...(!isBranchManager ? ['Retail Valuation (LKR)'] : []),
      'Reorder Status',
      'Branch',
    ];

    const rows = items.map((item) => {
      const row = [
        item.sku || item.id,
        item.name,
        item.category,
        item.brand || '',
        item.quantity,
        Number(item.unitPrice || 0).toFixed(2),
      ];
      if (!isBranchManager) {
        row.push(Number(item.retailValuation || 0).toFixed(2));
      }
      row.push(item.reorderStatus);
      row.push(item.branchName);
      return row;
    });

    csvContent = buildCsvString(headers, rows);
    filename = `inventory-report-${todayStr}.csv`;
    contentType = CSV_MIME_TYPE;
  } else {
    buffer = await buildInventoryExcelWorkbook({
      items,
      isOrgWide: scope.isOrgWide,
      isTruncated,
      totalMatching,
      userRole: scope.role,
    });
    filename = `inventory-report-${todayStr}.xlsx`;
    contentType = EXCEL_MIME_TYPE;
  }

  // 3. Emit Audit Event (ADR-014 §14.2)
  const actor = auditService.buildUserActor({
    userId: authUser.userId || authUser.id || authUser._id,
    role: authUser.role,
  });

  await auditService.record({
    action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
    actor,
    target: {
      targetType: AUDIT_TARGET_TYPE.REPORT,
      targetId: 'INVENTORY_REPORT',
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    correlationId,
    metadata: {
      reportType: 'inventory',
      format,
      filters: {
        branchId: scope.branchId ? String(scope.branchId) : null,
        category: category || null,
        reorderStatus: reorderStatus || null,
      },
      rowCount: items.length,
      isTruncated,
      totalMatching,
      generatedAt: new Date().toISOString(),
    },
  });

  return {
    filename,
    contentType,
    buffer,
    csvContent,
    rowCount: items.length,
    isTruncated,
    totalMatching,
    exportedCount: items.length,
  };
}

/**
 * Backward-compatible helper for CSV exports.
 */
async function exportInventoryReportCsv(options = {}) {
  return exportInventoryReport({ ...options, format: 'csv' });
}

module.exports = {
  escapeCsvCell,
  buildCsvString,
  sanitizeSheetName,
  buildSalesExcelWorkbook,
  buildInventoryExcelWorkbook,
  exportSalesReport,
  exportSalesReportCsv,
  exportInventoryReport,
  exportInventoryReportCsv,
};
