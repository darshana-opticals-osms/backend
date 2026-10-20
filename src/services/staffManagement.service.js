const mongoose = require('mongoose');
const Staff = require('../models/staff.model');
const Branch = require('../models/branch.model');
const authService = require('./auth.service');
const { STAFF_ROLE_VALUES } = require('../constants/roles');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} = require('../errors/AppError');
const {
  recordStaffRoleChange,
  recordStaffBranchReassigned,
  recordStaffStatusToggled,
  recordStaffProfileUpdated,
} = require('./adminAudit.service');

const phonePattern = /^\+?[0-9\s()-]{7,20}$/;

/**
 * Executes an administrative mutation and audit record atomically via MongoDB replica-set transaction,
 * falling back to an explicit compensation/recovery mechanism on standalone deployments (ADR-012, AC14).
 *
 * @param {Function} mutationFn - async (session) => { return { result, rollback } }
 * @param {Function|null} auditFn - async (session) => { ... }
 */
async function executeAdministrativeMutationWithAudit(mutationFn, auditFn) {
  const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;

  if (isDbConnected) {
    let session = null;
    try {
      session = await mongoose.startSession();
      if (session && typeof session.withTransaction === 'function') {
        let executionResult;
        await session.withTransaction(async () => {
          const outcome = await mutationFn(session);
          executionResult = outcome?.result !== undefined ? outcome.result : outcome;
          if (auditFn) {
            await auditFn(session);
          }
        });
        return executionResult;
      }
    } catch (err) {
      const isStandaloneUnsupported =
        (err.name === 'MongoServerError' &&
          (err.code === 20 ||
            err.codeName === 'IllegalOperation' ||
            (err.message && err.message.includes('Transaction numbers are only allowed')))) ||
        (err.message && err.message.includes('replica set'));

      if (!isStandaloneUnsupported) {
        throw err;
      }
    } finally {
      if (session && session.endSession) {
        await session.endSession();
      }
    }
  }

  // Standalone fallback: execute mutation, then audit. If audit fails, execute rollback compensation.
  const outcome = await mutationFn(null);
  const executionResult = outcome?.result !== undefined ? outcome.result : outcome;
  const rollback = outcome?.rollback;

  if (auditFn) {
    try {
      await auditFn(null);
    } catch (auditError) {
      if (typeof rollback === 'function') {
        try {
          await rollback();
        } catch {
          // preserve original auditError
        }
      }
      throw auditError;
    }
  }

  return executionResult;
}

const toStaffManagementDto = (staff) => {
  if (!staff) return null;
  return {
    id: (staff._id || staff.id).toString(),
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    address: staff.address,
    role: staff.role,
    branchId: staff.branchId ? staff.branchId.toString() : null,
    isActive: staff.isActive !== false,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
};

/**
 * Lists existing Staff Members with optional role, branch, status, search filtering and bounded pagination (AC1).
 */
const listStaffMembers = async (query = {}) => {
  const { role, branchId, isActive, search, page = 1, limit = 20 } = query;
  const filter = {};

  if (role !== undefined && role !== null && role !== '') {
    if (!STAFF_ROLE_VALUES.includes(role)) {
      throw new ValidationError('Invalid role filter.', { field: 'role' });
    }
    filter.role = role;
  }

  if (branchId !== undefined && branchId !== null && branchId !== '') {
    if (typeof branchId !== 'string' || !mongoose.isValidObjectId(branchId)) {
      throw new ValidationError('Invalid branchId filter.', { field: 'branchId' });
    }
    filter.branchId = branchId;
  }

  if (isActive !== undefined && isActive !== null && isActive !== '') {
    if (isActive === true || isActive === 'true') {
      filter.isActive = { $ne: false };
    } else if (isActive === false || isActive === 'false') {
      filter.isActive = false;
    } else {
      throw new ValidationError('Invalid isActive filter.', { field: 'isActive' });
    }
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }];
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  const [total, staffList] = await Promise.all([
    Staff.countDocuments(filter),
    Staff.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(parsedLimit).lean(),
  ]);

  return {
    staff: staffList.map(toStaffManagementDto),
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    },
  };
};

/**
 * Retrieves a single Staff Member by ObjectId (AC2).
 */
const getStaffById = async (id) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ValidationError('Invalid staff identifier.', { field: 'id' });
  }

  const staff = await Staff.findById(id).lean();
  if (!staff) {
    throw new NotFoundError('Staff member not found.');
  }

  return toStaffManagementDto(staff);
};

/**
 * Updates allowed editable profile fields for a Staff Member (AC3, AC14).
 */
const updateStaffProfile = async (id, payload = {}, adminUser = null) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ValidationError('Invalid staff identifier.', { field: 'id' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Update payload must be an object.');
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    throw new NotFoundError('Staff member not found.');
  }

  const allowedFields = new Set(['name', 'phone', 'address', 'email']);
  const updates = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedFields.has(key)) {
      throw new ValidationError(`Field '${key}' is not allowed for profile updates.`, {
        field: key,
      });
    }
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('At least one editable field must be provided.');
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string') {
      throw new ValidationError('name must be 2-100 alphabetic characters.', { field: 'name' });
    }
    const trimmedName = updates.name.trim();
    const nameLength = [...trimmedName].length;
    if (
      nameLength < 2 ||
      nameLength > 100 ||
      !/^[\p{L}\p{M} .'-]+$/u.test(trimmedName) ||
      !/\p{L}/u.test(trimmedName)
    ) {
      throw new ValidationError('name must be 2-100 alphabetic characters.', { field: 'name' });
    }
    updates.name = trimmedName;
  }

  if (updates.phone !== undefined) {
    if (typeof updates.phone !== 'string') {
      throw new ValidationError('phone format is invalid.', { field: 'phone' });
    }
    const trimmedPhone = updates.phone.trim();
    const digitCount = (trimmedPhone.match(/[0-9]/g) || []).length;
    if (
      !phonePattern.test(trimmedPhone) ||
      digitCount < 10 ||
      digitCount > 15 ||
      !/[0-9]$/.test(trimmedPhone)
    ) {
      throw new ValidationError('phone format is invalid.', { field: 'phone' });
    }
    updates.phone = trimmedPhone;
  }

  if (updates.address !== undefined) {
    if (typeof updates.address !== 'string') {
      throw new ValidationError('address must be at least 5 characters long.', {
        field: 'address',
      });
    }
    const trimmedAddress = updates.address.trim();
    if (trimmedAddress.length < 5) {
      throw new ValidationError('address must be at least 5 characters long.', {
        field: 'address',
      });
    }
    updates.address = trimmedAddress;
  }

  if (updates.email !== undefined) {
    if (typeof updates.email !== 'string') {
      throw new ValidationError('email must be a valid email address.', { field: 'email' });
    }
    const normalizedEmail = updates.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new ValidationError('email must be a valid email address.', { field: 'email' });
    }
    if (normalizedEmail !== staff.email) {
      const existing = await authService.checkExistingIdentity(normalizedEmail);
      if (existing) {
        throw new ConflictError('An account with this email already exists.');
      }
      updates.email = normalizedEmail;
    }
  }

  const originalValues = {};
  for (const key of Object.keys(updates)) {
    originalValues[key] = staff[key];
  }

  const updatedStaff = await executeAdministrativeMutationWithAudit(
    async (session) => {
      for (const [key, value] of Object.entries(updates)) {
        staff[key] = value;
      }
      await staff.save(session ? { session } : undefined);
      return {
        result: staff,
        rollback: async () => {
          for (const [key, value] of Object.entries(originalValues)) {
            staff[key] = value;
          }
          await staff.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordStaffProfileUpdated({
            adminUser,
            staffId: staff._id,
            updatedFields: updates,
            session,
          });
        }
      : null
  );

  return toStaffManagementDto(updatedStaff);
};

/**
 * Modifies an existing Staff account's assigned role (AC4, AC14).
 */
const updateStaffRole = async (id, newRole, adminUser = null) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ValidationError('Invalid staff identifier.', { field: 'id' });
  }

  if (typeof newRole !== 'string' || !STAFF_ROLE_VALUES.includes(newRole)) {
    throw new ValidationError('Invalid role. Role must be a canonical staff role.', {
      field: 'role',
    });
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    throw new NotFoundError('Staff member not found.');
  }

  if (adminUser && String(adminUser.userId || adminUser.id) === String(staff._id)) {
    throw new ForbiddenError('You cannot change your own administrative role.');
  }

  const oldRole = staff.role;

  const updatedStaff = await executeAdministrativeMutationWithAudit(
    async (session) => {
      staff.role = newRole;
      await staff.save(session ? { session } : undefined);
      return {
        result: staff,
        rollback: async () => {
          staff.role = oldRole;
          await staff.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordStaffRoleChange({
            adminUser,
            staffId: staff._id,
            oldRole,
            newRole,
            session,
          });
        }
      : null
  );

  return toStaffManagementDto(updatedStaff);
};

/**
 * Reassigns an existing Staff Member to another valid Branch (AC5, AC14).
 */
const updateStaffBranch = async (id, branchId, adminUser = null) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ValidationError('Invalid staff identifier.', { field: 'id' });
  }

  let validatedBranchId = null;
  if (branchId !== null && branchId !== undefined && branchId !== '') {
    if (typeof branchId !== 'string' || !mongoose.isValidObjectId(branchId)) {
      throw new ValidationError('branchId must be a valid branch identifier.', {
        field: 'branchId',
      });
    }
    const branchExists = await Branch.exists({ _id: branchId });
    if (!branchExists) {
      throw new NotFoundError('Branch not found.');
    }
    validatedBranchId = branchId;
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    throw new NotFoundError('Staff member not found.');
  }

  const oldBranchId = staff.branchId;

  const updatedStaff = await executeAdministrativeMutationWithAudit(
    async (session) => {
      staff.branchId = validatedBranchId;
      await staff.save(session ? { session } : undefined);
      return {
        result: staff,
        rollback: async () => {
          staff.branchId = oldBranchId;
          await staff.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordStaffBranchReassigned({
            adminUser,
            staffId: staff._id,
            oldBranchId,
            newBranchId: validatedBranchId,
            session,
          });
        }
      : null
  );

  return toStaffManagementDto(updatedStaff);
};

/**
 * Activates or deactivates an existing Staff account (AC6, AC14).
 */
const updateStaffStatus = async (id, isActive, adminUser = null) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ValidationError('Invalid staff identifier.', { field: 'id' });
  }

  let normalizedStatus;
  if (typeof isActive === 'boolean') {
    normalizedStatus = isActive;
  } else if (typeof isActive === 'string') {
    const trimmed = isActive.trim().toLowerCase();
    if (trimmed === 'active' || trimmed === 'true') {
      normalizedStatus = true;
    } else if (trimmed === 'inactive' || trimmed === 'false') {
      normalizedStatus = false;
    }
  }

  if (typeof normalizedStatus !== 'boolean') {
    throw new ValidationError(
      'isActive must be a boolean or status string ("ACTIVE" | "INACTIVE").',
      {
        field: 'isActive',
      }
    );
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    throw new NotFoundError('Staff member not found.');
  }

  if (
    adminUser &&
    String(adminUser.userId || adminUser.id) === String(staff._id) &&
    !normalizedStatus
  ) {
    throw new ForbiddenError('You cannot deactivate your own administrative account.');
  }

  const oldStatus = staff.isActive !== false;

  const updatedStaff = await executeAdministrativeMutationWithAudit(
    async (session) => {
      staff.isActive = normalizedStatus;
      await staff.save(session ? { session } : undefined);
      return {
        result: staff,
        rollback: async () => {
          staff.isActive = oldStatus;
          await staff.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordStaffStatusToggled({
            adminUser,
            staffId: staff._id,
            oldStatus,
            newStatus: normalizedStatus,
            session,
          });
        }
      : null
  );

  return toStaffManagementDto(updatedStaff);
};

module.exports = {
  toStaffManagementDto,
  listStaffMembers,
  getStaffById,
  updateStaffProfile,
  updateStaffRole,
  updateStaffBranch,
  updateStaffStatus,
};
