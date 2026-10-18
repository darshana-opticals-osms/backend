const mongoose = require('mongoose');
const {
  DATE_PRESET_VALUES,
  MAX_CUSTOM_DATE_RANGE_DAYS,
  GROUP_BY_VALUES,
  ALLOWED_SALES_SORT_FIELDS,
  ALLOWED_INVENTORY_SORT_FIELDS,
  SORT_DIRECTIONS,
} = require('../constants/report.constants');
const { isValidIsoDateString } = require('../utils/reportDates');

const isObjectId = (value) =>
  typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value) && mongoose.isValidObjectId(value);

const ALLOWED_SALES_REPORT_FIELDS = Object.freeze([
  'preset',
  'startDate',
  'endDate',
  'branchId',
  'groupBy',
]);

const ALLOWED_SALES_ORDERS_FIELDS = Object.freeze([
  'preset',
  'startDate',
  'endDate',
  'branchId',
  'page',
  'limit',
  'sortBy',
  'sortOrder',
  'orderStatus',
]);

const ALLOWED_INVENTORY_REPORT_FIELDS = Object.freeze([
  'branchId',
  'category',
  'reorderStatus',
  'groupBy',
]);

const ALLOWED_INVENTORY_ITEMS_FIELDS = Object.freeze([
  'branchId',
  'category',
  'reorderStatus',
  'page',
  'limit',
  'sortBy',
  'sortOrder',
]);

const ALLOWED_EXPORT_SALES_FIELDS = Object.freeze([
  'preset',
  'startDate',
  'endDate',
  'branchId',
  'format',
]);

const ALLOWED_EXPORT_INVENTORY_FIELDS = Object.freeze([
  'branchId',
  'category',
  'reorderStatus',
  'format',
]);

function validatePaginationField(field, value, max) {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length > 5 ||
    !/^[1-9]\d*$/.test(value) ||
    Number(value) > max
  ) {
    return { field, message: `${field} must be an integer from 1 to ${max}.` };
  }
  return null;
}

function validateDateFilters(query) {
  const errors = [];
  const { preset, startDate, endDate } = query;

  if (preset !== undefined) {
    if (typeof preset !== 'string' || !DATE_PRESET_VALUES.includes(preset)) {
      errors.push({
        field: 'preset',
        message: `preset must be one of: ${DATE_PRESET_VALUES.join(', ')}.`,
      });
    }
  }

  if (startDate !== undefined || endDate !== undefined) {
    if (!startDate || !endDate) {
      errors.push({
        field: 'dateRange',
        message: 'Both startDate and endDate must be provided together.',
      });
    } else {
      const validStart = isValidIsoDateString(startDate);
      const validEnd = isValidIsoDateString(endDate);

      if (!validStart) {
        errors.push({
          field: 'startDate',
          message: 'startDate must be a valid ISO 8601 date string (YYYY-MM-DD).',
        });
      }
      if (!validEnd) {
        errors.push({
          field: 'endDate',
          message: 'endDate must be a valid ISO 8601 date string (YYYY-MM-DD).',
        });
      }

      if (validStart && validEnd) {
        if (startDate > endDate) {
          errors.push({
            field: 'startDate',
            message: 'startDate must be before or equal to endDate.',
          });
        } else {
          const diffMs = new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`);
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays > MAX_CUSTOM_DATE_RANGE_DAYS) {
            errors.push({
              field: 'dateRange',
              message: `Custom date range must not exceed ${MAX_CUSTOM_DATE_RANGE_DAYS} days.`,
            });
          }
        }
      }
    }
  }

  return errors;
}

function validateBranchId(branchId) {
  if (branchId === undefined || branchId === 'ALL') return null;
  if (!isObjectId(branchId)) {
    return { field: 'branchId', message: 'branchId must be a valid 24-character hexadecimal ObjectId or "ALL".' };
  }
  return null;
}

function validateNoRequestBody(body) {
  const errors = [];
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    errors.push({ field: 'body', message: 'This read-only endpoint does not accept request body fields.' });
  }
  return errors;
}

/**
 * Validates GET /reports/sales query
 */
function validateSalesReportQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_SALES_REPORT_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported sales report query parameter: ${field}.` });
    }
  }

  errors.push(...validateDateFilters(query));

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  if (query.groupBy !== undefined) {
    if (!GROUP_BY_VALUES.includes(query.groupBy)) {
      errors.push({
        field: 'groupBy',
        message: `groupBy must be one of: ${GROUP_BY_VALUES.join(', ')}.`,
      });
    }
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

/**
 * Validates GET /reports/sales/orders query
 */
function validateSalesOrdersQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_SALES_ORDERS_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported sales orders query parameter: ${field}.` });
    }
  }

  errors.push(...validateDateFilters(query));

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  const pageErr = validatePaginationField('page', query.page, 10000);
  if (pageErr) errors.push(pageErr);

  const limitErr = validatePaginationField('limit', query.limit, 100);
  if (limitErr) errors.push(limitErr);

  if (query.sortBy !== undefined && !ALLOWED_SALES_SORT_FIELDS.includes(query.sortBy)) {
    errors.push({
      field: 'sortBy',
      message: `sortBy must be one of: ${ALLOWED_SALES_SORT_FIELDS.join(', ')}.`,
    });
  }

  if (query.sortOrder !== undefined && !SORT_DIRECTIONS.includes(query.sortOrder)) {
    errors.push({
      field: 'sortOrder',
      message: `sortOrder must be one of: ${SORT_DIRECTIONS.join(', ')}.`,
    });
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

/**
 * Validates GET /reports/inventory query
 */
function validateInventoryReportQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_INVENTORY_REPORT_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported inventory report query parameter: ${field}.` });
    }
  }

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  if (query.groupBy !== undefined && !['branch', 'category'].includes(query.groupBy)) {
    errors.push({
      field: 'groupBy',
      message: 'groupBy must be one of: branch, category.',
    });
  }

  if (query.reorderStatus !== undefined) {
    if (!['OK', 'LOW_STOCK', 'REORDER_TRIGGERED'].includes(query.reorderStatus)) {
      errors.push({
        field: 'reorderStatus',
        message: 'reorderStatus must be one of: OK, LOW_STOCK, REORDER_TRIGGERED.',
      });
    }
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

/**
 * Validates GET /reports/inventory/items query
 */
function validateInventoryItemsQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_INVENTORY_ITEMS_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported inventory items query parameter: ${field}.` });
    }
  }

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  const pageErr = validatePaginationField('page', query.page, 10000);
  if (pageErr) errors.push(pageErr);

  const limitErr = validatePaginationField('limit', query.limit, 100);
  if (limitErr) errors.push(limitErr);

  if (query.sortBy !== undefined && !ALLOWED_INVENTORY_SORT_FIELDS.includes(query.sortBy)) {
    errors.push({
      field: 'sortBy',
      message: `sortBy must be one of: ${ALLOWED_INVENTORY_SORT_FIELDS.join(', ')}.`,
    });
  }

  if (query.sortOrder !== undefined && !SORT_DIRECTIONS.includes(query.sortOrder)) {
    errors.push({
      field: 'sortOrder',
      message: `sortOrder must be one of: ${SORT_DIRECTIONS.join(', ')}.`,
    });
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

/**
 * Validates GET /reports/sales/export query
 */
function validateSalesExportQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_EXPORT_SALES_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported export query parameter: ${field}.` });
    }
  }

  errors.push(...validateDateFilters(query));

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  if (query.format !== undefined && !['csv', 'xlsx'].includes(query.format)) {
    errors.push({ field: 'format', message: 'format must be one of: csv, xlsx.' });
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

/**
 * Validates GET /reports/inventory/export query
 */
function validateInventoryExportQuery(req) {
  const query = req.query || {};
  const errors = [];

  for (const field of Object.keys(query)) {
    if (!ALLOWED_EXPORT_INVENTORY_FIELDS.includes(field)) {
      errors.push({ field, message: `Unsupported export query parameter: ${field}.` });
    }
  }

  const branchErr = validateBranchId(query.branchId);
  if (branchErr) errors.push(branchErr);

  if (query.format !== undefined && !['csv', 'xlsx'].includes(query.format)) {
    errors.push({ field: 'format', message: 'format must be one of: csv, xlsx.' });
  }

  errors.push(...validateNoRequestBody(req.body));
  return errors;
}

module.exports = {
  validateSalesReportQuery,
  validateSalesOrdersQuery,
  validateInventoryReportQuery,
  validateInventoryItemsQuery,
  validateSalesExportQuery,
  validateInventoryExportQuery,
};
