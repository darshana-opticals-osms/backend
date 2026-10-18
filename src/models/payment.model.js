const mongoose = require('mongoose');
const {
  PAYMENT_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
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

    currency: {
      type: String,
      enum: Object.values(PAYMENT_CURRENCY),
      default: PAYMENT_CURRENCY.LKR,
      required: true,
    },

    paidAt: {
      type: Date,
      default: null,
      index: true,
    },

    refundedAt: {
      type: Date,
      default: null,
      index: true,
    },

    refundAmount: {
      type: Number,
      default: 0,
      min: [0, 'Refund amount cannot be negative.'],
    },

    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.PAYHERE,
      required: true,
    },

    // Unique merchant reference sent to PayHere as order_id. Optional only for
    // backwards compatibility with Payment documents created before DDP-055.
    providerOrderId: {
      type: String,
      trim: true,
      default: null,
      immutable: true,
    },

    providerPaymentMethod: {
      type: String,
      trim: true,
      default: null,
      maxlength: 40,
    },

    failureReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 200,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    reconciliationRequired: {
      type: Boolean,
      default: false,
      index: true,
    },

    reconciliationReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 100,
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

paymentSchema.index(
  { providerOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerOrderId: { $type: 'string' } },
  }
);

paymentSchema.index(
  { providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionId: { $type: 'string' } },
  }
);

paymentSchema.index(
  { orderId: 1 },
  {
    name: 'one_active_payment_per_order',
    unique: true,
    partialFilterExpression: {
      status: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] },
    },
  }
);

paymentSchema.index(
  { orderId: 1 },
  {
    name: 'one_completed_payment_per_order',
    unique: true,
    partialFilterExpression: { status: PAYMENT_STATUS.COMPLETED },
  }
);

module.exports = mongoose.model('Payment', paymentSchema);
