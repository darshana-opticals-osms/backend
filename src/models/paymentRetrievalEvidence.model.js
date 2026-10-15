const mongoose = require('mongoose');
const { ConflictError } = require('../errors/AppError');
const {
  RETRIEVAL_STATUSES,
  RETRIEVAL_OUTCOMES,
  RETRIEVAL_REASONS,
} = require('../constants/paymentRetrieval');

const recordSchema = new mongoose.Schema(
  {
    providerTransactionId: { type: String, required: true, match: /^[A-Za-z0-9._:-]{1,120}$/ },
    providerOrderId: { type: String, required: true, match: /^[A-Za-z0-9._:-]{1,120}$/ },
    status: { type: String, required: true, enum: RETRIEVAL_STATUSES },
    amount: { type: String, required: true, match: /^\d+\.\d{2}$/ },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  },
  { _id: false, strict: 'throw' }
);
const schema = new mongoose.Schema(
  {
    observationKey: {
      type: String,
      required: true,
      immutable: true,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
    source: {
      type: String,
      enum: ['PAYHERE_RETRIEVAL_API'],
      default: 'PAYHERE_RETRIEVAL_API',
      immutable: true,
    },
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
    providerOrderId: { type: String, required: true, immutable: true },
    environment: { type: String, enum: ['sandbox', 'live'], required: true, immutable: true },
    outcome: { type: String, enum: RETRIEVAL_OUTCOMES, required: true, immutable: true },
    providerCode: { type: Number, enum: [1, 0, -1, -2], required: true, immutable: true },
    records: {
      type: [recordSchema],
      immutable: true,
      validate: (records) => records.length <= 100,
    },
    reconciliationReason: {
      type: String,
      enum: [...RETRIEVAL_REASONS, null],
      default: null,
      immutable: true,
    },
    observedAt: { type: Date, required: true, immutable: true },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
      immutable: true,
    },
  },
  { strict: 'throw', versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ paymentId: 1, observationKey: 1 }, { unique: true });
schema.index({ paymentId: 1, createdAt: -1, _id: -1 });
function rejectMutation() {
  throw new ConflictError(
    'Retrieval evidence is append-only.',
    null,
    'RETRIEVAL_EVIDENCE_APPEND_ONLY'
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
  )
    rejectMutation();
});
module.exports = mongoose.model('PaymentRetrievalEvidence', schema);
