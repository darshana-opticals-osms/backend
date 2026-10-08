const express = require('express');
const mongoose = require('mongoose');
const {
  recordPrescription,
  getMyPrescriptions,
  getCustomerPrescriptions,
} = require('../controllers/prescription.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');

// ─── Forbidden Client Fields ─────────────────────────────────────────────────

/**
 * Fields that must never be accepted from the client on prescription creation.
 * recordedBy and recordedAt are server-controlled (AC2, AC7).
 * isArchived policy is out of scope for this issue (AC12).
 */
const FORBIDDEN_CREATE_FIELDS = new Set([
  'recordedBy',
  'recordedAt',
  'isArchived',
  '_id',
  'id',
  '__v',
  'createdAt',
  'updatedAt',
]);

/** Allowed top-level fields a client may supply when creating a prescription. */
const ALLOWED_CREATE_FIELDS = new Set(['customerId', 'rightEye', 'leftEye', 'remarks']);

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validates an optional numeric clinical field (sph, cyl, add).
 * Must be a finite number when supplied.
 *
 * AC5 – Validate Clinical Field Types
 */
const validateOptionalNumber = (value, field, errors) => {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ field, message: `${field} must be a number when supplied.` });
  }
};

/**
 * Validates the axis field.
 * Must be a finite number in the range 0–180 when supplied.
 *
 * AC5, AC6 – Axis range 0–180
 */
const validateAxis = (value, field, errors) => {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ field, message: `${field} must be a number when supplied.` });
    return;
  }
  if (value < 0 || value > 180) {
    errors.push({ field, message: `${field} must be between 0 and 180.` });
  }
};

/**
 * Validates an optional VA string field (va, nearVa).
 * Must be a non-empty string when supplied.
 *
 * AC5 – Visual acuity string representation
 */
const validateOptionalString = (value, field, errors) => {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ field, message: `${field} must be a non-empty string when supplied.` });
  }
};

/**
 * Validates the remarks field.
 * Must be a string (may be empty) when supplied, capped to 1000 characters.
 *
 * AC5 – Remarks validation/sanitization
 */
const validateRemarks = (value, errors) => {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    errors.push({ field: 'remarks', message: 'remarks must be a string when supplied.' });
    return;
  }
  if (value.length > 1000) {
    errors.push({ field: 'remarks', message: 'remarks must not exceed 1000 characters.' });
  }
};

/**
 * Validates a single eye prescription sub-document.
 * Both distance and reading sub-objects are optional.
 * Unknown sub-fields within each eye are rejected.
 *
 * AC4  – Only approved ADR-001 clinical fields accepted
 * AC5  – Clinical field type enforcement
 * AC6  – Axis range 0–180
 */
const validateEye = (eye, side, errors) => {
  if (eye === undefined || eye === null) return;

  if (typeof eye !== 'object' || Array.isArray(eye)) {
    errors.push({ field: side, message: `${side} must be an object when supplied.` });
    return;
  }

  const ALLOWED_EYE_FIELDS = new Set(['distance', 'reading']);
  for (const key of Object.keys(eye)) {
    if (!ALLOWED_EYE_FIELDS.has(key)) {
      errors.push({
        field: `${side}.${key}`,
        message: `${side}.${key} is not an approved clinical field.`,
      });
    }
  }

  const { distance, reading } = eye;

  // --- Distance sub-document ---
  if (distance !== undefined && distance !== null) {
    if (typeof distance !== 'object' || Array.isArray(distance)) {
      errors.push({ field: `${side}.distance`, message: `${side}.distance must be an object.` });
    } else {
      const ALLOWED_DISTANCE_FIELDS = new Set(['sph', 'cyl', 'axis', 'va']);
      for (const key of Object.keys(distance)) {
        if (!ALLOWED_DISTANCE_FIELDS.has(key)) {
          errors.push({
            field: `${side}.distance.${key}`,
            message: `${side}.distance.${key} is not an approved clinical field.`,
          });
        }
      }
      validateOptionalNumber(distance.sph, `${side}.distance.sph`, errors);
      validateOptionalNumber(distance.cyl, `${side}.distance.cyl`, errors);
      validateAxis(distance.axis, `${side}.distance.axis`, errors);
      validateOptionalString(distance.va, `${side}.distance.va`, errors);
    }
  }

  // --- Reading sub-document ---
  if (reading !== undefined && reading !== null) {
    if (typeof reading !== 'object' || Array.isArray(reading)) {
      errors.push({ field: `${side}.reading`, message: `${side}.reading must be an object.` });
    } else {
      const ALLOWED_READING_FIELDS = new Set(['add', 'nearVa']);
      for (const key of Object.keys(reading)) {
        if (!ALLOWED_READING_FIELDS.has(key)) {
          errors.push({
            field: `${side}.reading.${key}`,
            message: `${side}.reading.${key} is not an approved clinical field.`,
          });
        }
      }
      validateOptionalNumber(reading.add, `${side}.reading.add`, errors);
      validateOptionalString(reading.nearVa, `${side}.reading.nearVa`, errors);
    }
  }
};

// ─── Validation Functions ─────────────────────────────────────────────────────

/**
 * Validates the POST /prescriptions request body.
 *
 * AC3  – customerId is required and must be a valid ObjectId
 * AC4  – Only approved ADR-001 fields accepted; forbidden/unknown fields rejected
 * AC5  – Clinical field type enforcement
 * AC6  – Axis range 0–180
 * AC10 – No update semantics — this is a pure creation validator
 * AC19 – Appointment linkage is not required or validated here
 * AC20 – CUSTOMER role is blocked at the route layer; this validator handles field-level only
 */
const createPrescriptionValidation = (req) => {
  const { body } = req;
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Prescription data must be an object.' }];
  }

  // AC4: Reject forbidden server-controlled fields.
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_CREATE_FIELDS.has(key)) {
      errors.push({
        field: key,
        message: `${key} is not accepted from the client and must be removed from the request.`,
      });
    } else if (!ALLOWED_CREATE_FIELDS.has(key)) {
      errors.push({
        field: key,
        message: `${key} is not an approved prescription field.`,
      });
    }
  }

  // Early return if there are structural/forbidden field violations.
  if (errors.length > 0) return errors;

  // AC3: customerId is required and must be a well-formed ObjectId.
  const { customerId } = body;
  if (!customerId) {
    errors.push({ field: 'customerId', message: 'customerId is required.' });
  } else if (!mongoose.isValidObjectId(customerId)) {
    errors.push({ field: 'customerId', message: 'customerId must be a valid identifier.' });
  }

  // AC4, AC5, AC6: Validate eye sub-documents.
  validateEye(body.rightEye, 'rightEye', errors);
  validateEye(body.leftEye, 'leftEye', errors);

  // AC5: Validate remarks.
  validateRemarks(body.remarks, errors);

  return errors;
};

/**
 * Validates the GET /prescriptions/customer/:customerId route parameter.
 *
 * AC3  – customerId path param must be a well-formed ObjectId
 * AC15 – Malformed identifiers must not bypass ownership checks
 */
const customerIdParamValidation = (req) => {
  const errors = [];
  const { customerId } = req.params;

  if (!customerId || !mongoose.isValidObjectId(customerId)) {
    errors.push({ field: 'customerId', message: 'customerId must be a valid identifier.' });
  }

  return errors;
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = express.Router();

/**
 * @openapi
 * /prescriptions:
 *   post:
 *     summary: Record a new clinical prescription
 *     description: |
 *       Creates a new clinical prescription for a specified customer.
 *       **Restricted to OPTOMETRIST role only** (AC1).
 *
 *       Key behaviors:
 *       - `recordedBy` is always derived from the authenticated Optometrist's JWT identity.
 *         Do not supply `recordedBy` in the request body — it will be rejected (AC2).
 *       - `recordedAt` is controlled by the server and must not be supplied by the client (AC7).
 *       - Each call creates a new Prescription document. Existing records are never overwritten.
 *         A correction is recorded as a new document (AC8, AC9).
 *       - `isArchived` is not accepted from the client. Archive policy is out of scope (AC12).
 *       - Appointment linkage is not required (AC19).
 *       - CUSTOMER users cannot create prescriptions (AC20).
 *       - No prescription scan or file upload is supported (AC21).
 *       - Clinical payloads are not logged by the backend (AC23).
 *     tags:
 *       - Prescriptions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PrescriptionCreateRequest'
 *     responses:
 *       201:
 *         description: Prescription recorded successfully.
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
 *                   $ref: '#/components/schemas/PrescriptionResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/prescriptions',
  authenticate,
  authorizeRoles(ROLE_VALUES.OPTOMETRIST),
  validate(createPrescriptionValidation),
  recordPrescription
);

/**
 * @openapi
 * /prescriptions/me:
 *   get:
 *     summary: Get the authenticated customer's own prescription history
 *     description: |
 *       Returns all clinical prescription records belonging to the authenticated CUSTOMER.
 *       **Restricted to CUSTOMER role only.**
 *
 *       Key behaviors:
 *       - Customer identity is derived from the JWT — the client cannot override it (AC13).
 *       - Only prescriptions belonging to the authenticated customer are returned.
 *         Cross-customer access is denied server-side (AC15).
 *       - Records are returned in **newest-first order** (descending by `recordedAt`) (AC16).
 *       - All historical records are returned — not just the latest (AC17).
 *       - An empty history returns an empty array, not an error (AC14).
 *       - CUSTOMER users cannot create or modify prescriptions (AC20).
 *       - Response exposes only approved clinical fields (AC22).
 *     tags:
 *       - Prescriptions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer prescription history returned successfully.
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
 *                   description: Prescriptions ordered newest-first by recordedAt (AC16).
 *                   items:
 *                     $ref: '#/components/schemas/PrescriptionResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/prescriptions/me',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  getMyPrescriptions
);

/**
 * @openapi
 * /prescriptions/customer/{customerId}:
 *   get:
 *     summary: Get a customer's prescription history (Optometrist)
 *     description: |
 *       Returns the prescription history for a specific customer.
 *       **Restricted to OPTOMETRIST role only** (AC18).
 *
 *       Key behaviors:
 *       - Target customer is validated before querying (AC3).
 *       - Records are returned in **newest-first order** (descending by `recordedAt`) (AC16).
 *       - Response exposes only approved clinical fields via safe response shaping (AC18, AC22).
 *       - Least privilege — Optometrist access is explicitly authorized server-side.
 *     tags:
 *       - Prescriptions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the target customer.
 *     responses:
 *       200:
 *         description: Customer prescription history returned successfully.
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
 *                   description: Prescriptions ordered newest-first by recordedAt (AC16).
 *                   items:
 *                     $ref: '#/components/schemas/PrescriptionResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/prescriptions/customer/:customerId',
  authenticate,
  authorizeRoles(ROLE_VALUES.OPTOMETRIST),
  validate(customerIdParamValidation),
  getCustomerPrescriptions
);

module.exports = router;
