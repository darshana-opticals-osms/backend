const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema(
  {
    // Stable persisted branch identifier for approved branch-specific workflows.
    codeName: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
      uppercase: true,
    },
    // MongoDB's _id is the Branch identifier defined by the SDS.
    address: {
      type: String,
      required: [true, 'address is required.'],
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, 'contactNumber is required.'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Branch', branchSchema);
