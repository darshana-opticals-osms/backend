const cloudinary = require('../../src/config/cloudinary');
const {
  uploadImage,
  deleteImage,
  INVENTORY_IMAGE_FOLDER,
} = require('../../src/services/imageUpload.service');
const { AppError } = require('../../src/errors/AppError');

jest.mock('../../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn(),
  },
}));

describe('ImageUpload Service Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadImage', () => {
    it('should successfully upload an image buffer and normalize response', async () => {
      const mockResult = {
        secure_url: 'https://res.cloudinary.com/demo/image/upload/v1234/osms/inventory/sample.jpg',
        public_id: 'osms/inventory/sample',
        api_key: 'sensitive-api-key',
        signature: 'sensitive-signature',
      };

      cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
        expect(options.folder).toBe(INVENTORY_IMAGE_FOLDER);
        expect(options.resource_type).toBe('image');
        // Simulate streaming write and callback
        return {
          end: (_buffer) => {
            callback(null, mockResult);
          },
        };
      });

      const buffer = Buffer.from('test-image-data');
      const response = await uploadImage(buffer);

      expect(response).toEqual({
        imageUrl: mockResult.secure_url,
        imagePublicId: mockResult.public_id,
      });
      // Ensure sensitive credentials are NOT returned
      expect(response.api_key).toBeUndefined();
      expect(response.signature).toBeUndefined();
    });

    it('should accept a multer file object with buffer property', async () => {
      const mockResult = {
        secure_url: 'https://res.cloudinary.com/demo/image/upload/v1234/osms/inventory/multer.jpg',
        public_id: 'osms/inventory/multer',
      };

      cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
        return {
          end: () => callback(null, mockResult),
        };
      });

      const multerFile = {
        buffer: Buffer.from('multer-file-buffer'),
        mimetype: 'image/jpeg',
      };

      const response = await uploadImage(multerFile);
      expect(response).toEqual({
        imageUrl: mockResult.secure_url,
        imagePublicId: mockResult.public_id,
      });
    });

    it('should throw BadRequestError if buffer is missing or invalid', async () => {
      await expect(uploadImage(null)).rejects.toThrow(AppError);
      await expect(uploadImage({})).rejects.toThrow(AppError);
      await expect(uploadImage('not-a-buffer')).rejects.toThrow(AppError);
    });

    it('should handle Cloudinary upload failure safely without exposing sensitive details', async () => {
      cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
        return {
          end: () =>
            callback(new Error('Cloudinary internal connection error with api_secret=xyz')),
        };
      });

      const buffer = Buffer.from('test-image');

      await expect(uploadImage(buffer)).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'PROVIDER_ERROR',
        message: 'Image upload failed. Upload provider unavailable.',
      });
    });
  });

  describe('deleteImage', () => {
    it('should successfully delete an image belonging to the inventory namespace', async () => {
      cloudinary.uploader.destroy.mockResolvedValue({ result: 'ok' });

      const result = await deleteImage('osms/inventory/item-123');

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('osms/inventory/item-123', {
        resource_type: 'image',
      });
      expect(result).toEqual({ success: true, result: 'ok' });
    });

    it('should throw error if publicId is missing or empty', async () => {
      await expect(deleteImage('')).rejects.toThrow(AppError);
      await expect(deleteImage(null)).rejects.toThrow(AppError);
    });

    it('should reject deletion of publicId outside the inventory namespace', async () => {
      await expect(deleteImage('malicious/other-folder/item')).rejects.toMatchObject({
        statusCode: 403,
        errorCode: 'INVALID_ASSET_NAMESPACE',
      });
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it('should handle Cloudinary deletion failure safely', async () => {
      cloudinary.uploader.destroy.mockRejectedValue(new Error('Provider timeout'));

      await expect(deleteImage('osms/inventory/item-123')).rejects.toMatchObject({
        statusCode: 502,
        errorCode: 'PROVIDER_ERROR',
      });
    });
  });
});
