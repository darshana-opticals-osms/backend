const mongoose = require('mongoose');
const { PAYHERE_STATUS_CODE_VALUES, PAYMENT_PROVIDER } = require('../constants/payment');

const PAYMENT_EVENT_ACTIONS = Object.freeze(['applied', 'duplicate', 'reconciliation_required']);

const paymentEventSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.PAYHERE,
      required: true,
    },
    providerOrderId: { type: String, required: true, immutable: true },
    providerTransactionId: { type: String, default: null },
    statusCode: {
      type: String,
      enum: PAYHERE_STATUS_CODE_VALUES,
      required: true,
      immutable: true,
    },
    amount: { type: String, required: true, immutable: true },
    currency: { type: String, required: true, immutable: true },
    action: {
      type: String,
      enum: PAYMENT_EVENT_ACTIONS,
      required: true,
    },
    reason: { type: String, default: null, maxlength: 100 },
    verifiedAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentEvent', paymentEventSchema);
