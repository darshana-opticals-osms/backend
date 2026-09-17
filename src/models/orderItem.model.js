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
      min: [0, 'Quantity cannot be negative.'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('OrderItem', orderItemSchema);
