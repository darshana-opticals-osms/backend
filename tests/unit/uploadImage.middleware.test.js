const request = require('supertest');
const express = require('express');
const {
  isValidImageBuffer,
  uploadImageMiddleware,
  MAX_IMAGE_SIZE_BYTES,
} = require('../../src/middleware/uploadImage');
const errorHandler = require('../../src/middleware/errorHandler');

describe('UploadImage Middleware Unit Tests', () => {
  describe('isValidImageBuffer', () => {
    it('should validate valid JPEG magic bytes', () => {
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      expect(isValidImageBuffer(jpegBuffer, 'image/jpeg')).toBe(true);
      expect(isValidImageBuffer(jpegBuffer, 'image/jpg')).toBe(true);
    });

    it('should validate valid PNG magic bytes', () => {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      expect(isValidImageBuffer(pngBuffer, 'image/png')).toBe(true);
    });

    it('should validate valid WebP magic bytes', () => {
      const webpHeader = Buffer.alloc(16);
      webpHeader.write('RIFF', 0, 4, 'utf8');
      webpHeader.write('WEBP', 8, 4, 'utf8');
      expect(isValidImageBuffer(webpHeader, 'image/webp')).toBe(true);
    });

    it('should reject spoofed image content (e.g. text file labeled as image/jpeg)', () => {
      const fakeBuffer = Buffer.from('console.log("not an image")');
      expect(isValidImageBuffer(fakeBuffer, 'image/jpeg')).toBe(false);
    });

    it('should reject short or empty buffers', () => {
      expect(isValidImageBuffer(Buffer.from('short'), 'image/jpeg')).toBe(false);
      expect(isValidImageBuffer(null, 'image/jpeg')).toBe(false);
    });
  });

  describe('uploadImageMiddleware HTTP behavior', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.post('/test-upload', uploadImageMiddleware, (req, res) => {
        res.status(200).json({ success: true, filename: req.file.originalname });
      });
      app.use(errorHandler);
    });

    it('should accept a valid JPEG image file', async () => {
      const validJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00,
      ]);

      const res = await request(app)
        .post('/test-upload')
        .attach('image', validJpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBe('test.jpg');
    });

    it('should reject missing file with 400 MISSING_IMAGE_FILE', async () => {
      const res = await request(app).post('/test-upload');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_IMAGE_FILE');
    });

    it('should reject unsupported MIME type with 400 UNSUPPORTED_IMAGE_FORMAT', async () => {
      const textBuffer = Buffer.from('dummy content');

      const res = await request(app)
        .post('/test-upload')
        .attach('image', textBuffer, { filename: 'test.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    });

    it('should reject file exceeding 5MB limit', async () => {
      const oversizedBuffer = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1024);
      // Give valid magic bytes
      oversizedBuffer[0] = 0xff;
      oversizedBuffer[1] = 0xd8;
      oversizedBuffer[2] = 0xff;

      const res = await request(app)
        .post('/test-upload')
        .attach('image', oversizedBuffer, { filename: 'large.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('should reject when file content does not match image magic bytes', async () => {
      const fakeJpeg = Buffer.from('This is completely plain text with image/jpeg header');

      const res = await request(app)
        .post('/test-upload')
        .attach('image', fakeJpeg, { filename: 'spoofed.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
    });
  });
});
