const mongoose = require('mongoose');
const { ROLE_VALUES, CUSTOMER_ROLE_VALUES } = require('../constants/roles');

const customerSchema = new mongoose.Schema(
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
    address: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number.'],
    },
    role: {
      type: String,
      default: ROLE_VALUES.CUSTOMER,
      enum: CUSTOMER_ROLE_VALUES,
      immutable: true,
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

module.exports = mongoose.model('Customer', customerSchema);
