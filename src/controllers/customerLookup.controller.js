const catchAsync = require('../utils/catchAsync');
const { lookupCustomers } = require('../services/customerLookup.service');

/**
 * GET /api/customers/lookup?q=<search>
 *
 * Performs a bounded, case-insensitive Customer lookup across safe identity
 * fields (name, email, phone) for the authorized Optometrist clinical workflow.
 *
 * Access is restricted to OPTOMETRIST at the route layer.
 *
 * The service is responsible for:
 * - validating the lookup query,
 * - constructing the safe bounded search,
 * - projecting minimum safe Customer fields,
 * - returning deterministically ordered results.
 *
 * AC1  – Secure Customer lookup endpoint for Optometrist workflow
 * AC2  – OPTOMETRIST access only (enforced at route layer)
 * AC5  – Authentication required (enforced at route layer)
 * AC6  – Meaningful Customer identification via name/email/phone
 * AC15 – Minimum safe Customer fields returned
 * AC23 – No match returns valid empty result (not an error)
 * AC38 – Safe centralized error handling via catchAsync
 */
const lookupCustomer = catchAsync(async (req, res) => {
  // req.query.q is the raw lookup string supplied by the authenticated Optometrist.
  // The service is responsible for all validation and safe query construction.
  const results = await lookupCustomers(req.query.q);

  return res.status(200).json({
    success: true,
    data: results,
  });
});

module.exports = {
  lookupCustomer,
};
