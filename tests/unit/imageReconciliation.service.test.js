const mongoose = require('mongoose');
const {
  reconcileFailedCleanups,
  reconcileAbandonedUploads,
  runImageReconciliation,
  MAX_CLEANUP_ATTEMPTS,
} = require('../../src/services/imageReconciliation.service');
const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../../src/models/imageUpload.model');
const { deleteImage } = require('../../src/services/imageUpload.service');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');

jest.mock('../../src/services/imageUpload.service', () => ({
  deleteImage: jest.fn(),
  INVENTORY_IMAGE_FOLDER: 'osms/inventory',
}));

describe('Image Reconciliation Service Unit Tests', () => {
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await ImageUpload.deleteMany({});
  });

  describe('reconcileFailedCleanups', () => {
    it('retries failed cleanup and marks status as DELETED upon successful deletion', async () => {
      const mockRecord = await ImageUpload.create({
        publicId: 'osms/inventory/failed-asset-1',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/failed-asset-1.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP,
        cleanupAttempts: 1,
        lastCleanupError: 'Initial failure',
      });

      deleteImage.mockResolvedValueOnce({ success: true, result: 'ok' });

      const result = await reconcileFailedCleanups();

      expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
      expect(deleteImage).toHaveBeenCalledWith(mockRecord.publicId);

      const updatedRecord = await ImageUpload.findById(mockRecord._id);
      expect(updatedRecord.status).toBe(IMAGE_UPLOAD_STATUS.DELETED);
      expect(updatedRecord.cleanupAttempts).toBe(2);
      expect(updatedRecord.lastCleanupError).toBeNull();
    });

    it('records sanitized error and keeps FAILED_CLEANUP when provider throws', async () => {
      const mockRecord = await ImageUpload.create({
        publicId: 'osms/inventory/failed-asset-2',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/failed-asset-2.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP,
        cleanupAttempts: 1,
      });

      deleteImage.mockRejectedValueOnce(
        new Error('Cloudinary timeout with api_secret=SECRET_VAL_123')
      );

      const result = await reconcileFailedCleanups();

      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });

      const updatedRecord = await ImageUpload.findById(mockRecord._id);
      expect(updatedRecord.status).toBe(IMAGE_UPLOAD_STATUS.FAILED_CLEANUP);
      expect(updatedRecord.cleanupAttempts).toBe(2);
      expect(updatedRecord.lastCleanupError).not.toContain('SECRET_VAL_123');
      expect(updatedRecord.lastCleanupError).toContain('[REDACTED]');
    });

    it('warns when asset reaches maximum cleanup attempts', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const mockRecord = await ImageUpload.create({
        publicId: 'osms/inventory/failed-asset-max',
        imageUrl:
          'https://res.cloudinary.com/test/image/upload/osms/inventory/failed-asset-max.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP,
        cleanupAttempts: MAX_CLEANUP_ATTEMPTS - 1,
      });

      deleteImage.mockRejectedValueOnce(new Error('Persistent provider failure'));

      const result = await reconcileFailedCleanups();

      expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('reached maximum cleanup attempts')
      );

      const updatedRecord = await ImageUpload.findById(mockRecord._id);
      expect(updatedRecord.cleanupAttempts).toBe(MAX_CLEANUP_ATTEMPTS);

      warnSpy.mockRestore();
    });

    it('skips assets that have already reached maximum cleanup attempts', async () => {
      await ImageUpload.create({
        publicId: 'osms/inventory/abandoned-max-reached',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/abandoned.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP,
        cleanupAttempts: MAX_CLEANUP_ATTEMPTS,
      });

      const result = await reconcileFailedCleanups();

      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
      expect(deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('reconcileAbandonedUploads', () => {
    it('purges abandoned uploads older than threshold and marks them as DELETED', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const abandonedRecord = await ImageUpload.create({
        publicId: 'osms/inventory/abandoned-old',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/abandoned-old.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.PENDING,
        createdAt: threeHoursAgo,
      });

      // Recent upload (10 mins old)
      await ImageUpload.create({
        publicId: 'osms/inventory/recent-pending',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/recent-pending.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.PENDING,
        createdAt: new Date(),
      });

      deleteImage.mockResolvedValueOnce({ success: true, result: 'ok' });

      const result = await reconcileAbandonedUploads(2 * 60 * 60 * 1000);

      expect(result).toEqual({ attempted: 1, purged: 1, failed: 0 });
      expect(deleteImage).toHaveBeenCalledWith(abandonedRecord.publicId);

      const updatedRecord = await ImageUpload.findById(abandonedRecord._id);
      expect(updatedRecord.status).toBe(IMAGE_UPLOAD_STATUS.DELETED);

      // Verify recent record remained PENDING
      const recentRecord = await ImageUpload.findOne({ publicId: 'osms/inventory/recent-pending' });
      expect(recentRecord.status).toBe(IMAGE_UPLOAD_STATUS.PENDING);
    });

    it('transitions to FAILED_CLEANUP when purging abandoned upload fails', async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const record = await ImageUpload.create({
        publicId: 'osms/inventory/abandoned-fail',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/osms/inventory/abandoned-fail.jpg',
        uploadedBy: new mongoose.Types.ObjectId(),
        status: IMAGE_UPLOAD_STATUS.PENDING,
        createdAt: threeHoursAgo,
      });

      deleteImage.mockRejectedValueOnce(new Error('Cloudinary unavailable'));

      const result = await reconcileAbandonedUploads(2 * 60 * 60 * 1000);

      expect(result).toEqual({ attempted: 1, purged: 0, failed: 1 });

      const updatedRecord = await ImageUpload.findById(record._id);
      expect(updatedRecord.status).toBe(IMAGE_UPLOAD_STATUS.FAILED_CLEANUP);
      expect(updatedRecord.cleanupAttempts).toBe(1);
    });
  });

  describe('runImageReconciliation', () => {
    it('executes both failed cleanups and abandoned uploads passes safely', async () => {
      const report = await runImageReconciliation();

      expect(report).toBeDefined();
      expect(report.failedCleanups).toBeDefined();
      expect(report.abandonedUploads).toBeDefined();
    });

    it('catches and logs error safely without throwing unhandled exceptions', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const findSpy = jest.spyOn(ImageUpload, 'find').mockRejectedValueOnce(new Error('DB crash'));

      const report = await runImageReconciliation();

      expect(report).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ImageReconciliation] Error executing image reconciliation:'),
        'DB crash'
      );

      errorSpy.mockRestore();
      findSpy.mockRestore();
    });
  });
});
