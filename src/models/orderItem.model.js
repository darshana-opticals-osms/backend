const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
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

module.exports = mongoose.model('OrderItem', orderItemSchema);
