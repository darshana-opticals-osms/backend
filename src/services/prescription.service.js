const mongoose = require('mongoose');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Prescription = require('../models/prescription.model');
const { NotFoundError, ValidationError } = require('../errors/AppError');

// ─── Error Code Constants ────────────────────────────────────────────────────

const INVALID_CUSTOMER_REFERENCE = 'INVALID_CUSTOMER_REFERENCE';
const INVALID_STAFF_REFERENCE = 'INVALID_STAFF_REFERENCE';

// ─── Response Shaping ────────────────────────────────────────────────────────

/**
 * Builds a safe, client-facing prescription response object.
 * Exposes only approved clinical and history fields.
 * Does not expose internal Staff or Customer documents beyond minimum safe fields.
 *
 * AC22 – Safe Customer-Facing Response
 * AC25 – No Sensitive Data in Generic APIs
 *
 * @param {object} prescription - Mongoose Prescription document
 * @returns {object} Safe prescription response shape
 */
function shapePrescription(prescription) {
  const recordedBy =
    prescription.recordedBy && typeof prescription.recordedBy === 'object'
      ? {
          id: prescription.recordedBy._id
            ? prescription.recordedBy._id.toString()
            : prescription.recordedBy.toString(),
          name: prescription.recordedBy.name ?? undefined,
        }
      : { id: prescription.recordedBy ? prescription.recordedBy.toString() : null };

  return {
    id: prescription._id.toString(),
    customerId: prescription.customerId ? prescription.customerId.toString() : null,
    recordedBy,
    recordedAt: prescription.recordedAt,
    rightEye: {
      distance: {
        sph: prescription.rightEye?.distance?.sph ?? null,
        cyl: prescription.rightEye?.distance?.cyl ?? null,
        axis: prescription.rightEye?.distance?.axis ?? null,
        va: prescription.rightEye?.distance?.va ?? null,
      },
      reading: {
        add: prescription.rightEye?.reading?.add ?? null,
        nearVa: prescription.rightEye?.reading?.nearVa ?? null,
      },
    },
    leftEye: {
      distance: {
        sph: prescription.leftEye?.distance?.sph ?? null,
        cyl: prescription.leftEye?.distance?.cyl ?? null,
        axis: prescription.leftEye?.distance?.axis ?? null,
        va: prescription.leftEye?.distance?.va ?? null,
      },
      reading: {
        add: prescription.leftEye?.reading?.add ?? null,
        nearVa: prescription.leftEye?.reading?.nearVa ?? null,
      },
    },
    remarks: prescription.remarks ?? '',
    isArchived: prescription.isArchived ?? false,
    createdAt: prescription.createdAt,
    updatedAt: prescription.updatedAt,
  };
}

// ─── Internal Validators ─────────────────────────────────────────────────────

/**
 * Validates that a customerId is a well-formed ObjectId and references an
 * existing Customer document.
 *
 * AC3 – Validate Target Customer
 *
 * @param {string} customerId
 * @throws {ValidationError} if malformed or customer does not exist
 */
async function validateCustomerExists(customerId) {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new ValidationError(
      'customerId must be a valid identifier.',
      { field: 'customerId' },
      INVALID_CUSTOMER_REFERENCE
    );
  }

  const exists = await Customer.exists({ _id: customerId });

  if (!exists) {
    throw new NotFoundError(
      'The referenced customer does not exist.',
      { field: 'customerId' },
      INVALID_CUSTOMER_REFERENCE
    );
  }
}

/**
 * Validates that a staffId is a well-formed ObjectId and references an
 * existing Staff document. Used as a safety guard for the authenticated
 * Optometrist identity.
 *
 * AC2 – Derive Recording Optometrist from Authentication
 *
 * @param {string} staffId
 * @throws {ValidationError} if malformed or staff does not exist
 */
async function validateStaffExists(staffId) {
  if (!mongoose.isValidObjectId(staffId)) {
    throw new ValidationError(
      'Authenticated staff identity is invalid.',
      { field: 'recordedBy' },
      INVALID_STAFF_REFERENCE
    );
  }

  const exists = await Staff.exists({ _id: staffId });

  if (!exists) {
    throw new NotFoundError(
      'Authenticated staff record not found.',
      { field: 'recordedBy' },
      INVALID_STAFF_REFERENCE
    );
  }
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Records a new clinical prescription for a customer.
 *
 * Key behaviors enforced by this service:
 * - `recordedBy` is always derived from the authenticated Staff identity (AC2).
 *   Any client-supplied `recordedBy` in the input is deliberately ignored.
 * - Target customer is validated before persistence (AC3).
 * - A new Prescription document is always inserted — existing records are
 *   never overwritten (AC8, AC9).
 * - `recordedAt` defaults to server time via the model (AC7).
 * - Clinical data is not logged (AC23).
 *
 * @param {string} authenticatedStaffId - Staff._id from req.auth (JWT-derived)
 * @param {object} prescriptionInput - Validated clinical input from the request body
 * @returns {object} Safe shaped prescription response
 */
async function createPrescription(authenticatedStaffId, prescriptionInput = {}) {
  // AC2: Always validate and use the server-side staff identity.
  // Never trust a recordedBy value from the client.
  await validateStaffExists(authenticatedStaffId);

  const { customerId, rightEye, leftEye, remarks } = prescriptionInput;

  // AC3: Validate the referenced customer exists before persisting.
  await validateCustomerExists(customerId);

  // AC8, AC9: Insert-only — Prescription.create() always produces a new document.
  // No findByIdAndUpdate or overwrite is used here.
  // AC7: recordedAt defaults to Date.now in the model — not accepted from the client.
  const prescription = await Prescription.create({
    customerId,
    recordedBy: authenticatedStaffId,
    rightEye,
    leftEye,
    remarks,
  });

  // Populate the recordedBy staff name for the safe response shape.
  await prescription.populate('recordedBy', 'name');

  // AC22, AC23: Return only the safe shaped response — no raw document.
  return shapePrescription(prescription);
}

/**
 * Retrieves the authenticated customer's own prescription history.
 *
 * Key behaviors:
 * - Customer identity is always derived from JWT (AC13).
 * - Only prescriptions belonging to the authenticated customer are returned (AC15).
 * - Records are ordered newest-first by `recordedAt` (AC16).
 * - An empty history returns an empty array, not an error (AC14).
 * - AC17: All historical records are returned — not just the latest.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @returns {object[]} Array of safe shaped prescription responses (may be empty)
 */
async function getMyPrescriptionHistory(authenticatedCustomerId) {
  // AC16: Deterministic ordering — newest recordedAt first.
  // This ordering direction is documented in the Swagger contract.
  const prescriptions = await Prescription.find({ customerId: authenticatedCustomerId })
    .populate('recordedBy', 'name')
    .sort({ recordedAt: -1 });

  // AC14: Empty history is a valid result.
  return prescriptions.map(shapePrescription);
}

/**
 * Retrieves the prescription history for a specific customer.
 * Intended for Optometrist use only — authorization is enforced at the route layer.
 *
 * Key behaviors:
 * - Target customer is validated before querying (AC3, AC18).
 * - Records are ordered newest-first by `recordedAt` (AC16).
 * - AC18: Least privilege — only the minimum required clinical fields are returned
 *   via shapePrescription().
 *
 * @param {string} customerId - Target Customer._id (from route param, validated)
 * @returns {object[]} Array of safe shaped prescription responses (may be empty)
 */
async function getCustomerPrescriptionHistory(customerId) {
  await validateCustomerExists(customerId);

  // AC16: Deterministic ordering — newest recordedAt first.
  const prescriptions = await Prescription.find({ customerId })
    .populate('recordedBy', 'name')
    .sort({ recordedAt: -1 });

  return prescriptions.map(shapePrescription);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Service functions
  createPrescription,
  getMyPrescriptionHistory,
  getCustomerPrescriptionHistory,
  // Exported for unit testing
  shapePrescription,
  validateCustomerExists,
  validateStaffExists,
  // Error code constants (for test assertions)
  INVALID_CUSTOMER_REFERENCE,
  INVALID_STAFF_REFERENCE,
};
