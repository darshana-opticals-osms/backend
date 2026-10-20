const mongoose = require('mongoose');
const Doctor = require('../models/doctor.model');
const { NotFoundError, ValidationError } = require('../errors/AppError');
const { recordDoctorUpdated, recordDoctorStatusToggled } = require('./adminAudit.service');

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
    doctor.name = trimmed;
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
    doctor.specialization = trimmed;
  }

  await doctor.save();

  if (adminUser) {
    await recordDoctorUpdated({
      adminUser,
      doctorId: doctor._id,
      updatedFields: updates,
    });
  }

  return toAdminDoctorDto(doctor);
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
  doctor.isActive = normalizedStatus;
  await doctor.save();

  if (adminUser) {
    await recordDoctorStatusToggled({
      adminUser,
      doctorId: doctor._id,
      oldStatus,
      newStatus: normalizedStatus,
    });
  }

  return toAdminDoctorDto(doctor);
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
