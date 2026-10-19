const catchAsync = require('../utils/catchAsync');
const { resolveReportScope } = require('../utils/reportScope');
const reportSalesService = require('../services/reportSales.service');
const reportInventoryService = require('../services/reportInventory.service');
const reportExportService = require('../services/reportExport.service');

/**
 * GET /api/reports/sales
 * Retrieves sales metrics summary and breakdown according to ADR-014.
 */
const getSalesReport = catchAsync(async (req, res) => {
  const scope = resolveReportScope(req, 'sales');
  const { preset, startDate, endDate, groupBy } = req.query;

  const result = await reportSalesService.getSalesReport({
    preset,
    startDate,
    endDate,
    branchId: scope.branchId,
    groupBy,
    userRole: scope.role,
  });

  return res.status(200).json(result);
});

/**
 * GET /api/reports/sales/orders
 * Retrieves paginated sales order records with masked PII and zero clinical fields.
 */
const getSalesOrders = catchAsync(async (req, res) => {
  const scope = resolveReportScope(req, 'sales');
  const { preset, startDate, endDate, page, limit, sortBy, sortOrder, orderStatus } = req.query;

  const result = await reportSalesService.getSalesOrdersList({
    preset,
    startDate,
    endDate,
    branchId: scope.branchId,
    page,
    limit,
    sortBy,
    sortOrder,
    orderStatus,
    userRole: scope.role,
  });

  return res.status(200).json(result);
});

/**
 * GET /api/reports/sales/export
 * Generates and downloads RFC-4180 CSV export of qualifying sales orders with audit logging.
 */
const exportSalesReport = catchAsync(async (req, res) => {
  const { preset, startDate, endDate, branchId, orderStatus, format = 'xlsx' } = req.query;

  const result = await reportExportService.exportSalesReport({
    preset,
    startDate,
    endDate,
    branchId,
    orderStatus,
    format,
    user: req.auth || req.user,
    req,
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('X-Report-Truncated', result.isTruncated ? 'true' : 'false');
  res.setHeader('X-Report-Total-Count', String(result.totalMatching || result.rowCount));
  res.setHeader('X-Report-Exported-Count', String(result.exportedCount || result.rowCount));
  return res.status(200).send(result.buffer || result.csvContent);
});

/**
 * GET /api/reports/inventory
 * Retrieves current inventory snapshot metrics and breakdowns according to ADR-014.
 */
const getInventoryReport = catchAsync(async (req, res) => {
  const scope = resolveReportScope(req, 'inventory');
  const { category, reorderStatus, groupBy } = req.query;

  const result = await reportInventoryService.getInventoryReport({
    branchId: scope.branchId,
    category,
    reorderStatus,
    groupBy,
    userRole: scope.role,
  });

  return res.status(200).json(result);
});

/**
 * GET /api/reports/inventory/items
 * Retrieves paginated current inventory stock records with live reorder states.
 */
const getInventoryItems = catchAsync(async (req, res) => {
  const scope = resolveReportScope(req, 'inventory');
  const { category, reorderStatus, page, limit, sortBy, sortOrder } = req.query;

  const result = await reportInventoryService.getInventoryItemsList({
    branchId: scope.branchId,
    category,
    reorderStatus,
    page,
    limit,
    sortBy,
    sortOrder,
    userRole: scope.role,
  });

  return res.status(200).json(result);
});

/**
 * GET /api/reports/inventory/export
 * Generates and downloads multi-sheet Excel (.xlsx) or RFC-4180 CSV export of current stock items with audit logging.
 */
const exportInventoryReport = catchAsync(async (req, res) => {
  const { branchId, category, reorderStatus, format = 'xlsx' } = req.query;

  const result = await reportExportService.exportInventoryReport({
    branchId,
    category,
    reorderStatus,
    format,
    user: req.auth || req.user,
    req,
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('X-Report-Truncated', result.isTruncated ? 'true' : 'false');
  res.setHeader('X-Report-Total-Count', String(result.totalMatching || result.rowCount));
  res.setHeader('X-Report-Exported-Count', String(result.exportedCount || result.rowCount));
  return res.status(200).send(result.buffer || result.csvContent);
});

module.exports = {
  getSalesReport,
  getSalesOrders,
  exportSalesReport,
  getInventoryReport,
  getInventoryItems,
  exportInventoryReport,
};
