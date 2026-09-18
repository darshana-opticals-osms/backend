const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ConflictError, NotFoundError, ValidationError } = require('../errors/AppError');

const PROFILE_EDITABLE_FIELDS = ['name', 'email', 'address', 'phone'];
const PROFILE_RESTRICTED_FIELDS = new Set([
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
]);
const PHONE_PATTERN = /^\+?[0-9\s()-]{7,20}$/;

const buildSafeCustomerResponse = (customer) => ({
  id: customer._id ? customer._id.toString() : customer.id,
  name: customer.name,
  email: customer.email,
  address: customer.address,
  phone: customer.phone,
  role: customer.role,
});

const normalizeEmail = (email) => {
  if (typeof email !== 'string') {
    return null;
  }

  return email.trim().toLowerCase();
};

const validateEditableField = (field, value) => {
  if (field === 'name' || field === 'address') {
    if (typeof value !== 'string') {
      return `${field} must be a string`;
    }

    const normalized = value.trim();
    if (!normalized) {
      return `${field} cannot be empty`;
    }

    return null;
  }

  if (field === 'email') {
    if (typeof value !== 'string') {
      return 'email must be a string';
    }

    const normalized = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return 'email must be a valid email address';
    }

    return null;
  }

  if (field === 'phone') {
    if (typeof value !== 'string') {
      return 'phone must be a string';
    }

    const normalized = value.trim();
    if (!PHONE_PATTERN.test(normalized)) {
      return 'phone format is invalid';
    }

    return null;
  }

  return `${field} is not allowed for profile updates`;
};

const ensureNoRestrictedFields = (payload) => {
  const invalidFields = Object.keys(payload).filter((key) => {
    return PROFILE_RESTRICTED_FIELDS.has(key) || !PROFILE_EDITABLE_FIELDS.includes(key);
  });

  if (invalidFields.length > 0) {
    throw new ValidationError(
      `Profile update contains restricted or unknown fields: ${invalidFields.join(', ')}`
    );
  }
};

const getOwnProfile = async (customerId) => {
  const customer = await Customer.findById(customerId);

  if (!customer) {
    throw new NotFoundError('Customer profile not found.');
  }

  return buildSafeCustomerResponse(customer);
};

const ensureEmailAvailability = async ({ customerId, normalizedEmail, currentEmail }) => {
  if (normalizedEmail === currentEmail) {
    return;
  }

  const [customerExists, staffExists, adminExists] = await Promise.all([
    Customer.exists({ email: normalizedEmail, _id: { $ne: customerId } }),
    Staff.exists({ email: normalizedEmail }),
    Admin.exists({ email: normalizedEmail }),
  ]);

  if (customerExists || staffExists || adminExists) {
    throw new ConflictError('An account with this email already exists.');
  }
};

const updateOwnProfile = async (customerId, payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Profile update data must be an object.');
  }

  const hasAnyField = Object.keys(payload).length > 0;
  if (!hasAnyField) {
    throw new ValidationError('Profile update payload is required.');
  }

  ensureNoRestrictedFields(payload);

  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new NotFoundError('Customer profile not found.');
  }

  const normalizedIncoming = {};
  for (const field of PROFILE_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = payload[field];
      const validationError = validateEditableField(field, value);
      if (validationError) {
        throw new ValidationError(validationError);
      }

      if (field === 'email') {
        const normalizedEmail = normalizeEmail(value);
        if (!normalizedEmail) {
          throw new ValidationError('email must be a valid email address');
        }
        await ensureEmailAvailability({
          customerId,
          normalizedEmail,
          currentEmail: normalizeEmail(customer.email),
        });
        normalizedIncoming.email = normalizedEmail;
        continue;
      }

      normalizedIncoming[field] = typeof value === 'string' ? value.trim() : value;
    }
  }

  if (Object.keys(normalizedIncoming).length === 0) {
    throw new ValidationError('Profile update payload is required.');
  }

  const updatedCustomer = await Customer.findByIdAndUpdate(
    customerId,
    { $set: normalizedIncoming },
    {
      new: true,
      runValidators: true,
      context: 'query',
    }
  );

  if (!updatedCustomer) {
    throw new NotFoundError('Customer profile not found.');
  }

  return buildSafeCustomerResponse(updatedCustomer);
};

module.exports = {
  buildSafeCustomerResponse,
  getOwnProfile,
  updateOwnProfile,
  PROFILE_EDITABLE_FIELDS,
  PROFILE_RESTRICTED_FIELDS,
};
