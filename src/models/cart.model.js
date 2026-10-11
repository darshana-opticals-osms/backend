const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: [true, 'inventoryId is required.'],
    },
    quantity: {
      type: Number,
      required: [true, 'quantity is required.'],
      min: [1, 'quantity must be a positive integer.'],
      validate: {
        validator: Number.isSafeInteger,
        message: 'quantity must be a positive integer.',
      },
    },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'customerId is required.'],
      unique: true,
    },
    items: {
      type: [cartItemSchema],
      required: [true, 'A Cart must contain at least one item.'],
      validate: [
        {
          validator(items) {
            return Array.isArray(items) && items.length > 0;
          },
          message: 'A Cart must contain at least one item.',
        },
        {
          validator(items) {
            const inventoryIds = items.map((item) => item.inventoryId.toString());
            return new Set(inventoryIds).size === inventoryIds.length;
          },
          message: 'A Cart cannot contain duplicate Inventory items.',
        },
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
