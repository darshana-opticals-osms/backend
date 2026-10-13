const cloudinary = require('../config/cloudinary');
const { AppError } = require('../errors/AppError');

const INVENTORY_IMAGE_FOLDER = 'osms/inventory';

/**
 * Upload an image buffer to Cloudinary using a memory stream.
 *
 * @param {Buffer|{ buffer: Buffer }} fileOrBuffer - Multer file object or raw Buffer.
 * @param {object} [customOptions={}] - Additional upload options (override folder restricted).
 * @returns {Promise<{ imageUrl: string, imagePublicId: string }>} Normalized image metadata.
 */
async function uploadImage(fileOrBuffer, customOptions = {}) {
  let buffer;
  if (Buffer.isBuffer(fileOrBuffer)) {
    buffer = fileOrBuffer;
  } else if (fileOrBuffer && Buffer.isBuffer(fileOrBuffer.buffer)) {
    buffer = fileOrBuffer.buffer;
  }

  if (!buffer) {
    throw new AppError(
      'A valid image buffer is required for upload.',
      400,
      null,
      'INVALID_FILE_BUFFER'
    );
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: INVENTORY_IMAGE_FOLDER,
        resource_type: 'image',
        ...customOptions,
      },
      (error, result) => {
        if (error || !result) {
          return reject(
            new AppError(
              'Image upload failed. Upload provider unavailable.',
              502,
              null,
              'PROVIDER_ERROR'
            )
          );
        }

        // Return only safe normalized metadata required by the frontend
        resolve({
          imageUrl: result.secure_url,
          imagePublicId: result.public_id,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete an image asset from Cloudinary by its publicId.
 *
 * @param {string} publicId - The Cloudinary public ID of the asset.
 * @returns {Promise<{ success: boolean, result: string }>} Deletion result.
 */
async function deleteImage(publicId) {
  if (!publicId || typeof publicId !== 'string') {
    throw new AppError(
      'Valid image public ID is required for deletion.',
      400,
      null,
      'INVALID_PUBLIC_ID'
    );
  }

  // Safety check: ensure publicId belongs to the controlled osms/inventory namespace
  if (!publicId.startsWith(INVENTORY_IMAGE_FOLDER)) {
    throw new AppError(
      'Image deletion restricted to controlled inventory namespace.',
      403,
      null,
      'INVALID_ASSET_NAMESPACE'
    );
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return {
      success: result?.result === 'ok' || result?.result === 'not found',
      result: result?.result || 'ok',
    };
  } catch {
    throw new AppError(
      'Image deletion failed. Upload provider unavailable.',
      502,
      null,
      'PROVIDER_ERROR'
    );
  }
}

module.exports = {
  INVENTORY_IMAGE_FOLDER,
  uploadImage,
  deleteImage,
};
