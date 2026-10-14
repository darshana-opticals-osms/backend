const multer = require('multer');
const { AppError } = require('../errors/AppError');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per DDP-076
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

/**
 * Validates the image buffer against magic byte signatures for JPEG, PNG, and WebP.
 *
 * @param {Buffer} buffer - File buffer.
 * @param {string} mimetype - MIME type from client.
 * @returns {boolean} True if binary signature matches allowed types.
 */
function isValidImageBuffer(buffer, mimetype) {
  if (!buffer || buffer.length < 12) {
    return false;
  }

  // JPEG: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  // WebP: RIFF at 0..3 and WEBP at 8..11
  const isWebp =
    buffer.toString('utf8', 0, 4) === 'RIFF' && buffer.toString('utf8', 8, 12) === 'WEBP';

  if ((mimetype === 'image/jpeg' || mimetype === 'image/jpg') && isJpeg) {
    return true;
  }
  if (mimetype === 'image/png' && isPng) {
    return true;
  }
  if (mimetype === 'image/webp' && isWebp) {
    return true;
  }

  return false;
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(
        new AppError(
          'Unsupported image format. Allowed formats: JPEG, PNG, WebP.',
          400,
          null,
          'UNSUPPORTED_IMAGE_FORMAT'
        )
      );
    }
    cb(null, true);
  },
}).single('image');

/**
 * Express middleware for single image multipart upload with strict validation.
 */
const uploadImageMiddleware = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError('Image file size exceeds the 5MB limit.', 400, null, 'FILE_TOO_LARGE')
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(
            new AppError(
              'Unexpected upload field. Expected a single file under "image".',
              400,
              null,
              'UNEXPECTED_UPLOAD_FIELD'
            )
          );
        }
        return next(new AppError(`File upload error: ${err.message}`, 400, null, 'UPLOAD_ERROR'));
      }
      return next(err);
    }

    if (!req.file) {
      return next(new AppError('No image file provided.', 400, null, 'MISSING_IMAGE_FILE'));
    }

    if (!isValidImageBuffer(req.file.buffer, req.file.mimetype)) {
      return next(
        new AppError(
          'Unsupported or corrupted image content. Allowed formats: JPEG, PNG, WebP.',
          400,
          null,
          'UNSUPPORTED_IMAGE_FORMAT'
        )
      );
    }

    next();
  });
};

module.exports = {
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  isValidImageBuffer,
  uploadImageMiddleware,
};
