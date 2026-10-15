const mongoose = require('mongoose');

const doctorSessionSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      index: true,
      required: function () {
        return !this.staffId;
      },
    },
    // Retain staffId as optional for historical read/legacy compatibility (AC28)
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      index: true,
      default: null,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    startAt: {
      type: Date,
      required: true,
      index: true,
    },
    endAt: {
      type: Date,
      required: true,
      index: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: [1, 'capacity must be at least 1.'],
      validate: {
        validator(value) {
          return Number.isInteger(value) && value > 0;
        },
        message: 'capacity must be a positive integer.',
      },
    },
    confirmedCount: {
      type: Number,
      default: 0,
      min: [0, 'confirmedCount cannot be negative.'],
      validate: {
        validator(value) {
          return Number.isInteger(value) && value >= 0;
        },
        message: 'confirmedCount must be a non-negative integer.',
      },
    },
  },
  {
    timestamps: true,
  }
);

doctorSessionSchema.index(
  { doctorId: 1, startAt: 1, endAt: 1 },
  { name: 'doctor_session_doctor_overlap_index', sparse: true }
);

doctorSessionSchema.index(
  { staffId: 1, startAt: 1, endAt: 1 },
  { name: 'doctor_session_staff_overlap_index', sparse: true }
);

doctorSessionSchema.index(
  { branchId: 1, startAt: 1 },
  { name: 'doctor_session_branch_time_index' }
);

module.exports = mongoose.model('DoctorSession', doctorSessionSchema);
