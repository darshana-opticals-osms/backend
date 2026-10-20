const mongoose = require('mongoose');
const Doctor = require('../models/doctor.model');
const { NotFoundError, ValidationError } = require('../errors/AppError');
const { recordDoctorUpdated, recordDoctorStatusToggled } = require('./adminAudit.service');

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

/**
 * Format a raw Doctor Mongoose document or lean object into a safe DTO (AC7, AC11).
 *
 * @param {Object} doc - Doctor document
 * @returns {{ id: string, name: string, specialization: string }}
 */
const toDoctorDto = (doc) => {
  if (!doc) return null;
  return {
    id: (doc._id || doc.id).toString(),
    name: doc.name,
    specialization: doc.specialization,
  };
};

const toAdminDoctorDto = (doc) => {
  if (!doc) return null;
  return {
    id: (doc._id || doc.id).toString(),
    name: doc.name,
    specialization: doc.specialization,
    isActive: doc.isActive !== false,
  };
};

/**
 * Persists a new Doctor (AC5, AC6, AC7).
 *
 * @param {{ name: string, specialization: string }} payload
 * @returns {Promise<{ id: string, name: string, specialization: string, isActive: boolean }>}
 */
const createDoctor = async ({ name, specialization }) => {
  const doctor = await Doctor.create({
    name: name.trim(),
    specialization: specialization.trim(),
    isActive: true,
  });

  return toDoctorDto(doctor);
};

/**
 * Retrieves eligible active Doctors for appointment workflows (AC10).
 * Sorting: name ascending, _id ascending tie-breaker.
 *
 * @returns {Promise<Array<{ id: string, name: string, specialization: string, isActive: boolean }>>}
 */
const listDoctors = async () => {
  const doctors = await Doctor.find({ isActive: { $ne: false } })
    .sort({ name: 1, _id: 1 })
    .lean();

  return doctors.map(toDoctorDto);
};

/**
 * Retrieves all Doctor directory records for administrative management (AC7).
 *
 * @param {Object} [query={}]
 * @returns {Promise<Array<{ id: string, name: string, specialization: string, isActive: boolean }>>}
 */
const listAllDoctorsAdmin = async (query = {}) => {
  const filter = {};

  if (query.isActive !== undefined && query.isActive !== null && query.isActive !== '') {
    if (query.isActive === true || query.isActive === 'true') {
      filter.isActive = { $ne: false };
    } else if (query.isActive === false || query.isActive === 'false') {
      filter.isActive = false;
    } else {
      throw new ValidationError('Invalid isActive filter.', { field: 'isActive' });
    }
  }

  if (query.search && typeof query.search === 'string' && query.search.trim()) {
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { specialization: new RegExp(escaped, 'i') }];
  }

  const doctors = await Doctor.find(filter).sort({ name: 1, _id: 1 }).lean();

  return doctors.map(toAdminDoctorDto);
};

/**
 * Retrieves a single Doctor by ObjectId (used in appointment/session flows).
 *
 * @param {string} doctorId
 * @returns {Promise<Object|null>}
 */
const getDoctorById = async (doctorId) => {
  if (!doctorId || typeof doctorId !== 'string' || !mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError('Invalid doctor identifier.', { field: 'id' });
  }
  const doctor = await Doctor.findById(doctorId).lean();
  if (!doctor) {
    throw new NotFoundError('Doctor not found.');
  }
  return toAdminDoctorDto(doctor);
};

/**
 * Updates an existing Doctor's name and/or specialization (AC8, AC14).
 *
 * @param {string} doctorId
 * @param {Object} payload
 * @param {Object} [adminUser]
 * @returns {Promise<Object>}
 */
const updateDoctor = async (doctorId, payload = {}, adminUser = null) => {
  if (!doctorId || typeof doctorId !== 'string' || !mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError('Invalid doctor identifier.', { field: 'id' });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Update payload must be an object.');
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    throw new NotFoundError('Doctor not found.');
  }

  const allowedFields = new Set(['name', 'specialization']);
  const updates = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedFields.has(key)) {
      throw new ValidationError(`Field '${key}' is not allowed for doctor updates.`, {
        field: key,
      });
    }
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('At least one editable field must be provided.');
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || !updates.name.trim()) {
      throw new ValidationError('name must be a non-empty string.', { field: 'name' });
    }
    const trimmed = updates.name.trim();
    if (trimmed.length > 100) {
      throw new ValidationError('name must not exceed 100 characters.', { field: 'name' });
    }
    updates.name = trimmed;
  }

  if (updates.specialization !== undefined) {
    if (typeof updates.specialization !== 'string' || !updates.specialization.trim()) {
      throw new ValidationError('specialization must be a non-empty string.', {
        field: 'specialization',
      });
    }
    const trimmed = updates.specialization.trim();
    if (trimmed.length > 100) {
      throw new ValidationError('specialization must not exceed 100 characters.', {
        field: 'specialization',
      });
    }
    updates.specialization = trimmed;
  }

  const originalValues = {};
  if (updates.name !== undefined) originalValues.name = doctor.name;
  if (updates.specialization !== undefined) {
    originalValues.specialization = doctor.specialization;
  }

  const updatedDoctor = await executeAdministrativeMutationWithAudit(
    async (session) => {
      if (updates.name !== undefined) doctor.name = updates.name.trim();
      if (updates.specialization !== undefined) {
        doctor.specialization = updates.specialization.trim();
      }
      await doctor.save(session ? { session } : undefined);
      return {
        result: doctor,
        rollback: async () => {
          if (originalValues.name !== undefined) doctor.name = originalValues.name;
          if (originalValues.specialization !== undefined) {
            doctor.specialization = originalValues.specialization;
          }
          await doctor.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordDoctorUpdated({
            adminUser,
            doctorId: doctor._id,
            updatedFields: updates,
            session,
          });
        }
      : null
  );

  return toAdminDoctorDto(updatedDoctor);
};

/**
 * Activates or deactivates an existing Doctor record (AC9, AC14).
 *
 * @param {string} doctorId
 * @param {boolean|string} isActive
 * @param {Object} [adminUser]
 * @returns {Promise<Object>}
 */
const updateDoctorStatus = async (doctorId, isActive, adminUser = null) => {
  if (!doctorId || typeof doctorId !== 'string' || !mongoose.isValidObjectId(doctorId)) {
    throw new ValidationError('Invalid doctor identifier.', { field: 'id' });
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

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    throw new NotFoundError('Doctor not found.');
  }

  const oldStatus = doctor.isActive !== false;

  const updatedDoctor = await executeAdministrativeMutationWithAudit(
    async (session) => {
      doctor.isActive = normalizedStatus;
      await doctor.save(session ? { session } : undefined);
      return {
        result: doctor,
        rollback: async () => {
          doctor.isActive = oldStatus;
          await doctor.save();
        },
      };
    },
    adminUser
      ? async (session) => {
          await recordDoctorStatusToggled({
            adminUser,
            doctorId: doctor._id,
            oldStatus,
            newStatus: normalizedStatus,
            session,
          });
        }
      : null
  );

  return toAdminDoctorDto(updatedDoctor);
};

module.exports = {
  toDoctorDto,
  toAdminDoctorDto,
  createDoctor,
  listDoctors,
  listAllDoctorsAdmin,
  getDoctorById,
  updateDoctor,
  updateDoctorStatus,
};
