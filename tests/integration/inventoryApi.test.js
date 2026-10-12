const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { REORDER_ALERT_STATUS } = require('../../src/constants/inventoryAlert.constants');

const JWT_SECRET = 'inventory-api-test-secret';
const JWT_EXPIRES_IN = '1h';

let defaultBranch;

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.BRANCH_MANAGER,
  branchId = defaultBranch ? defaultBranch._id.toString() : null,
} = {}) =>
  jwt.sign({ userId, role, ...(branchId ? { branchId } : {}) }, JWT_SECRET, {
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
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
    ]);

    defaultBranch = await createBranch();
  });

  afterAll(async () => {
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
    ]);
    await disconnectDatabase();

    process.env = originalEnv;
  });

  it('should allow a Branch Manager to create an inventory item for their branch', async () => {
    const branch = await createBranch();
    const token = createToken({ branchId: branch._id.toString() });

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

  it('should reject a Branch Manager attempting to create inventory for another branch with 403 Forbidden', async () => {
    const branchA = await createBranch({ address: 'Branch A' });
    const branchB = await createBranch({ address: 'Branch B' });
    const token = createToken({ branchId: branchA._id.toString() });

    const response = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(buildInventoryPayload(branchB._id));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await Inventory.countDocuments({ branchId: branchB._id })).toBe(0);
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
    const token = createToken({ branchId: missingBranchId.toString() });

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

    const token = createToken({ branchId: branchA._id.toString() });

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

  it('should allow Branch Manager for own branch and System Admin for any branch to view branch inventory', async () => {
    const branch = await createBranch();

    await Inventory.create(buildInventoryPayload(branch._id));

    const branchManagerResponse = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set(
        'Authorization',
        `Bearer ${createToken({ role: ROLE_VALUES.BRANCH_MANAGER, branchId: branch._id.toString() })}`
      );

    const adminResponse = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set('Authorization', `Bearer ${createToken({ role: ROLE_VALUES.SYSTEM_ADMIN })}`);

    expect(branchManagerResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
  });

  it('should reject Branch Manager accessing another branch inventory with 403 Forbidden', async () => {
    const branchA = await createBranch({ address: 'Branch A' });
    const branchB = await createBranch({ address: 'Branch B' });

    const token = createToken({
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branchA._id.toString(),
    });

    const response = await request(app)
      .get(`/api/inventory/branch/${branchB._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('should reject Customer access to branch inventory', async () => {
    const branch = await createBranch();
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    const response = await request(app)
      .get(`/api/inventory/branch/${branch._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('should allow a Branch Manager to update normal inventory information for their branch', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({ branchId: branch._id.toString() });

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

  it('should allow a Branch Manager to perform a price update for their branch', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branch._id.toString(),
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

  it('should reject a Branch Manager attempting to modify an item from another branch', async () => {
    const branchA = await createBranch({ address: 'Branch A' });
    const branchB = await createBranch({ address: 'Branch B' });

    const inventory = await Inventory.create(buildInventoryPayload(branchB._id));

    const token = createToken({
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branchA._id.toString(),
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Hacked Frame',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const storedInventory = await Inventory.findById(inventory._id);
    expect(storedInventory.itemName).toBe('Classic Frame');
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

  it('should reject a System Administrator attempting to update general inventory fields', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    const response = await request(app)
      .patch(`/api/inventory/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemName: 'Admin Updated Frame',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const storedInventory = await Inventory.findById(inventory._id);

    expect(storedInventory.itemName).toBe('Classic Frame');
  });

  it('should update stock quantity successfully', async () => {
    const branch = await createBranch();

    const inventory = await Inventory.create(buildInventoryPayload(branch._id));

    const token = createToken({ branchId: branch._id.toString() });

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

    const token = createToken({ branchId: branch._id.toString() });

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
      role: ROLE_VALUES.BRANCH_ASSISTANT,
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

  it('should allow creating and updating inventory item with imageUrl', async () => {
    const branch = await createBranch({ address: 'Image Branch' });
    const token = createToken({ branchId: branch._id.toString() });

    const createRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send(
        buildInventoryPayload(branch._id, {
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        })
      );

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.imageUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/sample.jpg'
    );

    const updateRes = await request(app)
      .patch(`/api/inventory/${createRes.body.data._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/updated.jpg',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.imageUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/updated.jpg'
    );

    const stored = await Inventory.findById(createRes.body.data._id);
    expect(stored.imageUrl).toBe('https://res.cloudinary.com/demo/image/upload/updated.jpg');
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

  describe('Inventory reorder alert lifecycle integration (ADR-006)', () => {
    it('should automatically create an active ReorderAlert when quantity is updated to <= 5', async () => {
      const branch = await createBranch();
      const inventory = await Inventory.create(buildInventoryPayload(branch._id, { quantity: 10 }));
      const token = createToken({ branchId: branch._id.toString() });

      const response = await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 4 });

      expect(response.status).toBe(200);
      expect(response.body.data.quantity).toBe(4);

      const alerts = await ReorderAlert.find({ inventoryId: inventory._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].status).toBe(REORDER_ALERT_STATUS.ACTIVE);
      expect(alerts[0].currentQuantity).toBe(4);
      expect(alerts[0].threshold).toBe(5);
      expect(alerts[0].resolvedAt).toBeNull();
    });

    it('should update existing alert and prevent duplicate creation when updated again while still low stock', async () => {
      const branch = await createBranch();
      const inventory = await Inventory.create(buildInventoryPayload(branch._id, { quantity: 8 }));
      const token = createToken({ branchId: branch._id.toString() });

      // First update crosses threshold to low stock
      await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 3 });

      // Second update changes quantity while still low stock
      const secondResponse = await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 1 });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.data.quantity).toBe(1);

      const alerts = await ReorderAlert.find({ inventoryId: inventory._id });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].status).toBe(REORDER_ALERT_STATUS.ACTIVE);
      expect(alerts[0].currentQuantity).toBe(1);
    });

    it('should resolve the active alert when quantity is replenished above threshold (> 5)', async () => {
      const branch = await createBranch();
      const inventory = await Inventory.create(buildInventoryPayload(branch._id, { quantity: 10 }));
      const token = createToken({ branchId: branch._id.toString() });

      // Drop to low stock
      await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 2 });

      // Verify active alert was created
      let activeAlert = await ReorderAlert.findOne({
        inventoryId: inventory._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(activeAlert).not.toBeNull();

      // Replenish stock above threshold
      const replenishResponse = await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 15 });

      expect(replenishResponse.status).toBe(200);
      expect(replenishResponse.body.data.quantity).toBe(15);

      // Verify alert is marked RESOLVED
      activeAlert = await ReorderAlert.findOne({
        inventoryId: inventory._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(activeAlert).toBeNull();

      const resolvedAlert = await ReorderAlert.findOne({
        inventoryId: inventory._id,
        status: REORDER_ALERT_STATUS.RESOLVED,
      });
      expect(resolvedAlert).not.toBeNull();
      expect(resolvedAlert.resolvedAt).toBeInstanceOf(Date);
    });

    it('should create a new alert episode when stock drops below threshold again after resolution', async () => {
      const branch = await createBranch();
      const inventory = await Inventory.create(buildInventoryPayload(branch._id, { quantity: 12 }));
      const token = createToken({ branchId: branch._id.toString() });

      // Episode 1: drops to 3 -> active alert
      await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 3 });

      // Episode 1 resolved: rises to 20 -> alert resolved
      await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 20 });

      // Episode 2: drops to 2 -> new active alert episode
      await request(app)
        .patch(`/api/inventory/${inventory._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 2 });

      const allAlerts = await ReorderAlert.find({ inventoryId: inventory._id }).sort({
        createdAt: 1,
      });
      expect(allAlerts).toHaveLength(2);

      // Episode 1 remains resolved
      expect(allAlerts[0].status).toBe(REORDER_ALERT_STATUS.RESOLVED);
      expect(allAlerts[0].resolvedAt).toBeInstanceOf(Date);

      // Episode 2 is new active alert
      expect(allAlerts[1].status).toBe(REORDER_ALERT_STATUS.ACTIVE);
      expect(allAlerts[1].currentQuantity).toBe(2);
      expect(allAlerts[1].resolvedAt).toBeNull();
    });

    it('should create an active alert when a new inventory item is created with initial quantity <= 5', async () => {
      const branch = await createBranch();
      const token = createToken({ branchId: branch._id.toString() });

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${token}`)
        .send(buildInventoryPayload(branch._id, { quantity: 5 }));

      expect(response.status).toBe(201);

      const alert = await ReorderAlert.findOne({
        inventoryId: response.body.data._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(alert).not.toBeNull();
      expect(alert.currentQuantity).toBe(5);
    });

    it('should not create an alert when inventory item is created with initial quantity > 5', async () => {
      const branch = await createBranch();
      const token = createToken({ branchId: branch._id.toString() });

      const response = await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${token}`)
        .send(buildInventoryPayload(branch._id, { quantity: 18 }));

      expect(response.status).toBe(201);

      const count = await ReorderAlert.countDocuments({ inventoryId: response.body.data._id });
      expect(count).toBe(0);
    });
  });
});
