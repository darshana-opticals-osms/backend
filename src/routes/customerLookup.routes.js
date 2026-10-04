const express = require('express');
const { lookupCustomer } = require('../controllers/customerLookup.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  LOOKUP_QUERY_MIN_LENGTH,
  LOOKUP_QUERY_MAX_LENGTH,
} = require('../services/customerLookup.service');

const router = express.Router();

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Route-level validator for GET /customers/lookup?q=<search>.
 *
 * AC9  – Validate search query: required, trimmed, min/max length.
 * AC10 – Client must not inject raw MongoDB operators: `q` is a plain string.
 *
 * Note: Deep query-injection prevention (regex escaping, $or construction) is
 * handled inside the service, not in the route layer. The route is responsible
 * only for ensuring `q` is a non-empty string within acceptable length bounds.
 */
const lookupQueryValidation = (req) => {
  const { q } = req.query;
  const errors = [];

  if (q === undefined || q === null || (typeof q === 'string' && q.trim() === '')) {
    errors.push({
      field: 'q',
      message: 'Lookup query `q` is required.',
    });
    return errors;
  }

  if (typeof q !== 'string') {
    errors.push({
      field: 'q',
      message: 'Lookup query `q` must be a string.',
    });
    return errors;
  }

  const trimmed = q.trim();

  if (trimmed.length < LOOKUP_QUERY_MIN_LENGTH) {
    errors.push({
      field: 'q',
      message: `Lookup query \`q\` must be at least ${LOOKUP_QUERY_MIN_LENGTH} characters.`,
    });
  }

  if (trimmed.length > LOOKUP_QUERY_MAX_LENGTH) {
    errors.push({
      field: 'q',
      message: `Lookup query \`q\` must not exceed ${LOOKUP_QUERY_MAX_LENGTH} characters.`,
    });
  }

  return errors;
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /customers/lookup:
 *   get:
 *     tags:
 *       - Customer Lookup
 *     summary: Search for Customers by name, email, or phone (Optometrist clinical workflow)
 *     description: |
 *       **Restricted Optometrist Customer-selection endpoint for the clinical Prescription workflow.**
 *
 *       Performs a bounded, case-insensitive search across Customer name, email,
 *       and phone fields and returns only the minimum safe identification fields
 *       required to select the correct Customer for Prescription recording.
 *
 *       **This is not a general Customer directory.** It exists exclusively to
 *       support the Optometrist clinical workflow (DDP-073 / Issue #73) and must
 *       not be used for unrelated Customer-administration or CRM purposes.
 *
 *       **Lookup behaviour:**
 *       - Searches across: `name` (case-insensitive), `email` (case-insensitive),
 *         `phone` (stored representation).
 *       - Returns at most **10** matching Customers.
 *       - Results are ordered by `name` ascending, then `_id` ascending as a
 *         deterministic tiebreak.
 *       - No match returns an empty array — not an error.
 *       - Multiple matches are returned together for the Optometrist to select.
 *
 *       **Query validation:**
 *       - `q` is required and must be a non-empty string.
 *       - Minimum length: 2 characters.
 *       - Maximum length: 100 characters.
 *       - Regex metacharacters are safely escaped server-side before querying.
 *
 *       **Data minimization:**
 *       - Response contains only: `id`, `name`, `email`, `phone`.
 *       - `passwordHash`, address, Prescriptions, Orders, Payments, and Loyalty
 *         data are never returned.
 *
 *       **Security:**
 *       - JWT authentication required.
 *       - OPTOMETRIST role required.
 *       - Raw MongoDB query operators cannot be injected via `q`.
 *       - Existing rate-limiting and security middleware apply.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 100
 *           example: Kamal
 *         description: |
 *           Search value matched case-insensitively against Customer name, email,
 *           and phone. Minimum 2 characters, maximum 100 characters.
 *     responses:
 *       200:
 *         description: |
 *           Lookup completed successfully. Returns an array of matching Customers.
 *           An empty array indicates no matching Customer — this is not an error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   maxItems: 10
 *                   items:
 *                     $ref: '#/components/schemas/CustomerLookupResult'
 *             examples:
 *               matchFound:
 *                 summary: One or more Customers found
 *                 value:
 *                   success: true
 *                   data:
 *                     - id: "64b1f2e3a4c5d60001234567"
 *                       name: "Kamal Perera"
 *                       email: "kamal.customer@example.com"
 *                       phone: "+94 71 200 0001"
 *               noMatch:
 *                 summary: No Customers matched the query
 *                 value:
 *                   success: true
 *                   data: []
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/customers/lookup',
  authenticate, // AC5  – Authentication required
  authorizeRoles(ROLE_VALUES.OPTOMETRIST), // AC2  – OPTOMETRIST access only
  validate(lookupQueryValidation), // AC9  – Query validation
  lookupCustomer // AC1  – Secure Customer lookup
);

module.exports = router;
