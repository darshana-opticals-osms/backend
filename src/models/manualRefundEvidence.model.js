const mongoose = require('mongoose');
const { MANUAL_REFUND_CHANNELS } = require('../constants/manualRefund');
const { PAYMENT_CURRENCY } = require('../constants/payment');
const { ConflictError } = require('../errors/AppError');
const { validAmount, validReference } = require('../validations/manualRefundEvidence.validation');

const schema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      immutable: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      immutable: true,
    },
    providerOrderId: { type: String, default: null, immutable: true },
    providerTransactionId: { type: String, default: null, immutable: true },
    amount: { type: Number, required: true, immutable: true, validate: validAmount },
    currency: {
      type: String,
      enum: Object.values(PAYMENT_CURRENCY),
      required: true,
      immutable: true,
    },
    // Optional factual metadata, not a mandated proof format or confirmation mechanism.
    refundChannel: {
      type: String,
      enum: [...MANUAL_REFUND_CHANNELS, null],
      default: null,
      immutable: true,
    },
    refundReference: {
      type: String,
      default: null,
      immutable: true,
      validate: (value) => value === null || validReference(value),
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      immutable: true,
      select: false,
      validate: validReference,
    },
    requestHash: {
      type: String,
      required: true,
      immutable: true,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
  },
  { strict: 'throw', versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);

// One full-refund evidence record for the Payment's canonical capture, not partial refunds.
schema.index({ paymentId: 1 }, { unique: true });
schema.index({ idempotencyKey: 1 }, { unique: true });

function rejectMutation() {
  throw new ConflictError(
    'Refund evidence is append-only; updates, deletes, replacements and batch writes are not supported.',
    null,
    'REFUND_EVIDENCE_APPEND_ONLY'
  );
}
schema.pre('save', function () {
  if (!this.isNew) rejectMutation();
});
schema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'bulkWrite',
    'insertMany',
  ],
  rejectMutation
);
schema.pre('deleteOne', { document: true, query: false }, rejectMutation);
schema.pre('aggregate', function () {
  if (
    this.pipeline().some((stage) => Object.hasOwn(stage, '$out') || Object.hasOwn(stage, '$merge'))
  ) {
    rejectMutation();
  }
});

module.exports = mongoose.model('ManualRefundEvidence', schema);
