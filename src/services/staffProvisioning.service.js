const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Staff = require('../models/staff.model');
const authService = require('./auth.service');
const { STAFF_ROLE_VALUES } = require('../constants/roles');
const { ConflictError, ValidationError } = require('../errors/AppError');

const ALLOWED_PROVISIONING_FIELDS = new Set([
  'name',
  'email',
  'phone',
  'address',
  'role',
  'password',
  'branchId',
]);

const buildSafeStaffResponse = (staff) => ({
  id: staff._id ? staff._id.toString() : staff.id,
  name: staff.name,
  email: staff.email,
  phone: staff.phone,
  address: staff.address,
  role: staff.role,
  branchId: staff.branchId ? staff.branchId.toString() : null,
});

const provisionStaff = async (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Staff provisioning data must be an object.');
  }

  const unsupportedFields = Object.keys(input).filter(
    (field) => !ALLOWED_PROVISIONING_FIELDS.has(field)
  );
  if (unsupportedFields.length > 0) {
    throw new ValidationError(
      `Unsupported staff provisioning fields: ${unsupportedFields.join(', ')}.`
    );
  }

  const { name, email, phone, address, role, password, branchId } = input;
  if (!STAFF_ROLE_VALUES.includes(role)) {
    throw new ValidationError('Staff role is invalid.', { field: 'role' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  let validatedBranchId = null;

  if (branchId !== undefined) {
    if (
      typeof branchId !== 'string' ||
      !/^[a-f\d]{24}$/i.test(branchId) ||
      !mongoose.isValidObjectId(branchId)
    ) {
      throw new ValidationError('branchId must be a valid branch identifier.', {
        field: 'branchId',
      });
    }

    const branchExists = await Branch.exists({ _id: branchId });
    if (!branchExists) {
      throw new ValidationError('branchId must reference an existing branch.', {
        field: 'branchId',
      });
    }
    validatedBranchId = branchId;
  }

  const existingIdentity = await authService.checkExistingIdentity(normalizedEmail);
  if (existingIdentity) {
    throw new ConflictError('An account with this email already exists.');
  }

  const passwordHash = await authService.hashPassword(password);
  const staff = await Staff.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    address: address.trim(),
    role,
    branchId: validatedBranchId,
    passwordHash,
  });

  return buildSafeStaffResponse(staff);
};

module.exports = {
  provisionStaff,
  buildSafeStaffResponse,
};
