const mongoose = require('mongoose');
const { APPOINTMENT_STATUSES } = require('../constants/appointmentStatuses');

const appointmentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    dateTime: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      required: true,
      enum: APPOINTMENT_STATUSES,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Appointment', appointmentSchema);
