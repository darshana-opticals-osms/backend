const mongoose = require('mongoose');
const { STAFF_ROLE_VALUES } = require('../constants/roles');

const staffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address.'],
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number.'],
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    role: {
      type: String,
      required: true,
      enum: STAFF_ROLE_VALUES,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
      validate: {
        validator(value) {
          return typeof value === 'string' && value.length >= 60 && value.startsWith('$2');
        },
        message: 'Password hash must be a bcrypt-style hash.',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.passwordHash;
      },
    },
  }
);

module.exports = mongoose.model('Staff', staffSchema);
