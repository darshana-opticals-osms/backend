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
 *     description: Returns the safe profile data for the authenticated customer only.
 *     tags:
 *       - Profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer profile returned successfully
 *       401:
 *         description: Authentication required or invalid token
 *       403:
 *         description: Authenticated user is not a CUSTOMER
 *       404:
 *         description: Customer profile not found
 */
router.get('/profile/me', authenticate, authorizeRoles(ROLE_VALUES.CUSTOMER), getProfile);

/**
 * @openapi
 * /profile/me:
 *   patch:
 *     summary: Update the authenticated customer's own profile
 *     description: Updates only the allowed customer profile fields for the authenticated customer.
 *     tags:
 *       - Profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Alice Customer
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice.customer@example.com
 *               address:
 *                 type: string
 *                 example: 12 Main Street, Colombo
 *               phone:
 *                 type: string
 *                 example: '+94711234567'
 *     responses:
 *       200:
 *         description: Customer profile updated successfully
 *       401:
 *         description: Authentication required or invalid token
 *       403:
 *         description: Authenticated user is not a CUSTOMER
 *       404:
 *         description: Customer profile not found
 *       409:
 *         description: Email conflicts with another account
 *       422:
 *         description: Validation error or prohibited field supplied
 */
router.patch(
  '/profile/me',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(profileUpdateValidation),
  updateProfile
);

module.exports = router;
