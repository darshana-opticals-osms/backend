const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    orderDate: {
      type: Date,
      required: true,
    },

    orderAmount: {
      type: Number,
      required: true,
      min: [0, 'Order amount cannot be negative.'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Order', orderSchema);
