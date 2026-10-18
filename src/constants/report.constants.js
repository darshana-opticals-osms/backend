const { ROLE_VALUES } = require('./roles');

const REPORT_METRIC_IDS = Object.freeze({
  SM_01: 'SM-01', // Recognized Gross Revenue
  SM_02: 'SM-02', // Refund Deductions
  SM_03: 'SM-03', // Recognized Net Revenue
  SM_04: 'SM-04', // Total Qualifying Orders Count
  SM_05: 'SM-05', // Average Order Value
  SM_06: 'SM-06', // Items Sold Quantity
  SM_07: 'SM-07', // Sales by Branch
  SM_08: 'SM-08', // Sales by Product Category
  SM_09: 'SM-09', // Payment Method Distribution
  SM_10: 'SM-10', // Cancelled Orders
  IM_01: 'IM-01', // Total Stock on Hand
  IM_02: 'IM-02', // Stock Quantity by Branch
  IM_03: 'IM-03', // Stock by Product Category
  IM_04: 'IM-04', // Low-Stock Items Count
  IM_05: 'IM-05', // Reorder-Triggered Items Count
  IM_06: 'IM-06', // Total Retail Inventory Valuation
});

const REPORTING_TIMEZONE = 'Asia/Colombo';
const REPORTING_CURRENCY = 'LKR';

const DATE_PRESETS = Object.freeze({
  TODAY: 'today',
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  THIS_MONTH: 'this_month',
  CUSTOM: 'custom',
});

const DATE_PRESET_VALUES = Object.freeze(Object.values(DATE_PRESETS));

const MAX_CUSTOM_DATE_RANGE_DAYS = 365;

const GROUP_BY_OPTIONS = Object.freeze({
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  BRANCH: 'branch',
  CATEGORY: 'category',
});

const GROUP_BY_VALUES = Object.freeze(Object.values(GROUP_BY_OPTIONS));

const TIME_SERIES_GROUP_VALUES = Object.freeze([
  GROUP_BY_OPTIONS.DAY,
  GROUP_BY_OPTIONS.WEEK,
  GROUP_BY_OPTIONS.MONTH,
]);

const ALLOWED_SALES_SORT_FIELDS = Object.freeze([
  'paidAt',
  'createdAt',
  'totalAmount',
  'quantity',
]);

const ALLOWED_INVENTORY_SORT_FIELDS = Object.freeze([
  'quantity',
  'unitPrice',
  'name',
  'category',
  'sku',
]);

const SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);

const PAGINATION_LIMITS = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
});

const SALES_VIEW_ROLES = Object.freeze([
  ROLE_VALUES.MANAGEMENT,
  ROLE_VALUES.SYSTEM_ADMIN,
  ROLE_VALUES.BRANCH_MANAGER,
]);

const INVENTORY_VIEW_ROLES = Object.freeze([
  ROLE_VALUES.MANAGEMENT,
  ROLE_VALUES.INVENTORY_MANAGER,
  ROLE_VALUES.SYSTEM_ADMIN,
  ROLE_VALUES.BRANCH_MANAGER,
]);

const EXPORT_SALES_ROLES = Object.freeze([
  ROLE_VALUES.MANAGEMENT,
  ROLE_VALUES.SYSTEM_ADMIN,
  ROLE_VALUES.BRANCH_MANAGER,
]);

const EXPORT_INVENTORY_ROLES = Object.freeze([
  ROLE_VALUES.MANAGEMENT,
  ROLE_VALUES.INVENTORY_MANAGER,
  ROLE_VALUES.SYSTEM_ADMIN,
  ROLE_VALUES.BRANCH_MANAGER,
]);

const QUALIFYING_ORDER_STATUSES = Object.freeze([
  'PROCESSING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'COMPLETED',
]);

const CANCELLED_ORDER_STATUS = 'CANCELLED';

const { PAYMENT_STATUS } = require('./payment');

const QUALIFYING_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.COMPLETED,
  'COMPLETED',
]);

const EXCLUDED_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.PENDING,
  'FAILED',
  'PENDING',
]);

const REFUNDED_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.REFUNDED,
  'REFUNDED',
]);

const QUALIFYING_PAYMENT_STATUS = PAYMENT_STATUS.COMPLETED;
const REFUNDED_PAYMENT_STATUS = PAYMENT_STATUS.REFUNDED;

const REPORT_EXPORT_AUDIT_ACTION = 'REPORT_EXPORT_GENERATED';

module.exports = {
  REPORT_METRIC_IDS,
  REPORTING_TIMEZONE,
  REPORTING_CURRENCY,
  DATE_PRESETS,
  DATE_PRESET_VALUES,
  MAX_CUSTOM_DATE_RANGE_DAYS,
  GROUP_BY_OPTIONS,
  GROUP_BY_VALUES,
  TIME_SERIES_GROUP_VALUES,
  ALLOWED_SALES_SORT_FIELDS,
  ALLOWED_INVENTORY_SORT_FIELDS,
  SORT_DIRECTIONS,
  PAGINATION_LIMITS,
  SALES_VIEW_ROLES,
  INVENTORY_VIEW_ROLES,
  EXPORT_SALES_ROLES,
  EXPORT_INVENTORY_ROLES,
  QUALIFYING_ORDER_STATUSES,
  CANCELLED_ORDER_STATUS,
  QUALIFYING_PAYMENT_STATUS,
  QUALIFYING_PAYMENT_STATUSES,
  EXCLUDED_PAYMENT_STATUSES,
  REFUNDED_PAYMENT_STATUS,
  REFUNDED_PAYMENT_STATUSES,
  REPORT_EXPORT_AUDIT_ACTION,
};
