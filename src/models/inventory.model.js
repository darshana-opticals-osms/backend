const mongoose = require('mongoose');

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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Inventory', inventorySchema);
