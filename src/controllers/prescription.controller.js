const catchAsync = require('../utils/catchAsync');
const {
  createPrescription,
  getMyPrescriptionHistory,
  getCustomerPrescriptionHistory,
} = require('../services/prescription.service');

/**
 * POST /api/prescriptions
 *
 * Records a new clinical prescription for a customer.
 * Restricted to OPTOMETRIST role (enforced at the route layer).
 *
 * AC1  – Only OPTOMETRIST may create prescriptions (route-level RBAC)
 * AC2  – recordedBy is derived from req.auth.id (JWT), never from req.body
 * AC8  – Insert-only: service always creates a new document
 */
const recordPrescription = catchAsync(async (req, res) => {
  // AC2: Pass the server-derived staff identity from the verified JWT.
  // The service ignores any recordedBy field in req.body.
  const prescription = await createPrescription(req.auth.id, req.body);

  return res.status(201).json({
    success: true,
    data: prescription,
  });
});

/**
 * GET /api/prescriptions/me
 *
 * Returns the authenticated customer's own prescription history.
 * Restricted to CUSTOMER role (enforced at the route layer).
 *
 * AC13 – Customer identity derived from JWT, not a client-controlled ID
 * AC14 – Empty history returns a valid empty array
 * AC15 – Only prescriptions belonging to the authenticated customer are returned
 * AC16 – History is returned in deterministic chronological order (newest first)
 */
const getMyPrescriptions = catchAsync(async (req, res) => {
  // AC13, AC15: Use the JWT-derived customer identity — never trust a query param or body.
  const prescriptions = await getMyPrescriptionHistory(req.auth.id);

  return res.status(200).json({
    success: true,
    data: prescriptions,
  });
});

/**
 * GET /api/prescriptions/customer/:customerId
 *
 * Returns a specific customer's prescription history for an authorized Optometrist.
 * Restricted to OPTOMETRIST role (enforced at the route layer).
 *
 * AC18 – Optometrist read scope is explicitly enforced server-side
 * AC3  – Target customer is validated in the service before querying
 */
const getCustomerPrescriptions = catchAsync(async (req, res) => {
  const prescriptions = await getCustomerPrescriptionHistory(req.params.customerId);

  return res.status(200).json({
    success: true,
    data: prescriptions,
  });
});

module.exports = {
  recordPrescription,
  getMyPrescriptions,
  getCustomerPrescriptions,
};
