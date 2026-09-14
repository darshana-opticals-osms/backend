const express = require('express');
const { register, login } = require('../controllers/auth.controller');
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
  if (addressValue === undefined || addressValue === null || addressValue === '') {
    validationErrors.push({ field: 'address', message: 'address is required' });
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

const router = express.Router();

router.post('/auth/register', validate(registerValidation), register);
router.post('/auth/login', validate(loginValidation), login);

module.exports = router;
