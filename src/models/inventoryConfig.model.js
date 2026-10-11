const mongoose = require('mongoose');

const inventoryConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'key is required.'],
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'value is required.'],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('InventoryConfig', inventoryConfigSchema);
