const mongoose = require('mongoose');
const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../../src/models/imageUpload.model');

describe('ImageUpload Model (Unit tests)', () => {
  const validUserId = new mongoose.Types.ObjectId();
  const validBranchId = new mongoose.Types.ObjectId();
  const validInventoryId = new mongoose.Types.ObjectId();

  it('should validate a valid ImageUpload record with defaults', async () => {
    const upload = new ImageUpload({
      publicId: 'osms/inventory/sample-image-123',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      uploadedBy: validUserId,
      branchId: validBranchId,
    });

    await expect(upload.validate()).resolves.toBeUndefined();
    expect(upload.publicId).toBe('osms/inventory/sample-image-123');
    expect(upload.status).toBe(IMAGE_UPLOAD_STATUS.PENDING);
    expect(upload.cleanupAttempts).toBe(0);
    expect(upload.inventoryId).toBeNull();
  });

  it('should enforce required fields (publicId, imageUrl, uploadedBy)', () => {
    const upload = new ImageUpload({});
    const validationError = upload.validateSync();

    expect(validationError.errors.publicId).toBeDefined();
    expect(validationError.errors.imageUrl).toBeDefined();
    expect(validationError.errors.uploadedBy).toBeDefined();
  });

  it('should reject invalid status enum', () => {
    const upload = new ImageUpload({
      publicId: 'osms/inventory/sample-image-123',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      uploadedBy: validUserId,
      status: 'INVALID_STATUS',
    });

    const validationError = upload.validateSync();
    expect(validationError.errors.status).toBeDefined();
  });

  it('should accept all defined status enums', async () => {
    for (const status of Object.values(IMAGE_UPLOAD_STATUS)) {
      const upload = new ImageUpload({
        publicId: `osms/inventory/sample-${status.toLowerCase()}`,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        uploadedBy: validUserId,
        status,
        inventoryId: status === IMAGE_UPLOAD_STATUS.ATTACHED ? validInventoryId : null,
      });

      await expect(upload.validate()).resolves.toBeUndefined();
    }
  });

  it('should reject negative cleanupAttempts', () => {
    const upload = new ImageUpload({
      publicId: 'osms/inventory/sample-image-123',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      uploadedBy: validUserId,
      cleanupAttempts: -1,
    });

    const validationError = upload.validateSync();
    expect(validationError.errors.cleanupAttempts).toBeDefined();
  });
});
