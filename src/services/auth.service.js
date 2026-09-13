const bcrypt = require('bcrypt');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ConflictError, ValidationError } = require('../errors/AppError');

const BCRYPT_SALT_ROUNDS = 12;
const ALLOWED_REGISTRATION_FIELDS = new Set(['name', 'email', 'address', 'phone', 'password']);
const FORBIDDEN_REGISTRATION_FIELDS = new Set([
  'role',
  'passwordHash',
  'permissions',
  'branchId',
  'isAdmin',
  'admin',
  'staff',
]);

const normalizeEmail = (email) => {
  if (typeof email !== 'string') {
    return '';
  }

  return email.trim().toLowerCase();
};

const sanitizeCustomerRegistrationInput = (input = {}) => {
  const trimmedInput = {};

  for (const key of Object.keys(input)) {
    if (!ALLOWED_REGISTRATION_FIELDS.has(key) && !FORBIDDEN_REGISTRATION_FIELDS.has(key)) {
      continue;
    }

    trimmedInput[key] = input[key];
  }

  return {
    name: typeof trimmedInput.name === 'string' ? trimmedInput.name.trim() : '',
    email: normalizeEmail(trimmedInput.email),
    address: typeof trimmedInput.address === 'string' ? trimmedInput.address.trim() : '',
    phone: typeof trimmedInput.phone === 'string' ? trimmedInput.phone.trim() : '',
    password: typeof trimmedInput.password === 'string' ? trimmedInput.password : '',
  };
};

const checkExistingIdentity = async (email) => {
  const [customer, staff, admin] = await Promise.all([
    Customer.exists({ email }),
    Staff.exists({ email }),
    Admin.exists({ email }),
  ]);

  return customer || staff || admin || null;
};

const buildSafeCustomerResponse = (customer) => ({
  id: customer._id ? customer._id.toString() : customer.id,
  name: customer.name,
  email: customer.email,
  address: customer.address,
  phone: customer.phone,
  role: customer.role,
});

const registerCustomer = async (customerInput = {}) => {
  const normalizedInput = sanitizeCustomerRegistrationInput(customerInput);
  const { name, email, address, phone, password } = normalizedInput;

  const disallowedFieldNames = Object.keys(customerInput).filter((fieldName) =>
    FORBIDDEN_REGISTRATION_FIELDS.has(fieldName)
  );

  if (disallowedFieldNames.length > 0) {
    throw new ValidationError(
      'Role and privileged account fields are not allowed in public customer registration.'
    );
  }

  if (!name || !email || !address || !phone || !password) {
    throw new ValidationError('All required customer registration fields must be provided.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('email must be a valid email address');
  }

  const phoneRegex = /^\+?[0-9\s()-]{7,20}$/;
  if (!phoneRegex.test(phone)) {
    throw new ValidationError('phone format is invalid');
  }

  if (password.length < 8) {
    throw new ValidationError('password must be at least 8 characters long');
  }

  const existingIdentity = await checkExistingIdentity(email);
  if (existingIdentity) {
    throw new ConflictError('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const customer = await Customer.create({
    name,
    email,
    address,
    phone,
    role: ROLE_VALUES.CUSTOMER,
    passwordHash,
  });

  return buildSafeCustomerResponse(customer);
};

module.exports = {
  BCRYPT_SALT_ROUNDS,
  normalizeEmail,
  sanitizeCustomerRegistrationInput,
  checkExistingIdentity,
  registerCustomer,
};
