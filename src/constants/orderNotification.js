const { ORDER_STATUS_VALUES } = require('./orderStatuses');

/**
 * Supported notification delivery channels (ADR-013, Section 7).
 * Transactional Email via AWS SES is the authoritative channel for Sprint 2.
 */
const NOTIFICATION_CHANNELS = Object.freeze({
  EMAIL: 'EMAIL',
});

const NOTIFICATION_CHANNEL_VALUES = Object.freeze(Object.values(NOTIFICATION_CHANNELS));

/**
 * Authoritative notification providers (ADR-013, Section 7.2).
 */
const NOTIFICATION_PROVIDERS = Object.freeze({
  AWS_SES: 'AWS_SES',
});

const NOTIFICATION_PROVIDER_VALUES = Object.freeze(Object.values(NOTIFICATION_PROVIDERS));

/**
 * Delivery status states for order notification records (ADR-013, Section 11.1).
 */
const DELIVERY_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

const DELIVERY_STATUS_VALUES = Object.freeze(Object.values(DELIVERY_STATUS));

/**
 * Standard notification error codes (ADR-013, Section 11.1, Section 12).
 */
const NOTIFICATION_ERROR_CODES = Object.freeze({
  MISSING_RECIPIENT_EMAIL: 'MISSING_RECIPIENT_EMAIL',
  SES_BOUNCE: 'SES_BOUNCE',
  INVALID_EMAIL: 'INVALID_EMAIL',
  SMTP_UNCONFIGURED: 'SMTP_UNCONFIGURED',
  TRANSPORT_ERROR: 'TRANSPORT_ERROR',
  THROTTLING: 'THROTTLING',
});

/**
 * Canonical customer notification milestones (ADR-013, Section 5.1).
 */
const ORDER_NOTIFICATION_MILESTONES = Object.freeze({
  MILESTONE_1_CONFIRMATION: 'MILESTONE_1_CONFIRMATION',
  MILESTONE_2_DISPATCHED: 'MILESTONE_2_DISPATCHED',
  MILESTONE_3_FULFILLED: 'MILESTONE_3_FULFILLED',
  MILESTONE_4_CANCELLED_UNPAID: 'MILESTONE_4_CANCELLED_UNPAID',
  MILESTONE_5_CANCELLED_PAID: 'MILESTONE_5_CANCELLED_PAID',
});

/**
 * Authoritative Status-Transition Notification Matrix (ADR-013, Section 5.1).
 * Maps [sourceStatus][targetStatus] to the corresponding notification milestone, or null if not notifiable.
 */
const NOTIFICATION_TRIGGER_MATRIX = Object.freeze({
  [ORDER_STATUS_VALUES.ORDER_CREATED]: Object.freeze({
    [ORDER_STATUS_VALUES.PROCESSING]: ORDER_NOTIFICATION_MILESTONES.MILESTONE_1_CONFIRMATION,
    [ORDER_STATUS_VALUES.CANCELLED]: ORDER_NOTIFICATION_MILESTONES.MILESTONE_4_CANCELLED_UNPAID,
  }),
  [ORDER_STATUS_VALUES.PROCESSING]: Object.freeze({
    [ORDER_STATUS_VALUES.READY_FOR_PICKUP]: null, // Internal packaging/workshop stage - NO customer notification
    [ORDER_STATUS_VALUES.CANCELLED]: ORDER_NOTIFICATION_MILESTONES.MILESTONE_5_CANCELLED_PAID,
  }),
  [ORDER_STATUS_VALUES.READY_FOR_PICKUP]: Object.freeze({
    [ORDER_STATUS_VALUES.PICKED_UP]: ORDER_NOTIFICATION_MILESTONES.MILESTONE_2_DISPATCHED,
  }),
  [ORDER_STATUS_VALUES.PICKED_UP]: Object.freeze({
    [ORDER_STATUS_VALUES.COMPLETED]: ORDER_NOTIFICATION_MILESTONES.MILESTONE_3_FULFILLED,
  }),
  [ORDER_STATUS_VALUES.COMPLETED]: Object.freeze({}),
  [ORDER_STATUS_VALUES.CANCELLED]: Object.freeze({}),
});

/**
 * Determines whether a given status transition is notification-worthy under ADR-013 §5.1.
 *
 * @param {string} sourceStatus
 * @param {string} targetStatus
 * @returns {boolean}
 */
function isNotifiableStatusTransition(sourceStatus, targetStatus) {
  if (!sourceStatus || !targetStatus) return false;
  const sourceRow = NOTIFICATION_TRIGGER_MATRIX[sourceStatus];
  if (!sourceRow) return false;
  return Boolean(sourceRow[targetStatus]);
}

/**
 * Resolves the notification milestone for a transition under ADR-013 §5.1.
 * Returns null if the transition does not warrant a customer notification.
 *
 * @param {string} sourceStatus
 * @param {string} targetStatus
 * @returns {string|null}
 */
function getNotificationMilestone(sourceStatus, targetStatus) {
  if (!sourceStatus || !targetStatus) return null;
  const sourceRow = NOTIFICATION_TRIGGER_MATRIX[sourceStatus];
  if (!sourceRow) return null;
  return sourceRow[targetStatus] || null;
}

/**
 * Computes deterministic idempotency key for an order notification (ADR-013, Section 10.1).
 * Format: ORDER_NOTIF_{orderId}_{targetStatus}
 *
 * @param {string|import('mongoose').Types.ObjectId} orderId
 * @param {string} targetStatus
 * @returns {string}
 */
function generateNotificationIdempotencyKey(orderId, targetStatus) {
  const idStr = orderId ? orderId.toString() : '';
  return `ORDER_NOTIF_${idStr}_${targetStatus}`;
}

module.exports = {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_PROVIDERS,
  NOTIFICATION_PROVIDER_VALUES,
  DELIVERY_STATUS,
  DELIVERY_STATUS_VALUES,
  NOTIFICATION_ERROR_CODES,
  ORDER_NOTIFICATION_MILESTONES,
  NOTIFICATION_TRIGGER_MATRIX,
  isNotifiableStatusTransition,
  getNotificationMilestone,
  generateNotificationIdempotencyKey,
};
