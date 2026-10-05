const express = require('express');
const mongoose = require('mongoose');
const { createStaff } = require('../controllers/admin.controller');
const { ROLE_VALUES, STAFF_ROLE_VALUES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');

const phonePattern = /^\+?[0-9\s()-]{7,20}$/;

const staffProvisioningValidation = (req) => {
  const { body = {} } = req;
  const errors = [];
  const allowedFields = new Set([
    'name',
    'email',
    'phone',
    'address',
    'role',
    'password',
    'branchId',
  ]);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Staff provisioning data must be an object.' }];
  }

  let normalizedName;
  let normalizedEmail;
  let normalizedPhone;
  let normalizedAddress;

  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      errors.push({ field, message: `${field} is not allowed for staff provisioning.` });
    }
  }

  for (const field of ['name', 'email', 'phone', 'address', 'role', 'password']) {
    const value = body[field];
    if (value === undefined || value === null || value === '') {
      errors.push({ field, message: `${field} is required` });
    }
  }

  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') {
      errors.push({ field: 'name', message: 'name must be 2-100 alphabetic characters.' });
    } else {
      normalizedName = body.name.trim();
      const nameLength = [...normalizedName].length;
      if (
        nameLength < 2 ||
        nameLength > 100 ||
        !/^[\p{L}\p{M} .'-]+$/u.test(normalizedName) ||
        !/\p{L}/u.test(normalizedName)
      ) {
        errors.push({ field: 'name', message: 'name must be 2-100 alphabetic characters.' });
      }
    }
  }

  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string') {
      errors.push({ field: 'email', message: 'email must be a valid email address.' });
    } else {
      normalizedEmail = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        errors.push({ field: 'email', message: 'email must be a valid email address.' });
      }
    }
  }

  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    if (typeof body.phone !== 'string') {
      errors.push({ field: 'phone', message: 'phone format is invalid.' });
    } else {
      normalizedPhone = body.phone.trim();
      const digitCount = (normalizedPhone.match(/[0-9]/g) || []).length;
      if (
        !phonePattern.test(normalizedPhone) ||
        digitCount < 10 ||
        digitCount > 15 ||
        !/[0-9]$/.test(normalizedPhone)
      ) {
        errors.push({ field: 'phone', message: 'phone format is invalid.' });
      }
    }
  }

  if (body.address !== undefined && body.address !== null) {
    if (typeof body.address !== 'string') {
      errors.push({ field: 'address', message: 'address must be at least 5 characters long.' });
    } else {
      normalizedAddress = body.address.trim();
      if (normalizedAddress.length < 5) {
        errors.push({ field: 'address', message: 'address must be at least 5 characters long.' });
      }
    }
  }

  if (body.role !== undefined && body.role !== null && !STAFF_ROLE_VALUES.includes(body.role)) {
    errors.push({ field: 'role', message: 'role must be a canonical staff role.' });
  }

  if (body.password !== undefined && body.password !== null && body.password !== '') {
    if (
      typeof body.password !== 'string' ||
      body.password.length < 8 ||
      !/[A-Z]/.test(body.password) ||
      !/[a-z]/.test(body.password) ||
      !/[0-9]/.test(body.password)
    ) {
      errors.push({
        field: 'password',
        message:
          'password must be at least 8 characters and include uppercase, lowercase, and a number.',
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'branchId')) {
    const { branchId } = body;
    if (
      typeof branchId !== 'string' ||
      !/^[a-f\d]{24}$/i.test(branchId) ||
      !mongoose.isValidObjectId(branchId)
    ) {
      errors.push({ field: 'branchId', message: 'branchId must be a valid branch identifier.' });
    }
  }

  if (errors.length === 0) {
    req.body.name = normalizedName;
    req.body.email = normalizedEmail;
    req.body.phone = normalizedPhone;
    req.body.address = normalizedAddress;
  }

  return errors;
};

const router = express.Router();

/**
 * @openapi
 * /admin/staff:
 *   post:
 *     summary: Provision a staff account
 *     description: SYSTEM_ADMIN only. Creates a staff identity with one canonical staff role; branchId is optional for every staff role.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffProvisioningRequest'
 *     responses:
 *       201:
 *         description: Staff account created successfully. The response contains no password or secret fields.
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
 *                   $ref: '#/components/schemas/ProvisionedStaff'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/admin/staff',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  validate(staffProvisioningValidation),
  createStaff
);

module.exports = router;
