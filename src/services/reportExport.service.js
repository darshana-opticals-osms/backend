const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../constants/audit');
const { resolveReportScope } = require('../utils/reportScope');
const { getSalesOrdersList } = require('./reportSales.service');
const { getInventoryItemsList } = require('./reportInventory.service');
const auditService = require('./audit.service');

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
 * Exports sales report as RFC-4180 CSV with PII masking and audit logging.
 *
 * @param {Object} options
 * @param {string} [options.preset]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string} [options.branchId]
 * @param {string} [options.orderStatus]
 * @param {Object} [options.user]
 * @param {Object} [options.req]
 * @returns {Promise<{ filename: string, csvContent: string, rowCount: number, dateRange: Object }>}
 */
async function exportSalesReportCsv({
  preset,
  startDate,
  endDate,
  branchId,
  orderStatus,
  user,
  req,
} = {}) {
  const { effectiveReq, authUser, correlationId } = resolveRequestContext({ req, user, branchId });

  // 1. Enforce RBAC & branch scope (ADR-014 §10)
  const scope = resolveReportScope(effectiveReq, 'sales');

  // 2. Fetch sales orders list (with unpaginated export limit up to 10,000)
  const result = await getSalesOrdersList({
    preset,
    startDate,
    endDate,
    branchId: scope.branchId,
    orderStatus,
    isExport: true,
  });

  const orders = result?.data?.orders || [];
  const dateRange = result?.data?.dateRange || {};

  // 3. Format CSV rows (PII masked, zero clinical data per ADR-014 §11)
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

  const csvContent = buildCsvString(headers, rows);
  const startStr = dateRange.startDate || 'start';
  const endStr = dateRange.endDate || 'end';
  const filename = `sales-report-${startStr}-to-${endStr}.csv`;

  // 4. Emit Audit Event (ADR-014 §14.2)
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
      filters: {
        preset: dateRange.preset || null,
        startDate: dateRange.startDate || null,
        endDate: dateRange.endDate || null,
        branchId: scope.branchId ? String(scope.branchId) : null,
        orderStatus: orderStatus || null,
      },
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    },
  });

  return {
    filename,
    csvContent,
    rowCount: rows.length,
    dateRange,
  };
}

/**
 * Exports current inventory report as RFC-4180 CSV with audit logging.
 *
 * @param {Object} options
 * @param {string} [options.branchId]
 * @param {string} [options.category]
 * @param {string} [options.reorderStatus]
 * @param {Object} [options.user]
 * @param {Object} [options.req]
 * @returns {Promise<{ filename: string, csvContent: string, rowCount: number }>}
 */
async function exportInventoryReportCsv({
  branchId,
  category,
  reorderStatus,
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

  // 3. Format CSV rows (RFC-4180)
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

  const csvContent = buildCsvString(headers, rows);
  const todayStr = new Date().toISOString().slice(0, 10);
  const filename = `inventory-report-${todayStr}.csv`;

  // 4. Emit Audit Event (ADR-014 §14.2)
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
      filters: {
        branchId: scope.branchId ? String(scope.branchId) : null,
        category: category || null,
        reorderStatus: reorderStatus || null,
      },
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    },
  });

  return {
    filename,
    csvContent,
    rowCount: rows.length,
  };
}

module.exports = {
  escapeCsvCell,
  buildCsvString,
  exportSalesReportCsv,
  exportInventoryReportCsv,
};
