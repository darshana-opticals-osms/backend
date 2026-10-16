const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required.'],
      trim: true,
      maxlength: [100, 'name must not exceed 100 characters.'],
      validate: {
        validator(value) {
          return typeof value === 'string' && value.trim().length > 0;
        },
        message: 'name must be a non-empty string.',
      },
    },
    specialization: {
      type: String,
      required: [true, 'specialization is required.'],
      trim: true,
      maxlength: [100, 'specialization must not exceed 100 characters.'],
      validate: {
        validator(value) {
          return typeof value === 'string' && value.trim().length > 0;
        },
        message: 'specialization must be a non-empty string.',
      },
    },
  },
  {
    timestamps: true,
  }
);

doctorSchema.index({ name: 1, _id: 1 }, { name: 'doctor_name_id_deterministic_index' });

module.exports = mongoose.model('Doctor', doctorSchema);
