const mongoose = require('mongoose');
const {
  PAYMENT_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS,
} = require('../constants/payment');

const paymentSchema = new mongoose.Schema(
  {
    // AC2: Order Relationship — Payment must reference an Order
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'orderId is required.'],
      index: true,
    },

    // AC3: Payment Amount — non-negative numeric value
    amount: {
      type: Number,
      required: [true, 'amount is required.'],
      min: [0, 'Payment amount cannot be negative.'],
    },

    // AC4: Payment Status — controlled values only
    status: {
      type: String,
      enum: {
        values: PAYMENT_STATUS_VALUES,
        message: 'status must be one of: ' + PAYMENT_STATUS_VALUES.join(', ') + '.',
      },
      required: [true, 'status is required.'],
      default: PAYMENT_STATUS.PENDING,
    },

    // AC5: Payment Method — controlled values only
    method: {
      type: String,
      enum: {
        values: PAYMENT_METHOD_VALUES,
        message: 'method must be one of: ' + PAYMENT_METHOD_VALUES.join(', ') + '.',
      },
      required: [true, 'method is required.'],
    },

    // AC6: Transaction Traceability — external provider reference ID
    providerTransactionId: {
      type: String,
      trim: true,
      default: null,
    },

    // AC9: Sensitive Data Protection
    // Raw card numbers, CVV, or plain-text card credentials must NEVER be stored.
    // Only gateway-safe reference IDs are persisted via providerTransactionId.
  },
  {
    // AC8: Payment Timestamps — createdAt and updatedAt maintained automatically
    timestamps: true,
  }
);

module.exports = mongoose.model('Payment', paymentSchema);
