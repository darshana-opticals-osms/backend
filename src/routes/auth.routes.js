const express = require('express');
const {
  register,
  login,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');

const phonePattern = /^\+?[0-9\s()-]{7,20}$/;

const registerValidation = (req) => {
  const { body = {} } = req;
  const validationErrors = [];
  const allowedFields = new Set(['name', 'email', 'address', 'phone', 'password']);
  const forbiddenFieldNames = ['role', 'passwordHash', 'permissions', 'branchId', 'admin', 'staff'];

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key) && !forbiddenFieldNames.includes(key)) {
      validationErrors.push({
        field: key,
        message: `${key} is not allowed for public customer registration.`,
      });
    }
  }

  for (const forbiddenField of forbiddenFieldNames) {
    if (Object.prototype.hasOwnProperty.call(body, forbiddenField)) {
      validationErrors.push({
        field: forbiddenField,
        message:
          'Role and privileged account fields are not allowed in public customer registration.',
      });
    }
  }

  const nameValue = body.name;
  if (nameValue === undefined || nameValue === null || nameValue === '') {
    validationErrors.push({ field: 'name', message: 'name is required' });
  }

  const emailValue = body.email;
  if (emailValue === undefined || emailValue === null || emailValue === '') {
    validationErrors.push({ field: 'email', message: 'email is required' });
  } else if (typeof emailValue !== 'string') {
    validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
  } else {
    const normalizedEmail = emailValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
    } else {
      req.body.email = normalizedEmail;
    }
  }

  const addressValue = body.address;
  if (addressValue !== undefined && addressValue !== null && typeof addressValue !== 'string') {
    validationErrors.push({ field: 'address', message: 'address must be a string' });
  }

  const phoneValue = body.phone;
  if (phoneValue === undefined || phoneValue === null || phoneValue === '') {
    validationErrors.push({ field: 'phone', message: 'phone is required' });
  } else if (typeof phoneValue !== 'string' || !phonePattern.test(phoneValue.trim())) {
    validationErrors.push({ field: 'phone', message: 'phone format is invalid' });
  }

  const passwordValue = body.password;
  if (passwordValue === undefined || passwordValue === null || passwordValue === '') {
    validationErrors.push({ field: 'password', message: 'password is required' });
  } else if (typeof passwordValue !== 'string' || passwordValue.length < 8) {
    validationErrors.push({
      field: 'password',
      message: 'password must be at least 8 characters long',
    });
  }

  return validationErrors;
};

const loginValidation = (req) => {
  const { body = {} } = req;
  const validationErrors = [];
  const allowedFields = new Set(['email', 'password']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      validationErrors.push({
        field: key,
        message: `${key} is not allowed for login.`,
      });
    }
  }

  const emailValue = body.email;
  if (emailValue === undefined || emailValue === null || emailValue === '') {
    validationErrors.push({ field: 'email', message: 'email is required' });
  } else if (typeof emailValue !== 'string') {
    validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
  } else {
    const normalizedEmail = emailValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
    } else {
      req.body.email = normalizedEmail;
    }
  }

  const passwordValue = body.password;
  if (passwordValue === undefined || passwordValue === null || passwordValue === '') {
    validationErrors.push({ field: 'password', message: 'password is required' });
  } else if (typeof passwordValue !== 'string') {
    validationErrors.push({ field: 'password', message: 'password must be a string' });
  }

  return validationErrors;
};

const passwordComplexityPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

const forgotPasswordValidation = (req) => {
  const { body = {} } = req;
  const validationErrors = [];
  const allowedFields = new Set(['email']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      validationErrors.push({
        field: key,
        message: `${key} is not allowed for forgot password.`,
      });
    }
  }

  const emailValue = body.email;
  if (emailValue === undefined || emailValue === null || emailValue === '') {
    validationErrors.push({ field: 'email', message: 'email is required' });
  } else if (typeof emailValue !== 'string') {
    validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
  } else {
    const normalizedEmail = emailValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      validationErrors.push({ field: 'email', message: 'email must be a valid email address' });
    } else {
      req.body.email = normalizedEmail;
    }
  }

  return validationErrors;
};

const resetPasswordValidation = (req) => {
  const { body = {} } = req;
  const validationErrors = [];
  const allowedFields = new Set(['token', 'newPassword']);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      validationErrors.push({
        field: key,
        message: `${key} is not allowed for password reset.`,
      });
    }
  }

  const tokenValue = body.token;
  if (tokenValue === undefined || tokenValue === null || tokenValue === '') {
    validationErrors.push({ field: 'token', message: 'token is required' });
  } else if (typeof tokenValue !== 'string' || tokenValue.trim() === '') {
    validationErrors.push({ field: 'token', message: 'token must be a valid non-empty string' });
  } else {
    req.body.token = tokenValue.trim();
  }

  const newPasswordValue = body.newPassword;
  if (newPasswordValue === undefined || newPasswordValue === null || newPasswordValue === '') {
    validationErrors.push({ field: 'newPassword', message: 'newPassword is required' });
  } else if (typeof newPasswordValue !== 'string') {
    validationErrors.push({ field: 'newPassword', message: 'newPassword must be a string' });
  } else if (!passwordComplexityPattern.test(newPasswordValue)) {
    validationErrors.push({
      field: 'newPassword',
      message:
        'newPassword must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number',
    });
  }

  return validationErrors;
};

const router = express.Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new customer account
 *     description: Public registration for a CUSTOMER account. Address is optional, privileged role fields are rejected, and duplicate conflict detection is based on email.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Customer successfully registered.
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
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/auth/register', validate(registerValidation), register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate a customer, staff member, or admin
 *     description: Returns a signed JWT and the safe identity record for the authenticated user.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/auth/login', validate(loginValidation), login);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     description: Public endpoint to initiate password recovery for registered Customer and Staff accounts. Employs a generic anti-enumeration response; a successful 200 response does NOT confirm or reveal whether an account exists.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Generic anti-enumeration success response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/auth/forgot-password', validate(forgotPasswordValidation), forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Reset account password using token
 *     description: Public endpoint to reset an account password using a valid, short-lived single-use reset token. The request body requires only token and newPassword; confirmPassword is not accepted as an API field.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password successfully reset.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *       400:
 *         description: Reset token is malformed, invalid, expired, or already used.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/auth/reset-password', validate(resetPasswordValidation), resetPassword);

module.exports = router;
