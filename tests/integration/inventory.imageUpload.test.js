const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { ROLE_VALUES } = require('../../src/constants/roles');
const cloudinary = require('../../src/config/cloudinary');

jest.mock('../../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn(),
  },
}));

const JWT_SECRET = 'inventory-image-test-jwt-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.BRANCH_MANAGER,
  branchId = '507f1f77bcf86cd799439022',
} = {}) =>
  jwt.sign({ userId, role, branchId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('POST /api/inventory/images - Image Upload Integration Tests', () => {
  let app;
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    app = createApp();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  ]);

  it('AC3, AC4, AC10, AC11: Branch Manager uploads valid image and receives normalized metadata', async () => {
    const mockCloudinaryResult = {
      secure_url:
        'https://res.cloudinary.com/test-cloud/image/upload/v12345/osms/inventory/sample.jpg',
      public_id: 'osms/inventory/sample',
      api_key: 'SUPER_SECRET_KEY',
    };

    cloudinary.uploader.upload_stream.mockImplementation((options, callback) => {
      expect(options.folder).toBe('osms/inventory');
      expect(options.resource_type).toBe('image');
      return {
        end: () => callback(null, mockCloudinaryResult),
      };
    });

    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      imageUrl: mockCloudinaryResult.secure_url,
      imagePublicId: mockCloudinaryResult.public_id,
    });
    // Ensure sensitive secrets are not leaked in the payload
    expect(res.body.data.api_key).toBeUndefined();
    expect(res.text).not.toContain('SUPER_SECRET_KEY');
  });

  it('AC3: Rejects unauthenticated request with 401 Unauthorized', async () => {
    const res = await request(app).post('/api/inventory/images').attach('image', validJpegBuffer, {
      filename: 'product.jpg',
      contentType: 'image/jpeg',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('AC4: System Admin is forbidden from uploading inventory images (403)', async () => {
    const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('AC4: Branch Assistant is forbidden from uploading inventory images (403)', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_ASSISTANT });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('AC4: Optometrist is forbidden from uploading inventory images (403)', async () => {
    const token = createToken({ role: ROLE_VALUES.OPTOMETRIST });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('AC4: Customer is forbidden from uploading inventory images (403)', async () => {
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('AC5: Rejects request with missing image file (400)', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_IMAGE_FILE');
  });

  it('AC6, AC8: Rejects unsupported file format (400)', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('<svg></svg>'), {
        filename: 'vector.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT');
  });

  it('AC7: Rejects oversized image exceeding 5MB (400)', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
    oversizedBuffer[0] = 0xff;
    oversizedBuffer[1] = 0xd8;
    oversizedBuffer[2] = 0xff;

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', oversizedBuffer, {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('AC19: Handles Cloudinary provider failure safely with 502 and no secret leakage', async () => {
    cloudinary.uploader.upload_stream.mockImplementation((_options, callback) => {
      return {
        end: () =>
          callback(new Error('Cloudinary connection error with api_secret=INTERNAL_SECRET')),
      };
    });

    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    const res = await request(app)
      .post('/api/inventory/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('image', validJpegBuffer, {
        filename: 'product.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PROVIDER_ERROR');
    expect(res.text).not.toContain('INTERNAL_SECRET');
  });
});
