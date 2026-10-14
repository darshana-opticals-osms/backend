const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../../src/models/imageUpload.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { deleteImage } = require('../../src/services/imageUpload.service');

jest.mock('../../src/services/imageUpload.service', () => ({
  uploadImage: jest.fn(),
  deleteImage: jest.fn().mockResolvedValue({ success: true, result: 'ok' }),
  INVENTORY_IMAGE_FOLDER: 'osms/inventory',
}));

const JWT_SECRET = 'inventory-lifecycle-test-secret';
const JWT_EXPIRES_IN = '1h';

let branch;

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.BRANCH_MANAGER,
  branchId = branch ? branch._id.toString() : null,
} = {}) =>
  jwt.sign({ userId, role, ...(branchId ? { branchId } : {}) }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('Inventory Image Lifecycle & Persistence Integration Tests (DDP-076)', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await disconnectDatabase();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await ImageUpload.deleteMany({});
    await Inventory.deleteMany({});
    await Branch.deleteMany({});

    branch = await Branch.create({
      address: 'Colombo Main Branch',
      contactNumber: '+94 11 234 5678',
    });
  });

  it('AC11, AC12, AC13: Successfully creates inventory item with approved image metadata', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/sample.jpg',
      imagePublicId: 'osms/inventory/sample',
    };

    await ImageUpload.create({
      publicId: payload.imagePublicId,
      imageUrl: payload.imageUrl,
      uploadedBy: new mongoose.Types.ObjectId(),
      branchId: branch._id,
      status: IMAGE_UPLOAD_STATUS.PENDING,
    });

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imageUrl).toBe(payload.imageUrl);
    expect(res.body.data.imagePublicId).toBe(payload.imagePublicId);

    const saved = await Inventory.findById(res.body.data._id);
    expect(saved.imageUrl).toBe(payload.imageUrl);
    expect(saved.imagePublicId).toBe(payload.imagePublicId);
  });

  it('AC11: Rejects non-HTTPS image URL during inventory creation', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'http://insecure.example.com/sample.jpg',
      imagePublicId: 'osms/inventory/sample',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('AC9, AC13: Rejects imagePublicId outside the controlled inventory namespace', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/sample.jpg',
      imagePublicId: 'arbitrary-folder/sample',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('Blocker 1: Rejects imagePublicId without exact trailing slash boundary (e.g. osms/inventory_prefix)', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/sample.jpg',
      imagePublicId: 'osms/inventory_malicious/sample',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('Blocker 1: Rejects untrusted imagePublicId that was never uploaded via backend workflow', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl:
        'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/untrusted.jpg',
      imagePublicId: 'osms/inventory/untrusted',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('untrusted');
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('Blocker 1: Rejects image upload metadata belonging to another branch', async () => {
    const otherBranch = await Branch.create({
      address: 'Kandy Branch',
      contactNumber: '+94 81 234 5678',
    });

    await ImageUpload.create({
      publicId: 'osms/inventory/other-branch-image',
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/other.jpg',
      uploadedBy: new mongoose.Types.ObjectId(),
      branchId: otherBranch._id,
      status: IMAGE_UPLOAD_STATUS.PENDING,
    });

    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/other.jpg',
      imagePublicId: 'osms/inventory/other-branch-image',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('authorized branch');
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('Blocker 1: Rejects image already claimed by another inventory item', async () => {
    const otherInventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Existing Item',
      category: 'Eyeglasses',
      brand: 'Vogue',
      price: 15000,
      quantity: 5,
    });

    await ImageUpload.create({
      publicId: 'osms/inventory/already-attached',
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/attached.jpg',
      uploadedBy: new mongoose.Types.ObjectId(),
      branchId: branch._id,
      status: IMAGE_UPLOAD_STATUS.ATTACHED,
      inventoryId: otherInventory._id,
    });

    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const payload = {
      branchId: branch._id.toString(),
      itemName: 'Ray-Ban Wayfarer',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 35000,
      quantity: 10,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/attached.jpg',
      imagePublicId: 'osms/inventory/already-attached',
    };

    const res = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('already associated');
  });

  it('AC14, AC15: Branch Manager updates inventory image (replacement) and deletes old provider asset', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const initialItem = await Inventory.create({
      branchId: branch._id,
      itemName: 'Oakley Holbrook',
      category: 'Sport',
      brand: 'Oakley',
      price: 42000,
      quantity: 5,
      imageUrl:
        'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/old-asset.jpg',
      imagePublicId: 'osms/inventory/old-asset',
    });

    await ImageUpload.create({
      publicId: 'osms/inventory/old-asset',
      imageUrl:
        'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/old-asset.jpg',
      uploadedBy: new mongoose.Types.ObjectId(),
      branchId: branch._id,
      status: IMAGE_UPLOAD_STATUS.ATTACHED,
      inventoryId: initialItem._id,
    });

    const updatePayload = {
      imageUrl:
        'https://res.cloudinary.com/test-cloud/image/upload/v2/osms/inventory/new-asset.jpg',
      imagePublicId: 'osms/inventory/new-asset',
    };

    await ImageUpload.create({
      publicId: updatePayload.imagePublicId,
      imageUrl: updatePayload.imageUrl,
      uploadedBy: new mongoose.Types.ObjectId(),
      branchId: branch._id,
      status: IMAGE_UPLOAD_STATUS.PENDING,
    });

    const res = await request(app)
      .patch(`/api/inventory/${initialItem._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imageUrl).toBe(updatePayload.imageUrl);
    expect(res.body.data.imagePublicId).toBe(updatePayload.imagePublicId);

    // AC15: Old asset is cleaned up via deleteImage
    expect(deleteImage).toHaveBeenCalledWith('osms/inventory/old-asset');

    const updatedInDb = await Inventory.findById(initialItem._id);
    expect(updatedInDb.imageUrl).toBe(updatePayload.imageUrl);
    expect(updatedInDb.imagePublicId).toBe(updatePayload.imagePublicId);
  });

  it('AC16: Branch Manager successfully removes inventory image via DELETE /api/inventory/:id/image', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
    const itemWithImage = await Inventory.create({
      branchId: branch._id,
      itemName: 'Gucci Aviator',
      category: 'Luxury',
      brand: 'Gucci',
      price: 85000,
      quantity: 2,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/gucci.jpg',
      imagePublicId: 'osms/inventory/gucci',
    });

    const res = await request(app)
      .delete(`/api/inventory/${itemWithImage._id}/image`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('removed');

    expect(deleteImage).toHaveBeenCalledWith('osms/inventory/gucci');

    const updated = await Inventory.findById(itemWithImage._id);
    expect(updated.imageUrl).toBeNull();
    expect(updated.imagePublicId).toBeNull();
  });

  it('AC14, AC21: System Admin is forbidden from updating image metadata or deleting image', async () => {
    const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
    const item = await Inventory.create({
      branchId: branch._id,
      itemName: 'Prada Linea',
      category: 'Luxury',
      brand: 'Prada',
      price: 65000,
      quantity: 3,
      imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/osms/inventory/prada.jpg',
      imagePublicId: 'osms/inventory/prada',
    });

    // Attempt image update via PATCH
    const patchRes = await request(app)
      .patch(`/api/inventory/${item._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v2/osms/inventory/hack.jpg',
        imagePublicId: 'osms/inventory/hack',
      });

    expect(patchRes.status).toBe(403);

    // Attempt removal via DELETE
    const deleteRes = await request(app)
      .delete(`/api/inventory/${item._id}/image`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(403);
  });
});
