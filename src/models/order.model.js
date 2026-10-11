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
      required: true,
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

    orderDate: {
      type: Date,
      required: true,
    },

    orderAmount: {
      type: Number,
      required: true,
      min: [0, 'Order amount cannot be negative.'],
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Order', orderSchema);
