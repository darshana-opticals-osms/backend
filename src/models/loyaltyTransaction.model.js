const mongoose = require('mongoose');
const { LOYALTY_EVENT_TYPE } = require('../constants/loyalty');
const { isPoints, toMinor } = require('../utils/loyaltyDecimal');
const { ForbiddenError } = require('../errors/AppError');

const schema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      immutable: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      immutable: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      immutable: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: Object.values(LOYALTY_EVENT_TYPE),
      required: true,
      immutable: true,
    },
    sourceEventId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    earningTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoyaltyTransaction',
      default: null,
      immutable: true,
    },
    providerTransactionId: { type: String, required: true, immutable: true },
    eligibleSpend: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      immutable: true,
      validate: (value) => value === null || isPoints(value),
    },
    pointsDelta: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      immutable: true,
      validate: isPoints,
    },
    balanceAfter: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      immutable: true,
      validate: isPoints,
    },
    createdAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  { strict: 'throw', versionKey: false }
);

schema.index({ sourceEventId: 1, eventType: 1 }, { unique: true });
schema.index(
  { paymentId: 1, eventType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      eventType: { $in: [LOYALTY_EVENT_TYPE.EARN_PURCHASE, LOYALTY_EVENT_TYPE.REFUND_REVERSAL] },
    },
  }
);
schema.pre('validate', function () {
  if (!isPoints(this.pointsDelta)) return;
  const delta = toMinor(this.pointsDelta);
  if (
    this.eventType === LOYALTY_EVENT_TYPE.EARN_PURCHASE &&
    (delta < 0n || this.eligibleSpend === null)
  )
    this.invalidate(
      'pointsDelta',
      'Earning requires nonnegative points and authoritative eligible spend.'
    );
  if (
    this.eventType === LOYALTY_EVENT_TYPE.REFUND_REVERSAL &&
    (delta > 0n || !this.earningTransactionId)
  )
    this.invalidate(
      'pointsDelta',
      'Reversal must reference its earning and compensate its points.'
    );
});

function rejectWrite() {
  throw new ForbiddenError(
    'Loyalty history is service-written and append-only.',
    null,
    'LOYALTY_WRITE_FORBIDDEN'
  );
}
// Trusted service validates documents then inserts through the transaction-bound native collection.
// No direct ODM/manual adjustment path. Privileged raw DB access remains an operational boundary.
schema.pre(
  [
    'save',
    'insertMany',
    'bulkWrite',
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ],
  rejectWrite
);
schema.pre('deleteOne', { document: true, query: false }, rejectWrite);
schema.pre('aggregate', function () {
  if (
    this.pipeline().some((stage) => Object.hasOwn(stage, '$out') || Object.hasOwn(stage, '$merge'))
  )
    rejectWrite();
});

module.exports = mongoose.model('LoyaltyTransaction', schema);
