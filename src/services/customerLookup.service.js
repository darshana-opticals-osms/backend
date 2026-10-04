const Customer = require('../models/customer.model');
const { ValidationError } = require('../errors/AppError');

// ─── Lookup Configuration (AC25, AC26) ──────────────────────────────────────

/**
 * Maximum number of Customer records returned per lookup.
 * Prevents uncontrolled full-database dumps (AC25, AC27).
 */
const LOOKUP_RESULT_LIMIT = 10;

/**
 * Minimum query length required to trigger a lookup.
 * Prevents trivially broad queries (AC9).
 */
const LOOKUP_QUERY_MIN_LENGTH = 2;

/**
 * Maximum query length accepted.
 * Prevents excessively long inputs (AC9).
 */
const LOOKUP_QUERY_MAX_LENGTH = 100;

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Escapes regex metacharacters from a user-supplied string so that it can be
 * safely embedded in a MongoDB $regex query without creating uncontrolled
 * pattern matching.
 *
 * AC10, AC11 – No raw Mongo operators; safe text search construction.
 *
 * @param {string} raw - Untrusted input string
 * @returns {string} Regex-safe escaped string
 */
function escapeRegex(raw) {
  // Escapes: \ ^ $ . | ? * + ( ) [ ] { }
  return raw.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/**
 * Validates and normalizes the raw lookup query string.
 *
 * AC9  – Validate search query (non-empty, trimmed, min/max length).
 * AC10 – Client cannot submit arbitrary MongoDB operators.
 *
 * @param {string} rawQuery - The raw `q` value from the request query string
 * @returns {string} Trimmed, validated query string
 * @throws {ValidationError} if the query fails validation
 */
function validateAndNormalizeQuery(rawQuery) {
  if (typeof rawQuery !== 'string') {
    throw new ValidationError(
      'Lookup query `q` is required and must be a string.',
      { field: 'q' }
    );
  }

  const trimmed = rawQuery.trim();

  if (trimmed.length === 0) {
    throw new ValidationError(
      'Lookup query `q` must not be empty or whitespace only.',
      { field: 'q' }
    );
  }

  if (trimmed.length < LOOKUP_QUERY_MIN_LENGTH) {
    throw new ValidationError(
      `Lookup query \`q\` must be at least ${LOOKUP_QUERY_MIN_LENGTH} characters.`,
      { field: 'q' }
    );
  }

  if (trimmed.length > LOOKUP_QUERY_MAX_LENGTH) {
    throw new ValidationError(
      `Lookup query \`q\` must not exceed ${LOOKUP_QUERY_MAX_LENGTH} characters.`,
      { field: 'q' }
    );
  }

  return trimmed;
}

// ─── Response Shaping ────────────────────────────────────────────────────────

/**
 * Projects a Customer Mongoose document into the minimum safe response shape
 * required for Customer selection.
 *
 * AC15 – Return minimum Customer identification fields.
 * AC16 – Customer ID is the authoritative selection value.
 * AC17 – Never return passwordHash.
 * AC18 – Do not return address unless explicitly required.
 * AC19-AC22 – No Prescription, Order, Payment, or Loyalty data.
 *
 * @param {object} customer - Mongoose Customer document
 * @returns {{ id: string, name: string, email: string, phone: string }}
 */
function shapeCustomer(customer) {
  return {
    id: customer._id.toString(),
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  };
}

// ─── Service Function ─────────────────────────────────────────────────────────

/**
 * Performs a bounded, case-insensitive Customer lookup across safe identity
 * fields (name, email, phone) for the authorized Optometrist clinical workflow.
 *
 * Key behaviours enforced:
 *
 * AC6  – Meaningful Customer identification: name, email, phone search.
 * AC7  – No password / authentication data used in search.
 * AC8  – Address not used as lookup criterion.
 * AC9  – Query is validated (non-empty, min/max length).
 * AC10 – Client cannot inject raw MongoDB operators.
 * AC11 – User input is regex-escaped before constructing $regex queries.
 * AC12 – Name and email matching is case-insensitive.
 * AC13 – Email lookup uses the model's existing lowercase-normalized data.
 * AC14 – Phone lookup uses the stored phone representation.
 * AC15 – Only safe identifying fields are projected.
 * AC23 – No match returns empty array (not an error).
 * AC24 – Multiple matches are returned safely.
 * AC25 – Result set is bounded to LOOKUP_RESULT_LIMIT.
 * AC26 – Deterministic ordering: name ASC, _id ASC tiebreak.
 *
 * @param {string} rawQuery - The raw `q` value from the request query string
 * @returns {object[]} Array of shaped Customer results (may be empty)
 * @throws {ValidationError} if the query fails validation
 */
async function lookupCustomers(rawQuery) {
  // AC9: Validate and normalize before constructing any DB query.
  const query = validateAndNormalizeQuery(rawQuery);

  // AC11: Escape regex metacharacters to prevent uncontrolled pattern matching.
  const safePattern = escapeRegex(query);

  // AC12: Case-insensitive flag 'i' for name and email matching.
  const caseInsensitiveRegex = { $regex: safePattern, $options: 'i' };

  // AC13: Email is stored in lowercase — the regex with 'i' flag handles mixed
  //       case input gracefully without conflicting with the model's normalization.
  // AC14: Phone is searched against the stored representation (no re-normalization).
  // AC10: MongoDB query is constructed entirely server-side.
  //       The client only controls the `q` string value, not the query structure.
  const filter = {
    $or: [
      { name: caseInsensitiveRegex },
      { email: caseInsensitiveRegex },
      { phone: caseInsensitiveRegex },
    ],
  };

  // AC25: Bounded result — never return full Customer table.
  // AC26: Deterministic ordering: name ascending, _id ascending as tiebreak.
  // AC17: passwordHash is excluded via the model's `select: false` on the field.
  //       We additionally project only the four safe fields to enforce AC15.
  const customers = await Customer.find(filter)
    .select('name email phone')
    .sort({ name: 1, _id: 1 })
    .limit(LOOKUP_RESULT_LIMIT)
    .lean();

  // AC23: Empty array is a valid result — not an error.
  return customers.map(shapeCustomer);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  lookupCustomers,
  // Exported for unit testing
  validateAndNormalizeQuery,
  shapeCustomer,
  escapeRegex,
  LOOKUP_RESULT_LIMIT,
  LOOKUP_QUERY_MIN_LENGTH,
  LOOKUP_QUERY_MAX_LENGTH,
};
