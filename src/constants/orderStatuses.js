const { ROLE_VALUES } = require('./roles');

// ─── Canonical Status Values (ADR-004, Section 7) ────────────────────────────

const ORDER_STATUS_VALUES = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  PROCESSING: 'PROCESSING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  PICKED_UP: 'PICKED_UP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

const ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUS_VALUES));

// ─── Allowed Status Transitions (ADR-004, Section 9) ─────────────────────────
//
// Only the transitions listed here are permitted. The backend must reject any
// requested transition not present in this map.
//
// Terminal states (COMPLETED, CANCELLED) map to an empty array — no further
// transition is allowed from those states.

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS_VALUES.ORDER_CREATED]: Object.freeze([
    ORDER_STATUS_VALUES.PROCESSING,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.PROCESSING]: Object.freeze([
    ORDER_STATUS_VALUES.READY_FOR_PICKUP,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.READY_FOR_PICKUP]: Object.freeze([ORDER_STATUS_VALUES.PICKED_UP]),
  [ORDER_STATUS_VALUES.PICKED_UP]: Object.freeze([ORDER_STATUS_VALUES.COMPLETED]),
  [ORDER_STATUS_VALUES.COMPLETED]: Object.freeze([]),
  [ORDER_STATUS_VALUES.CANCELLED]: Object.freeze([]),
});

// ─── Terminal States (ADR-004, Section 9) ─────────────────────────────────────
//
// Orders in a terminal state must not return to an earlier lifecycle state.

const TERMINAL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS_VALUES.COMPLETED,
  ORDER_STATUS_VALUES.CANCELLED,
]);

// ─── Authorized Status Update Roles (ADR-004 §11, ADR-002 §10) ───────────────
//
// Authorized branch staff (BRANCH_ASSISTANT and BRANCH_MANAGER) may perform operational Order-status updates.
// CUSTOMER has read-only access and must never update status.
// SYSTEM_ADMIN is restricted from day-to-day order status processing.

const ORDER_STATUS_UPDATE_ROLES = Object.freeze([
  ROLE_VALUES.BRANCH_ASSISTANT,
  ROLE_VALUES.BRANCH_MANAGER,
]);

// ─── Roles permitted to view Order tracking information ───────────────────────
//
// Authorized branch staff (BRANCH_ASSISTANT and BRANCH_MANAGER) may view Order-tracking information.

const ORDER_TRACKING_VIEW_ROLES = Object.freeze([
  ROLE_VALUES.BRANCH_ASSISTANT,
  ROLE_VALUES.BRANCH_MANAGER,
]);

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Returns true if the supplied string is a canonical ADR-004 Order status.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  return ORDER_STATUSES.includes(status);
}

/**
 * Returns true when the transition from `currentStatus` to `nextStatus` is
 * permitted by the ADR-004 lifecycle rules.
 *
 * Both arguments must be canonical status values; the function returns false
 * for unknown or non-canonical inputs.
 *
 * @param {string} currentStatus - The Order's current canonical status.
 * @param {string} nextStatus    - The requested canonical status.
 * @returns {boolean}
 */
function isValidStatusTransition(currentStatus, nextStatus) {
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

/**
 * Returns true when `status` is a terminal state (COMPLETED or CANCELLED).
 * A terminal Order must not undergo any further status change.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isTerminalStatus(status) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

module.exports = {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  ALLOWED_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  ORDER_STATUS_UPDATE_ROLES,
  ORDER_TRACKING_VIEW_ROLES,
  isValidOrderStatus,
  isValidStatusTransition,
  isTerminalStatus,
};
