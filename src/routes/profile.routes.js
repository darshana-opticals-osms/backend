const express = require('express');
const { getProfile, updateProfile } = require('../controllers/profile.controller');
const { validate } = require('../middleware/validate');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { ROLE_VALUES } = require('../constants/roles');

const profileUpdateValidation = (req) => {
  const { body = {} } = req;
  const errors = [];
  const allowedFields = new Set(['name', 'email', 'address', 'phone']);

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Profile update data must be an object.' }];
  }

  const restrictedKeys = [
    'role',
    'password',
    'passwordHash',
    'permissions',
    'branchId',
    'admin',
    'staff',
    '_id',
    'id',
    'userId',
    'customerId',
    'createdAt',
    'updatedAt',
    '__v',
  ];

  for (const key of Object.keys(body)) {
    if (restrictedKeys.includes(key) || !allowedFields.has(key)) {
      errors.push({ field: key, message: `${key} is not allowed for profile updates.` });
    }
  }

  const fieldsToCheck = ['name', 'email', 'address', 'phone'];
  for (const field of fieldsToCheck) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      if (field === 'name' || field === 'address') {
        if (typeof value !== 'string' || !value.trim()) {
          errors.push({ field, message: `${field} must be a non-empty string.` });
        }
      }

      if (field === 'email') {
        if (typeof value !== 'string') {
          errors.push({ field, message: 'email must be a string.' });
        } else {
          const normalizedEmail = value.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            errors.push({ field, message: 'email must be a valid email address.' });
          }
        }
      }

      if (field === 'phone') {
        if (typeof value !== 'string' || !/^\+?[0-9\s()-]{7,20}$/.test(value.trim())) {
          errors.push({ field, message: 'phone format is invalid.' });
        }
      }
    }
  }

  if (Object.keys(body).length === 0) {
    errors.push({ field: 'body', message: 'Profile update payload is required.' });
  }

  return errors;
};

const router = express.Router();

/**
 * @openapi
 * /profile/me:
 *   get:
 *     summary: Get the authenticated customer's own profile
 *     description: Returns only the safe profile data for the authenticated CUSTOMER.
 *     tags:
 *       - Profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer profile returned successfully.
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
 *                   $ref: '#/components/schemas/CustomerProfile'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/profile/me', authenticate, authorizeRoles(ROLE_VALUES.CUSTOMER), getProfile);

/**
 * @openapi
 * /profile/me:
 *   patch:
 *     summary: Update the authenticated customer's own profile
 *     description: Updates only allowed customer profile fields; the payload may be partial, but an empty patch is rejected.
 *     tags:
 *       - Profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileUpdateRequest'
 *     responses:
 *       200:
 *         description: Customer profile was updated successfully.
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
 *                   $ref: '#/components/schemas/CustomerProfile'
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
 */
router.patch(
  '/profile/me',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(profileUpdateValidation),
  updateProfile
);

module.exports = router;
