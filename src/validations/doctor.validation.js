const { validate } = require('../middleware/validate');

/**
 * Validation schema for Doctor creation (POST /api/doctors)
 * Enforces AC2, AC3, AC6.
 */
const createDoctorSchema = (req) => {
  const errors = [];
  const body = req.body || {};

  // Reject unsupported top-level fields (AC6)
  const allowedKeys = ['name', 'specialization'];
  const bodyKeys = Object.keys(body);
  const unknownKeys = bodyKeys.filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    errors.push({
      field: unknownKeys.join(', '),
      message: `Unsupported field(s) provided: ${unknownKeys.join(', ')}`,
    });
  }

  // Validate name (AC2)
  if (body.name === undefined || body.name === null || body.name === '') {
    errors.push({ field: 'name', message: 'name is required' });
  } else if (typeof body.name !== 'string') {
    errors.push({ field: 'name', message: 'name must be of type string' });
  } else if (!body.name.trim()) {
    errors.push({ field: 'name', message: 'name cannot be empty or whitespace only' });
  } else if (body.name.trim().length > 100) {
    errors.push({ field: 'name', message: 'name must not exceed 100 characters' });
  }

  // Validate specialization (AC3)
  if (
    body.specialization === undefined ||
    body.specialization === null ||
    body.specialization === ''
  ) {
    errors.push({ field: 'specialization', message: 'specialization is required' });
  } else if (typeof body.specialization !== 'string') {
    errors.push({ field: 'specialization', message: 'specialization must be of type string' });
  } else if (!body.specialization.trim()) {
    errors.push({
      field: 'specialization',
      message: 'specialization cannot be empty or whitespace only',
    });
  } else if (body.specialization.trim().length > 100) {
    errors.push({
      field: 'specialization',
      message: 'specialization must not exceed 100 characters',
    });
  }

  return errors;
};

const validateCreateDoctor = validate(createDoctorSchema);

module.exports = {
  validateCreateDoctor,
  createDoctorSchema,
};
