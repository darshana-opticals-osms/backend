const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'inventory-api-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.INVENTORY_MANAGER,
} = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

const createBranch = async (overrides = {}) =>
  Branch.create({
    address: 'Gampaha Branch',
    contactNumber: '+94 33 200 0000',
    ...overrides,
  });

const buildInventoryPayload = (branchId, overrides = {}) => ({
  branchId: branchId.toString(),
  itemName: 'Classic Frame',
  category: 'Men',
  brand: 'Ray-Ban',
  price: 12500,
  quantity: 5,
  ...overrides,
});

describe('Inventory management API', () => {
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

  beforeEach(async () => {
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);
    await disconnectDatabase();

    process.env = originalEnv;
  });

  it('should allow an Inventory Manager to create an inventory item', async () => {
    const branch = await createBranch();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branch._id));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.itemName).toBe('Classic Frame');
    expect(response.body.data.price).toBe(12500);
    expect(response.body.data.quantity).toBe(5);

    const storedInventory = await Inventory.findOne({
      branchId: branch._id,
      itemName: 'Classic Frame',
    });

    expect(storedInventory).not.toBeNull();
    expect(storedInventory.quantity).toBe(5);
  });

  it('should reject inventory creation without authentication', async () => {
    const branch = await createBranch();

    const response = await request(app)
      .post('/api/inventory')
      .send(buildInventoryPayload(branch._id));

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should reject a Customer attempting to create inventory', async () => {
    const branch = await createBranch();
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branch._id));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should reject inventory creation for a non-existent branch', async () => {
    const missingBranchId = new mongoose.Types.ObjectId();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(missingBranchId));

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_BRANCH_REFERENCE');
    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should reject a negative inventory price', async () => {
    const branch = await createBranch();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branch._id, { price: -100 }));

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should reject a negative inventory quantity', async () => {
    const branch = await createBranch();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branch._id, { quantity: -1 }));

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should return only inventory belonging to the requested branch', async () => {
    const branchA = await createBranch({
      address: 'Gampaha Branch',
      contactNumber: '+94 33 200 0001',
    });

    const branchB = await createBranch({
      address: 'Colombo Branch',
      contactNumber: '+94 11 200 0002',
    });

    await Inventory.create([
      buildInventoryPayload(branchA._id, {
        itemName: 'Frame A',
      }),
      buildInventoryPayload(branchA._id, {
        itemName: 'Frame B',
      }),
      buildInventoryPayload(branchB._id, {
        itemName: 'Frame C',
      }),
    ]);

    const token = createToken();

    const response = await request(app)
      .get(`/api/inventory/branch/${branchA._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);

    const names = response.body.data.map((item) => item.itemName);

    expect(names).toEqual(expect.arrayContaining(['Frame A', 'Frame B']));
    expect(names).not.toContain('Frame C');
  });

  it('should allow Branch Manager and Management roles to view branch inventory', async () => {
    const branch = await createBranch();

    await Inventory.create(buildInventoryPayload(branch._id));

    const branchManagerResponse = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set('Authorization', `Bearer ${createToken({ role: ROLE_VALUES.BRANCH_MANAGER })}`);

    const managementResponse = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set('Authorization', `Bearer ${createToken({ role: ROLE_VALUES.MANAGEMENT })}`);

    expect(branchManagerResponse.status).toBe(200);
    expect(managementResponse.status).toBe(200);
  });

  it('should reject Customer access to branch inventory', async () => {
    const branch = await createBranch();
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    const response = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('should allow an Inventory Manager to update normal inventory information', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Updated Frame',
        brand: 'Oakley',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.itemName).toBe('Updated Frame');
    expect(response.body.data.brand).toBe('Oakley');
    expect(response.body.data.price).toBe(12500);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.itemName).toBe('Updated Frame');
    expect(storedInventory.brand).toBe('Oakley');
    expect(storedInventory.price).toBe(12500);
  });

  it('should allow a Branch Manager to perform a manual price override', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.BRANCH_MANAGER,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: 20000,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.price).toBe(20000);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.price).toBe(20000);
  });

  it('should reject an Inventory Manager attempting to manually change price', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.INVENTORY_MANAGER,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: 15000,
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.price).toBe(12500);
  });

  it('should allow a System Administrator to perform a manual price override', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: 16000,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.price).toBe(16000);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.price).toBe(16000);
  });

  it('should reject a Branch Manager attempting to update normal inventory information', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.BRANCH_MANAGER,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Manager Updated Frame',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.itemName).toBe('Classic Frame');
  });

  it('should update stock quantity successfully', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        quantity: 12,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.quantity).toBe(12);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.quantity).toBe(12);
  });

  it('should reject a negative stock quantity update', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        quantity: -1,
      });

    expect(response.status).toBe(422);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.quantity).toBe(5);
  });

  it('should reject quantity updates from an unauthorized role', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.MANAGEMENT,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        quantity: 10,
      });

    expect(response.status).toBe(403);

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.quantity).toBe(5);
  });

  it('should return 404 when updating an inventory item that does not exist', async () => {
    const missingInventoryId = new mongoose.Types.ObjectId();
    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${missingInventoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Updated Frame',
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('should return safe error responses without exposing sensitive information', async () => {
    const branch = await createBranch();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branch._id, { quantity: -5 }));

    const responseText = JSON.stringify(response.body);

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.stack).toBeUndefined();
    expect(responseText).not.toContain(JWT_SECRET);
    expect(responseText).not.toContain(token);
    expect(responseText).not.toContain('mongodb://');
  });

  it('should reject inventory creation with missing required fields', async () => {
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Incomplete Frame',
      });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
  });

  it('should reject inventory creation with unsupported fields', async () => {
    const branch = await createBranch();
    const token = createToken();

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...buildInventoryPayload(branch._id),
        secretField: 'not-allowed',
      });

    expect(response.status).toBe(422);
  });

  it('should reject branch inventory retrieval with an invalid branch id', async () => {
    const token = createToken();

    const response = await request(app)
      .get('/api/inventory/branch/not-a-valid-id')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
  });

  it('should reject an empty general inventory update', async () => {
    const branch = await createBranch();
    const inventory = await Inventory.create(buildInventoryPayload(branch._id));
    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
  });

  it('should reject unsupported fields in a general inventory update', async () => {
    const branch = await createBranch();
    const inventory = await Inventory.create(buildInventoryPayload(branch._id));
    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        quantity: 20,
      });

    expect(response.status).toBe(422);
  });

  it('should reject an invalid inventory id during update', async () => {
    const token = createToken();

    const response = await request(app)
      .patch('/api/inventory/not-a-valid-id')
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: 5000,
      });

    expect(response.status).toBe(422);
  });

  it('should reject quantity update when quantity is missing', async () => {
    const branch = await createBranch();
    const inventory = await Inventory.create(buildInventoryPayload(branch._id));
    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
  });

  it('should reject unsupported fields in a quantity update', async () => {
    const branch = await createBranch();
    const inventory = await Inventory.create(buildInventoryPayload(branch._id));
    const token = createToken();

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        quantity: 5,
        price: 1000,
      });

    expect(response.status).toBe(422);
  });
});
