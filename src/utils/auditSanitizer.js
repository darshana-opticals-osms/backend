// ─── Audit Metadata Sanitizer (ADR-012 §Sensitive-Data Redaction) ─────────────
//
// Centralized sanitization for AuditEvent metadata objects.
//
// Purpose:
//   All AuditEvent metadata must pass through sanitizeAuditMetadata() before
//   being persisted. This function recursively removes any key that matches an
//   ADR-012-prohibited sensitive field name.
//
// Responsibilities:
//   - Strip prohibited keys (passwords, tokens, secrets, card data, PII) at any
//     nesting depth (AC36–AC41).
//   - Reject or truncate unreasonably large metadata objects that may conceal
//     raw request bodies or raw provider payloads (AC40–AC41).
//   - Provide a list of canonically prohibited key names (imported from
//     AUDIT_PROHIBITED_METADATA_KEYS) so that domain developers do not need to
//     independently maintain their own redaction lists.
//
// What this sanitizer does NOT do:
//   - It does not validate business-level correctness of metadata values.
//   - It does not perform general input sanitization (see src/utils/sanitizer.js).
//   - It does not replace structured audit event fields (action, actorId, etc.).
//
// AC37 test coverage: tests/unit/auditSanitizer.test.js must explicitly verify
// that all AUDIT_PROHIBITED_METADATA_KEYS are stripped.

const { AUDIT_PROHIBITED_METADATA_KEYS } = require('../constants/audit');

// Case-insensitive set for fast O(1) lookup.
const PROHIBITED_KEYS_LOWER = new Set(AUDIT_PROHIBITED_METADATA_KEYS.map((k) => k.toLowerCase()));

/**
 * Maximum allowed byte-size for a serialised metadata object.
 * Raw request bodies or provider payloads that exceed this are rejected
 * to prevent accidental persistence of large sensitive blobs (AC40–AC41).
 */
const MAX_METADATA_BYTES = 8192; // 8 KB

/**
 * Maximum recursion depth for nested metadata objects.
 * Objects deeper than this are replaced with the string '[DEPTH_LIMIT]'.
 */
const MAX_DEPTH = 6;

/**
 * Returns true if `key` is an ADR-012-prohibited metadata field name.
 * The check is case-insensitive so that variants such as "Password",
 * "PASSWORD", and "cardnumber" are all caught.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isProhibitedKey(key) {
  return PROHIBITED_KEYS_LOWER.has(String(key).toLowerCase());
}

/**
 * Recursively sanitizes a metadata value.
 *
 * - Plain objects: prohibited keys are removed; allowed keys are recursed.
 * - Arrays: each element is recursed.
 * - Primitives: returned as-is.
 * - Functions / Symbols: stripped (replaced with undefined, which Mongoose
 *   ignores for Mixed fields).
 *
 * @param {*}      value  The value to sanitize.
 * @param {number} depth  Current recursion depth (starts at 0).
 * @returns {*}           Sanitized value, or undefined if the value should be omitted.
 */
function sanitizeValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return '[DEPTH_LIMIT]';
  }

  // Strip functions and symbols — they have no safe serialization in BSON.
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1)).filter((v) => v !== undefined);
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const safe = {};
    for (const key of Object.keys(value)) {
      // Strip prohibited sensitive keys.
      if (isProhibitedKey(key)) {
        continue;
      }
      // Strip MongoDB operator injection keys.
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      const sanitized = sanitizeValue(value[key], depth + 1);
      if (sanitized !== undefined) {
        safe[key] = sanitized;
      }
    }
    return safe;
  }

  // Primitives (string, number, boolean, null, Date) pass through.
  return value;
}

/**
 * Sanitizes an AuditEvent metadata object according to ADR-012 §Sensitive-Data
 * Redaction policy.
 *
 * Usage:
 *   const safeMeta = sanitizeAuditMetadata(rawMetadata);
 *   // safeMeta is now safe to persist in AuditEvent.metadata
 *
 * Rules applied:
 *   1. null / undefined input → returns null.
 *   2. Non-object input (string, number, boolean) → returns null.
 *      Audit metadata must always be a plain object.
 *   3. Serialised size exceeding MAX_METADATA_BYTES → throws an error.
 *      This prevents accidental persistence of raw request bodies / payloads.
 *   4. Prohibited keys (AUDIT_PROHIBITED_METADATA_KEYS) removed recursively.
 *   5. MongoDB operator keys ($, .) removed.
 *   6. Nested depth beyond MAX_DEPTH truncated.
 *
 * @param {object|null|undefined} metadata - Raw metadata from domain service.
 * @returns {object|null}                   Sanitized metadata safe for persistence.
 * @throws {Error}                          If the serialised metadata exceeds the size limit.
 */
function sanitizeAuditMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return null;
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    // Metadata must be a plain object; reject scalars and raw arrays.
    return null;
  }

  // Guard against large payloads (raw request bodies, provider responses).
  let serialized;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    // Non-serializable objects (circular refs, etc.) are rejected.
    throw new Error(
      'AuditEvent metadata is not JSON-serializable. Ensure domain services pass plain objects.'
    );
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error(
      `AuditEvent metadata exceeds the maximum allowed size of ${MAX_METADATA_BYTES} bytes. ` +
        'Do not pass raw request bodies or provider payloads as audit metadata (ADR-012 AC40–AC41).'
    );
  }

  return sanitizeValue(metadata, 0);
}

module.exports = {
  sanitizeAuditMetadata,
  isProhibitedKey,
  PROHIBITED_KEYS_LOWER,
  MAX_METADATA_BYTES,
  MAX_DEPTH,
};
