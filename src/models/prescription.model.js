const mongoose = require('mongoose');

const eyeDistanceSchema = new mongoose.Schema(
  {
    sph: { type: Number, default: null },
    cyl: { type: Number, default: null },
    axis: {
      type: Number,
      default: null,
      min: [0, 'Axis must be greater than or equal to 0.'],
      max: [180, 'Axis must be less than or equal to 180.'],
    },
    va: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const eyeReadingSchema = new mongoose.Schema(
  {
    add: { type: Number, default: null },
    nearVa: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const eyePrescriptionSchema = new mongoose.Schema(
  {
    distance: { type: eyeDistanceSchema, default: () => ({}) },
    reading: { type: eyeReadingSchema, default: () => ({}) },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'customerId is required.'],
      index: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: [true, 'recordedBy is required.'],
      index: true,
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      required: [true, 'recordedAt is required.'],
    },
    rightEye: {
      type: eyePrescriptionSchema,
      default: () => ({}),
    },
    leftEye: {
      type: eyePrescriptionSchema,
      default: () => ({}),
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
