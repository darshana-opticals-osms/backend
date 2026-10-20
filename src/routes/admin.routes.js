const express = require('express');
const mongoose = require('mongoose');
const {
  createStaff,
  listStaffHandler,
  getStaffByIdHandler,
  updateStaffProfileHandler,
  updateStaffRoleHandler,
  updateStaffBranchHandler,
  updateStaffStatusHandler,
} = require('../controllers/admin.controller');
const {
  getAdminDoctorsHandler,
  updateDoctorHandler,
  updateDoctorStatusHandler,
} = require('../controllers/doctor.controller');
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

/**
 * @openapi
 * /admin/staff:
 *   get:
 *     summary: List staff accounts with filtering and pagination
 *     description: SYSTEM_ADMIN only. Returns paginated staff member records with optional filters for role, branchId, isActive status, and text search across name/email.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [BRANCH_MANAGER, OPTOMETRIST, BRANCH_ASSISTANT]
 *         description: Filter staff by role
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Filter staff by branch ID
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter staff by active status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search query matching staff name or email
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated staff records retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffListResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/admin/staff',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  listStaffHandler
);

/**
 * @openapi
 * /admin/staff/{id}:
 *   get:
 *     summary: Get single staff account by identifier
 *     description: SYSTEM_ADMIN only. Retrieves detailed staff member profile excluding credentials or secrets.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Staff MongoDB ObjectId
 *     responses:
 *       200:
 *         description: Staff details retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffResponse'
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
  '/admin/staff/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  getStaffByIdHandler
);

/**
 * @openapi
 * /admin/staff/{id}:
 *   patch:
 *     summary: Update staff member contact profile
 *     description: SYSTEM_ADMIN only. Updates name, email, phone, and/or address of a staff member. Emits a STAFF_PROFILE_UPDATED audit log.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Staff MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffProfileUpdateRequest'
 *     responses:
 *       200:
 *         description: Staff profile updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.patch(
  '/admin/staff/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateStaffProfileHandler
);

/**
 * @openapi
 * /admin/staff/{id}/role:
 *   patch:
 *     summary: Update staff member role
 *     description: SYSTEM_ADMIN only. Reassigns staff role to another canonical staff role (BRANCH_MANAGER, OPTOMETRIST, BRANCH_ASSISTANT). Emits a STAFF_ROLE_REASSIGNED audit log.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Staff MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffRoleUpdateRequest'
 *     responses:
 *       200:
 *         description: Staff role updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffResponse'
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
router.patch(
  '/admin/staff/:id/role',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateStaffRoleHandler
);

/**
 * @openapi
 * /admin/staff/{id}/branch:
 *   patch:
 *     summary: Update staff branch assignment
 *     description: SYSTEM_ADMIN only. Reassigns staff member to a valid branch or clears assignment with null. Emits a STAFF_BRANCH_REASSIGNED audit log.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Staff MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffBranchUpdateRequest'
 *     responses:
 *       200:
 *         description: Staff branch updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffResponse'
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
router.patch(
  '/admin/staff/:id/branch',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateStaffBranchHandler
);

/**
 * @openapi
 * /admin/staff/{id}/status:
 *   patch:
 *     summary: Update staff active/inactive status
 *     description: SYSTEM_ADMIN only. Activates or deactivates a staff member account. Emits a STAFF_STATUS_TOGGLED audit log. Deactivated staff cannot log in and have active sessions immediately rejected.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Staff MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StaffStatusUpdateRequest'
 *     responses:
 *       200:
 *         description: Staff status updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StaffResponse'
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
router.patch(
  '/admin/staff/:id/status',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateStaffStatusHandler
);

/**
 * @openapi
 * /admin/doctors:
 *   get:
 *     summary: List all doctors for admin management
 *     description: SYSTEM_ADMIN only. Retrieves all registered doctors including their active/inactive status, with optional filters for isActive and search query.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter doctors by active status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search query matching doctor name or specialization
 *     responses:
 *       200:
 *         description: List of doctors with management status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminDoctorListResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/admin/doctors',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  getAdminDoctorsHandler
);

/**
 * @openapi
 * /admin/doctors/{id}:
 *   patch:
 *     summary: Update doctor name and/or specialization
 *     description: SYSTEM_ADMIN only. Updates external doctor profile details. Emits a DOCTOR_RECORD_UPDATED audit log.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Doctor MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DoctorUpdateRequest'
 *     responses:
 *       200:
 *         description: Doctor updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminDoctorResponse'
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
router.patch(
  '/admin/doctors/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateDoctorHandler
);

/**
 * @openapi
 * /admin/doctors/{id}/status:
 *   patch:
 *     summary: Update doctor active/inactive status
 *     description: SYSTEM_ADMIN only. Activates or deactivates a doctor. Emits a DOCTOR_STATUS_TOGGLED audit log. Inactive doctors cannot be assigned to new sessions; existing historical sessions are retained.
 *     tags:
 *       - Administration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: Doctor MongoDB ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DoctorStatusUpdateRequest'
 *     responses:
 *       200:
 *         description: Doctor status updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminDoctorResponse'
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
router.patch(
  '/admin/doctors/:id/status',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  updateDoctorStatusHandler
);

module.exports = router;
