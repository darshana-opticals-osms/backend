const mongoose = require('mongoose');
const { ConflictError } = require('../errors/AppError');
const { ITEM_CLASSIFICATIONS, LOYALTY_ELIGIBILITY } = require('../constants/itemClassification');

// Immutable checkout-time Inventory facts, never inferred from free-text category.
const classificationSnapshotSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['Inventory'], required: true, immutable: true },
    sourceInventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true,
      immutable: true,
    },
    category: { type: String, default: null, immutable: true },
    itemClassification: {
      type: String,
      enum: ITEM_CLASSIFICATIONS,
      default: 'UNKNOWN',
      immutable: true,
    },
    loyaltyEligibility: {
      type: String,
      enum: Object.values(LOYALTY_ELIGIBILITY),
      required: true,
      immutable: true,
      validate: {
        validator(value) {
          return value === LOYALTY_ELIGIBILITY[this.itemClassification];
        },
        message: 'Eligibility must match the authoritative item classification.',
      },
    },
  },
  { _id: false, strict: 'throw' }
);

const orderItemSchema = new mongoose.Schema(
  {
    // Null/missing means unresolved legacy context; never backfilled on read.
    classificationSnapshot: {
      type: classificationSnapshotSchema,
      default: null,
      immutable: true,
    },
    // Optional for backwards compatibility. Every new checkout persists this
    // exact reference so later restoration never guesses by item name.
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      default: null,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },

    itemName: {
      type: String,
      required: true,
      trim: true,
    },

    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative.'],
    },

    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be a positive integer.'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'Quantity must be a positive integer.',
      },
    },
  },
  {
    timestamps: true,
  }
);

function rejectSnapshotWrite() {
  throw new ConflictError(
    'OrderItem classification snapshots cannot be changed after creation.',
    null,
    'ORDER_ITEM_SNAPSHOT_IMMUTABLE'
  );
}
function rejectFinancialWrite() {
  throw new ConflictError(
    'Persisted OrderItem financial references and amounts cannot be changed or deleted.',
    null,
    'ORDER_ITEM_FINANCIAL_IMMUTABLE'
  );
}
const FINANCIAL_FIELDS = ['orderId', 'inventoryId', 'price', 'quantity'];
function financialPath(path) {
  return FINANCIAL_FIELDS.some((field) => path === field || path.startsWith(`${field}.`));
}
function touchesFinancial(update) {
  if (Array.isArray(update)) return true;
  if (!update || typeof update !== 'object') return false;
  return Object.entries(update).some(
    ([key, value]) =>
      financialPath(key) ||
      (key === '$rename' && Object.values(value).some((target) => financialPath(String(target)))) ||
      (key.startsWith('$') && touchesFinancial(value))
  );
}
function touchesSnapshot(update) {
  // Pipelines/replacements can erase historical context without naming the field.
  if (Array.isArray(update)) return true;
  if (!update || typeof update !== 'object') return false;
  return Object.entries(update).some(
    ([key, value]) =>
      key === 'classificationSnapshot' ||
      key.startsWith('classificationSnapshot.') ||
      (key === '$rename' &&
        Object.values(value).some(
          (target) =>
            target === 'classificationSnapshot' ||
            String(target).startsWith('classificationSnapshot.')
        )) ||
      (key.startsWith('$') && touchesSnapshot(value))
  );
}
orderItemSchema.pre('save', function () {
  if (!this.isNew && this.isModified('classificationSnapshot')) rejectSnapshotWrite();
  if (!this.isNew && FINANCIAL_FIELDS.some((field) => this.isModified(field)))
    rejectFinancialWrite();
});
orderItemSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  function () {
    if (
      this.op === 'replaceOne' ||
      this.op === 'findOneAndReplace' ||
      touchesSnapshot(this.getUpdate())
    )
      rejectSnapshotWrite();
    if (touchesFinancial(this.getUpdate())) rejectFinancialWrite();
  }
);
orderItemSchema.pre('bulkWrite', function (next, operations) {
  try {
    for (const operation of operations) {
      if (
        operation.replaceOne ||
        touchesSnapshot(operation.updateOne?.update) ||
        touchesSnapshot(operation.updateMany?.update)
      )
        rejectSnapshotWrite();
      if (
        operation.deleteOne ||
        operation.deleteMany ||
        touchesFinancial(operation.updateOne?.update) ||
        touchesFinancial(operation.updateMany?.update)
      )
        rejectFinancialWrite();
    }
    next();
  } catch (error) {
    next(error);
  }
});
orderItemSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  rejectFinancialWrite();
});
orderItemSchema.pre('deleteOne', { document: true, query: false }, function () {
  rejectFinancialWrite();
});
orderItemSchema.pre('aggregate', function () {
  if (
    this.pipeline().some((stage) => Object.hasOwn(stage, '$out') || Object.hasOwn(stage, '$merge'))
  )
    rejectSnapshotWrite();
});

module.exports = mongoose.model('OrderItem', orderItemSchema);
