const mongoose = require('mongoose');
const {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_PROVIDER_VALUES,
  DELIVERY_STATUS_VALUES,
  DELIVERY_STATUS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PROVIDERS,
} = require('../constants/orderNotification');
const { ORDER_STATUSES } = require('../constants/orderStatuses');

/**
 * OrderNotification Mongoose Schema
 *
 * Implements ADR-013 Section 11 (Notification Persistence Model):
 * - Lightweight, dedicated collection: `order_notifications`
 * - Guarantees idempotency via unique index on `idempotencyKey`
 * - Tracks delivery metadata, provider message IDs, attempt counts, and error codes
 * - Excludes full raw email bodies, clinical data, and payment secrets.
 */
const orderNotificationSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    triggerStatus: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: NOTIFICATION_CHANNEL_VALUES,
      default: NOTIFICATION_CHANNELS.EMAIL,
      required: true,
    },
    deliveryStatus: {
      type: String,
      enum: DELIVERY_STATUS_VALUES,
      default: DELIVERY_STATUS.PENDING,
      required: true,
    },
    provider: {
      type: String,
      enum: NOTIFICATION_PROVIDER_VALUES,
      default: NOTIFICATION_PROVIDERS.AWS_SES,
      required: true,
    },
    providerMessageId: {
      type: String,
      default: null,
      trim: true,
    },
    attempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
    errorCode: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    collection: 'order_notifications',
    timestamps: true,
  }
);

// Compound indexes defined in ADR-013 Section 11.1
orderNotificationSchema.index({ idempotencyKey: 1 }, { unique: true });
orderNotificationSchema.index({ orderId: 1, createdAt: -1 });
orderNotificationSchema.index({ deliveryStatus: 1, createdAt: -1 });

module.exports = mongoose.model('OrderNotification', orderNotificationSchema);
