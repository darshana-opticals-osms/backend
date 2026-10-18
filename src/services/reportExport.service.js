const ExcelJS = require('exceljs');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../constants/audit');
const { resolveReportScope } = require('../utils/reportScope');
const { getSalesOrdersList, getSalesReport } = require('./reportSales.service');
const { getInventoryItemsList } = require('./reportInventory.service');
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
 * Builds an ExcelJS Workbook with Executive Summary sheet and breakdown sheets per branch.
 *
 * Review Comment 6 – Reconciles Excel workbook structure with ADR-014's approved
 * executive summary and breakdown requirements. Also includes truncation notices
 * to avoid silently omitting records beyond 10,000.
 *
 * @param {Object} options
 * @param {Array<Object>} options.orders
 * @param {Object} [options.summary]
 * @param {boolean} options.isOrgWide
 * @param {boolean} [options.isTruncated=false]
 * @param {number} [options.totalMatching=0]
 * @returns {Promise<Buffer>}
 */
async function buildSalesExcelWorkbook({
  orders,
  summary = null,
  isOrgWide,
  isTruncated = false,
  totalMatching = 0,
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OSMS Darshana Opticals';
  workbook.created = new Date();

  const existingSheetNames = new Set();

  // 1. Executive Summary Sheet (ADR-014 §11 requirement, Review Comment 6)
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

  if (summary) {
    summarySheet.addRow({
      metric: 'Recognized Gross Revenue (LKR)',
      value: Number(summary.grossRevenue || 0).toFixed(2),
      refId: 'SM-01',
    });
    summarySheet.addRow({
      metric: 'Refund Deductions (LKR)',
      value: Number(summary.refundDeductions || 0).toFixed(2),
      refId: 'SM-02',
    });
    summarySheet.addRow({
      metric: 'Recognized Net Revenue (LKR)',
      value: Number(summary.netRevenue || 0).toFixed(2),
      refId: 'SM-03',
    });
    summarySheet.addRow({
      metric: 'Total Qualifying Orders',
      value: summary.totalOrders ?? 0,
      refId: 'SM-04',
    });
    summarySheet.addRow({
      metric: 'Average Order Value (LKR)',
      value: Number(summary.averageOrderValue || 0).toFixed(2),
      refId: 'SM-05',
    });
    summarySheet.addRow({
      metric: 'Items Sold Quantity',
      value: summary.itemsSold ?? 0,
      refId: 'SM-06',
    });
    summarySheet.addRow({
      metric: 'Cancelled Orders Count',
      value: summary.cancelledOrdersCount ?? 0,
      refId: 'SM-10',
    });
    summarySheet.addRow({
      metric: 'Cancelled Orders Value (LKR)',
      value: Number(summary.cancelledOrdersValue || 0).toFixed(2),
      refId: 'SM-10',
    });
  }

  if (isTruncated) {
    summarySheet.addRow({
      metric: 'Export Row Limit Notice',
      value: `Export capped at 10,000 rows. Total matching in database: ${totalMatching}`,
      refId: 'NOTICE (TRUNCATED)',
    });
  }

  // 2. Data Columns for Detailed Orders Sheets
  const orderColumns = [
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

  const setupSheet = (sheetName, sheetOrders) => {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = orderColumns;
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFEFEF' },
    };
    sheetOrders.forEach((o) => sheet.addRow(mapOrderToRow(o)));
  };

  if (isOrgWide) {
    // All Branches Sheet
    const allBranchesName = sanitizeSheetName('All Branches', existingSheetNames);
    setupSheet(allBranchesName, orders);

    // Distinct branch sheets
    const branchMap = new Map();
    for (const order of orders) {
      const bName = order.branchName || 'Unassigned';
      if (!branchMap.has(bName)) {
        branchMap.set(bName, []);
      }
      branchMap.get(bName).push(order);
    }

    for (const [branchName, branchOrders] of branchMap.entries()) {
      const sheetName = sanitizeSheetName(branchName, existingSheetNames);
      setupSheet(sheetName, branchOrders);
    }
  } else {
    // Single branch scope
    const branchName = orders[0]?.branchName || 'Branch Report';
    const sheetName = sanitizeSheetName(branchName, existingSheetNames);
    setupSheet(sheetName, orders);
  }

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
 * @param {number} [options.totalMatching=0]
 * @returns {Promise<Buffer>}
 */
async function buildInventoryExcelWorkbook({
  items,
  isOrgWide,
  isTruncated = false,
  totalMatching = 0,
}) {
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

  const columns = [
    { header: 'SKU', key: 'sku', width: 20 },
    { header: 'Item Name', key: 'name', width: 30 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Quantity', key: 'quantity', width: 14 },
    { header: 'Unit Price (LKR)', key: 'unitPrice', width: 18 },
    { header: 'Retail Valuation (LKR)', key: 'retailValuation', width: 22 },
    { header: 'Reorder Status', key: 'reorderStatus', width: 20 },
    { header: 'Branch', key: 'branchName', width: 22 },
  ];

  const mapItemToRow = (item) => ({
    sku: item.sku || item.id,
    name: item.name,
    category: item.category,
    brand: item.brand || '',
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice || 0).toFixed(2),
    retailValuation: Number(item.retailValuation || 0).toFixed(2),
    reorderStatus: item.reorderStatus,
    branchName: item.branchName,
  });

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

  // 2. Fetch sales orders list and executive summary
  const [result, salesReportResult] = await Promise.all([
    getSalesOrdersList({
      preset,
      startDate,
      endDate,
      branchId: scope.branchId,
      orderStatus,
      isExport: true,
    }),
    getSalesReport({
      preset,
      startDate,
      endDate,
      branchId: scope.branchId,
    }),
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
      summary: salesReportResult?.data?.summary,
      isOrgWide: scope.isOrgWide,
      isTruncated,
      totalMatching,
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

  // 2. Fetch inventory items (with unpaginated export limit up to 10,000)
  const result = await getInventoryItemsList({
    branchId: scope.branchId,
    category,
    reorderStatus,
    isExport: true,
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
      'Retail Valuation (LKR)',
      'Reorder Status',
      'Branch',
    ];

    const rows = items.map((item) => [
      item.sku || item.id,
      item.name,
      item.category,
      item.brand || '',
      item.quantity,
      Number(item.unitPrice || 0).toFixed(2),
      Number(item.retailValuation || 0).toFixed(2),
      item.reorderStatus,
      item.branchName,
    ]);

    csvContent = buildCsvString(headers, rows);
    filename = `inventory-report-${todayStr}.csv`;
    contentType = CSV_MIME_TYPE;
  } else {
    buffer = await buildInventoryExcelWorkbook({
      items,
      isOrgWide: scope.isOrgWide,
      isTruncated,
      totalMatching,
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
