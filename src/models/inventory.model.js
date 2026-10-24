const mongoose = require('mongoose');
const { ITEM_CLASSIFICATIONS } = require('../constants/itemClassification');

const inventorySchema = new mongoose.Schema(
  {
    // MongoDB's _id is the Inventory identifier defined by the SDS.
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'branchId is required.'],
      index: true,
    },
    itemName: {
      type: String,
      required: [true, 'itemName is required.'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'category is required.'],
      trim: true,
    },
    // Manager-maintained explicit classification; legacy records remain unresolved.
    itemClassification: { type: String, enum: ITEM_CLASSIFICATIONS, default: 'UNKNOWN' },
    brand: {
      type: String,
      required: [true, 'brand is required.'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'price is required.'],
      min: [0, 'Price cannot be negative.'],
    },
    quantity: {
      type: Number,
      required: [true, 'quantity is required.'],
      min: [0, 'Quantity cannot be negative.'],
    },
    imageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    imagePublicId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

inventorySchema.index({ branchId: 1, quantity: 1, itemName: 1, _id: 1 });
inventorySchema.index({ branchId: 1, category: 1, quantity: 1, itemName: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);
