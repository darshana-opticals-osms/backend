const mongoose = require('mongoose');
const { ORDER_STATUSES, ORDER_STATUS_VALUES } = require('../constants/orderStatuses');

const orderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
    },
    changedAt: {
      type: Date,
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required() {
        return !['PAYMENT_SYSTEM', 'RESERVATION_EXPIRY'].includes(this.source);
      },
    },
    source: {
      type: String,
      enum: ['USER', 'PAYMENT_SYSTEM', 'RESERVATION_EXPIRY'],
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },

    orderDate: {
      type: Date,
      required: true,
    },

    orderAmount: {
      type: Number,
      required: true,
      min: [0, 'Order amount cannot be negative.'],
    },
    orderAddress: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: ORDER_STATUS_VALUES.ORDER_CREATED,
    },
    statusUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    statusHistory: {
      type: [orderStatusHistorySchema],
      default: [],
    },
    reservationExpiresAt: {
      type: Date,
      default: null,
      immutable: true,
      index: true,
    },
    inventoryRestoredAt: {
      type: Date,
      default: null,
    },
    claimedAt: {
      type: Date,
      default: null,
      index: true,
    },
    claimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ status: 1, reservationExpiresAt: 1, _id: 1 });

module.exports = mongoose.model('Order', orderSchema);
