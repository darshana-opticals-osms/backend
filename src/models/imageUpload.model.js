const mongoose = require('mongoose');

const IMAGE_UPLOAD_STATUS = {
  PENDING: 'PENDING',
  ATTACHED: 'ATTACHED',
  FAILED_CLEANUP: 'FAILED_CLEANUP',
  DELETED: 'DELETED',
};

const imageUploadSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      required: [true, 'publicId is required.'],
      unique: true,
      trim: true,
      index: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'imageUrl is required.'],
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'uploadedBy is required.'],
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: Object.values(IMAGE_UPLOAD_STATUS),
        message: 'status must be PENDING, ATTACHED, FAILED_CLEANUP, or DELETED.',
      },
      default: IMAGE_UPLOAD_STATUS.PENDING,
      index: true,
    },
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      default: null,
      index: true,
    },
    cleanupAttempts: {
      type: Number,
      default: 0,
      min: [0, 'cleanupAttempts cannot be negative.'],
    },
    lastCleanupError: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const ImageUpload = mongoose.model('ImageUpload', imageUploadSchema);

module.exports = {
  ImageUpload,
  IMAGE_UPLOAD_STATUS,
};
