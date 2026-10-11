const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const InventoryConfig = require('../../src/models/inventoryConfig.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { REORDER_ALERT_STATUS } = require('../../src/constants/inventoryAlert.constants');

const JWT_SECRET = 'threshold-api-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.INVENTORY_MANAGER,
} = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('Global Reorder Threshold API (ADR-006)', () => {
  let app;
  let originalEnv;
  let branch;

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
      InventoryConfig.deleteMany({}),
    ]);

    branch = await Branch.create({
      address: 'Main Branch',
      contactNumber: '+94 11 200 0000',
    });
  });

  afterAll(async () => {
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
      InventoryConfig.deleteMany({}),
    ]);
    await disconnectDatabase();

    process.env = originalEnv;
  });

  describe('GET /api/inventory/reorder-threshold', () => {
    it('should return default threshold 5 when no configuration exists', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.threshold).toBe(5);
    });

    it('should allow BRANCH_MANAGER and MANAGEMENT to view current threshold', async () => {
      const branchManagerToken = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
      const managementToken = createToken({ role: ROLE_VALUES.MANAGEMENT });

      const res1 = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${branchManagerToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${managementToken}`);
      expect(res2.status).toBe(200);
    });

    it('should reject CUSTOMER access with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.CUSTOMER });
      const response = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const response = await request(app).get('/api/inventory/reorder-threshold');
      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/inventory/reorder-threshold Authorization', () => {
    it('should allow INVENTORY_MANAGER to update the reorder threshold', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 8 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.threshold).toBe(8);
    });

    it('should reject SYSTEM_ADMIN from updating threshold (per ADR-006 Section 20 & 21)', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(403);
    });

    it('should reject BRANCH_MANAGER from updating threshold with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(403);
    });

    it('should reject CUSTOMER from updating threshold with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.CUSTOMER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/inventory/reorder-threshold Validation', () => {
    it('should reject negative threshold with 422 Validation Error', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: -2 });

      expect(response.status).toBe(422);
    });

    it('should reject non-numeric threshold with 422 Validation Error', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 'ten' });

      expect(response.status).toBe(422);
    });

    it('should reject empty body with 422 Validation Error', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(422);
    });

    it('should reject unsupported fields in body with 422 Validation Error', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 6, extraField: 'invalid' });

      expect(response.status).toBe(422);
    });
  });

  describe('Automatic Inventory Reconciliation (ADR-006 Section 21)', () => {
    it('should reconcile all inventories upon threshold change: create, update, and resolve alerts', async () => {
      const token = createToken({ role: ROLE_VALUES.INVENTORY_MANAGER });

      // Create 3 inventory items:
      // Item A: qty 3 (below default 5)
      // Item B: qty 7 (above default 5)
      // Item C: qty 15 (well above)
      const itemA = await Inventory.create({
        branchId: branch._id,
        itemName: 'Item A',
        category: 'Frames',
        brand: 'Brand A',
        price: 5000,
        quantity: 3,
      });

      const itemB = await Inventory.create({
        branchId: branch._id,
        itemName: 'Item B',
        category: 'Frames',
        brand: 'Brand B',
        price: 8000,
        quantity: 7,
      });

      await Inventory.create({
        branchId: branch._id,
        itemName: 'Item C',
        category: 'Frames',
        brand: 'Brand C',
        price: 12000,
        quantity: 15,
      });

      // At default threshold 5: Item A has active alert; Item B has no alert
      await ReorderAlert.create({
        inventoryId: itemA._id,
        branchId: branch._id,
        currentQuantity: 3,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });

      // Step 1: Raise threshold to 8 (so Item B with qty 7 <= 8 now becomes low stock)
      const raiseResponse = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 8 });

      expect(raiseResponse.status).toBe(200);
      expect(raiseResponse.body.data.threshold).toBe(8);
      expect(raiseResponse.body.data.reconciliation.totalEvaluated).toBe(3);

      // Verify Item A alert threshold was updated to 8
      const alertA = await ReorderAlert.findOne({
        inventoryId: itemA._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(alertA).not.toBeNull();
      expect(alertA.threshold).toBe(8);

      // Verify Item B now has an active alert created!
      const alertB = await ReorderAlert.findOne({
        inventoryId: itemB._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(alertB).not.toBeNull();
      expect(alertB.currentQuantity).toBe(7);
      expect(alertB.threshold).toBe(8);

      // Step 2: Lower threshold to 2 (so both Item A with qty 3 and Item B with qty 7 are now above threshold)
      const lowerResponse = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 2 });

      expect(lowerResponse.status).toBe(200);

      // Verify no active alerts exist anymore! Both should be RESOLVED
      const activeAlertsCount = await ReorderAlert.countDocuments({
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(activeAlertsCount).toBe(0);

      const resolvedAlertA = await ReorderAlert.findOne({
        inventoryId: itemA._id,
        status: REORDER_ALERT_STATUS.RESOLVED,
      });
      expect(resolvedAlertA).not.toBeNull();
      expect(resolvedAlertA.resolvedAt).toBeInstanceOf(Date);

      const resolvedAlertB = await ReorderAlert.findOne({
        inventoryId: itemB._id,
        status: REORDER_ALERT_STATUS.RESOLVED,
      });
      expect(resolvedAlertB).not.toBeNull();
      expect(resolvedAlertB.resolvedAt).toBeInstanceOf(Date);
    });
  });
});
