const mongoose = require('mongoose');
const { REORDER_ALERT_STATUS } = require('../constants/inventoryAlert.constants');

const reorderAlertSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: [true, 'inventoryId is required.'],
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'branchId is required.'],
      index: true,
    },
    currentQuantity: {
      type: Number,
      required: [true, 'currentQuantity is required.'],
      min: [0, 'currentQuantity cannot be negative.'],
    },
    threshold: {
      type: Number,
      required: [true, 'threshold is required.'],
      min: [0, 'threshold cannot be negative.'],
    },
    status: {
      type: String,
      enum: {
        values: Object.values(REORDER_ALERT_STATUS),
        message: 'Invalid alert status.',
      },
      default: REORDER_ALERT_STATUS.ACTIVE,
      index: true,
    },
    lastReminderSentAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate ACTIVE alerts for the same inventory record
reorderAlertSchema.index(
  { inventoryId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: REORDER_ALERT_STATUS.ACTIVE } }
);

// Compound index for querying active alerts by branch
reorderAlertSchema.index({ branchId: 1, status: 1 });

module.exports = mongoose.model('ReorderAlert', reorderAlertSchema);
