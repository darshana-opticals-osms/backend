const Doctor = require('../models/doctor.model');

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
 * @returns {Promise<Array<{ id: string, name: string, specialization: string, isActive: boolean }>>}
 */
const listAllDoctorsAdmin = async () => {
  const doctors = await Doctor.find().sort({ name: 1, _id: 1 }).lean();

  return doctors.map(toAdminDoctorDto);
};

/**
 * Retrieves a single Doctor by ObjectId (used in appointment/session flows).
 *
 * @param {string} doctorId
 * @returns {Promise<Object|null>}
 */
const getDoctorById = async (doctorId) => {
  return Doctor.findById(doctorId).lean();
};

module.exports = {
  toDoctorDto,
  toAdminDoctorDto,
  createDoctor,
  listDoctors,
  listAllDoctorsAdmin,
  getDoctorById,
};
