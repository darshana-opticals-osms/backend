// ─── ADR-012 Audit Constants ──────────────────────────────────────────────────
//
// This file is the single authoritative source for all audit-related constants
// used by the immutable audit trail (DDP-065 / ADR-012).
//
// Domain services MUST import action types, actor types, target types, outcomes,
// and source identifiers from here. Free-text values are prohibited.
//
// SCHEMA_VERSION must be incremented (following semantic versioning) whenever
// the canonical AuditEvent structure changes in a breaking manner.

// ─── Schema / Event Version ───────────────────────────────────────────────────

/** Current canonical AuditEvent schema version (ADR-012 §Schema Versioning). */
const AUDIT_SCHEMA_VERSION = '1.0';

// ─── Audit Action Types ───────────────────────────────────────────────────────
//
// Controlled taxonomy of every auditable action defined by ADR-012.
// Domain code must reference these constants — never raw strings.

const AUDIT_ACTION = Object.freeze({
  // ── Inventory ──────────────────────────────────────────────────────────────
  /** An authorised staff member manually changed an inventory item's quantity. */
  INVENTORY_QUANTITY_ADJUSTED: 'INVENTORY_QUANTITY_ADJUSTED',

  /** The checkout workflow deducted stock for a confirmed order. */
  INVENTORY_CHECKOUT_STOCK_DEDUCTED: 'INVENTORY_CHECKOUT_STOCK_DEDUCTED',

  /** An authorised manager changed an item's reorder threshold / configuration. */
  INVENTORY_REORDER_CONFIG_CHANGED: 'INVENTORY_REORDER_CONFIG_CHANGED',

  // ── Payment / Financial ────────────────────────────────────────────────────
  /** A payment initiation (checkout session) was successfully created. */
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',

  /** A payment moved from one canonical status to another. */
  PAYMENT_STATUS_CHANGED: 'PAYMENT_STATUS_CHANGED',

  /** A verified provider (PayHere) callback was received and processed. */
  PAYMENT_PROVIDER_CALLBACK_VERIFIED: 'PAYMENT_PROVIDER_CALLBACK_VERIFIED',

  /** A payment reached the COMPLETED terminal status. */
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',

  /** A payment reached the FAILED terminal status. */
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  /** A payment was cancelled. */
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',

  /** A refund / reversal was processed (only if ADR-009 supports it). */
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',

  // ── Clinical / Prescription ────────────────────────────────────────────────
  /** An authorised optometrist recorded a new clinical prescription. */
  PRESCRIPTION_RECORDED: 'PRESCRIPTION_RECORDED',
});

/** Flat array of all permitted action type strings — used for Mongoose enum validation. */
const AUDIT_ACTION_VALUES = Object.freeze(Object.values(AUDIT_ACTION));

// ─── Actor Types ──────────────────────────────────────────────────────────────
//
// Distinguishes who or what initiated the auditable action (ADR-012 §Actor/Source Model).

const AUDIT_ACTOR_TYPE = Object.freeze({
  /** An authenticated human user (staff member or customer). */
  USER: 'USER',

  /** A trusted internal system/background process (e.g. checkout engine, scheduled job). */
  SYSTEM: 'SYSTEM',

  /** A verified external third-party provider (e.g. PayHere callback). */
  EXTERNAL_PROVIDER: 'EXTERNAL_PROVIDER',
});

const AUDIT_ACTOR_TYPE_VALUES = Object.freeze(Object.values(AUDIT_ACTOR_TYPE));

// ─── Target / Resource Types ──────────────────────────────────────────────────
//
// Identifies the domain resource affected by the auditable action
// (ADR-012 §Resource/Target Model).

const AUDIT_TARGET_TYPE = Object.freeze({
  INVENTORY: 'INVENTORY',
  PAYMENT: 'PAYMENT',
  ORDER: 'ORDER',
  PRESCRIPTION: 'PRESCRIPTION',
  LOYALTY_TRANSACTION: 'LOYALTY_TRANSACTION',
});

const AUDIT_TARGET_TYPE_VALUES = Object.freeze(Object.values(AUDIT_TARGET_TYPE));

// ─── Outcome Values ───────────────────────────────────────────────────────────

const AUDIT_OUTCOME = Object.freeze({
  /** The business operation completed successfully. */
  SUCCESS: 'SUCCESS',

  /** The business operation failed (domain or infrastructure error). */
  FAILURE: 'FAILURE',
});

const AUDIT_OUTCOME_VALUES = Object.freeze(Object.values(AUDIT_OUTCOME));

// ─── Source Identifiers ───────────────────────────────────────────────────────
//
// Identifies the system component that generated the audit event.
// Used when actorType is SYSTEM or EXTERNAL_PROVIDER.

const AUDIT_SOURCE = Object.freeze({
  /** Internal OSMS backend application. */
  OSMS_BACKEND: 'OSMS_BACKEND',

  /** PayHere payment gateway provider. */
  PAYHERE_GATEWAY: 'PAYHERE_GATEWAY',
});

const AUDIT_SOURCE_VALUES = Object.freeze(Object.values(AUDIT_SOURCE));

// ─── Prohibited Metadata Keys ─────────────────────────────────────────────────
//
// These keys must never appear in a persisted AuditEvent metadata object.
// The centralized sanitizer uses this list to strip or reject dangerous fields.
// (ADR-012 §Sensitive-Data Redaction / AC36–AC41)

const AUDIT_PROHIBITED_METADATA_KEYS = Object.freeze([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'authorization',
  'apiKey',
  'secret',
  'merchantSecret',
  'webhookSecret',
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'pin',
  'privateKey',
  'signingKey',
  'appSecret',
]);

// ─── Read-Access Roles ────────────────────────────────────────────────────────
//
// Canonical roles permitted to retrieve audit events through the approved
// read-only API (ADR-012 §Audit-Read Access / AC53–AC55).
// Import ROLE_VALUES lazily to avoid circular dependencies.

const AUDIT_READ_ROLES = Object.freeze(['SYSTEM_ADMIN', 'BRANCH_MANAGER']);

// ─── Pagination ───────────────────────────────────────────────────────────────

/** Maximum number of audit events returned per page (ADR-012 §AC57). */
const AUDIT_PAGE_SIZE_MAX = 100;

/** Default page size when the client does not specify one. */
const AUDIT_PAGE_SIZE_DEFAULT = 20;

// ─── Retention ────────────────────────────────────────────────────────────────

/** Minimum audit retention in years as required by SDS and ADR-012. */
const AUDIT_RETENTION_YEARS = 7;

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  AUDIT_SCHEMA_VERSION,
  AUDIT_ACTION,
  AUDIT_ACTION_VALUES,
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTOR_TYPE_VALUES,
  AUDIT_TARGET_TYPE,
  AUDIT_TARGET_TYPE_VALUES,
  AUDIT_OUTCOME,
  AUDIT_OUTCOME_VALUES,
  AUDIT_SOURCE,
  AUDIT_SOURCE_VALUES,
  AUDIT_PROHIBITED_METADATA_KEYS,
  AUDIT_READ_ROLES,
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_RETENTION_YEARS,
};
