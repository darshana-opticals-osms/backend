const mongoose = require('mongoose');
const { APPOINTMENT_STATUSES } = require('../constants/appointmentStatuses');

const appointmentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },

    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      index: true,
    },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorSession',
      index: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      index: true,
    },

    dateTime: {
      type: Date,
      required: true,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: APPOINTMENT_STATUSES,
      index: true,
    },

    position: {
      type: Number,
      default: null,
      min: 1,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

appointmentSchema.index(
  { sessionId: 1, position: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sessionId: { $type: 'objectId' },
      position: { $type: 'number' },
    },
    name: 'appointment_session_position_unique',
  }
);

module.exports = mongoose.model('Appointment', appointmentSchema);
