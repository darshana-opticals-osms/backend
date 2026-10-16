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

/**
 * Persists a new Doctor (AC5, AC6, AC7).
 *
 * @param {{ name: string, specialization: string }} payload
 * @returns {Promise<{ id: string, name: string, specialization: string }>}
 */
const createDoctor = async ({ name, specialization }) => {
  const doctor = await Doctor.create({
    name: name.trim(),
    specialization: specialization.trim(),
  });

  return toDoctorDto(doctor);
};

/**
 * Retrieves the authoritative Doctor directory sorted deterministically (AC9, AC11, AC12, AC13).
 * Sorting: name ascending, _id ascending tie-breaker.
 *
 * @returns {Promise<Array<{ id: string, name: string, specialization: string }>>}
 */
const listDoctors = async () => {
  const doctors = await Doctor.find().sort({ name: 1, _id: 1 }).lean();

  return doctors.map(toDoctorDto);
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
  createDoctor,
  listDoctors,
  getDoctorById,
};
