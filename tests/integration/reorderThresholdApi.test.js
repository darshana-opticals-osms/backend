const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
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
  role = ROLE_VALUES.BRANCH_MANAGER,
  branchId = null,
} = {}) =>
  jwt.sign({ userId, role, ...(branchId ? { branchId } : {}) }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('Global Reorder Threshold API (ADR-006)', () => {
  let app;
  let originalEnv;
  let branch;
  let mongoServer;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: new URL(uri).host }],
      },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([
      Branch.init(),
      Inventory.init(),
      ReorderAlert.init(),
      InventoryConfig.init(),
    ]);

    app = createApp();
  }, 30000);

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
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }

    process.env = originalEnv;
  }, 30000);

  describe('GET /api/inventory/reorder-threshold', () => {
    it('should return default threshold 5 when no configuration exists', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.threshold).toBe(5);
    });

    it('should allow BRANCH_MANAGER and SYSTEM_ADMIN to view current threshold', async () => {
      const branchManagerToken = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const res1 = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${branchManagerToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${adminToken}`);
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
    it('should allow BRANCH_MANAGER to update the reorder threshold', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 8 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.threshold).toBe(8);
    });

    it('should allow SYSTEM_ADMIN to update the reorder threshold', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.threshold).toBe(10);
    });

    it('should reject OPTOMETRIST from updating threshold with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.OPTOMETRIST });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(403);
    });

    it('should reject BRANCH_ASSISTANT from updating threshold with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.BRANCH_ASSISTANT });
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
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: -2 });

      expect(response.status).toBe(422);
    });

    it('should reject non-numeric threshold with 422 Validation Error', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 'ten' });

      expect(response.status).toBe(422);
    });

    it('should reject empty body with 422 Validation Error', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(422);
    });

    it('should reject unsupported fields in body with 422 Validation Error', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });
      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 6, extraField: 'invalid' });

      expect(response.status).toBe(422);
    });
  });

  describe('Automatic Inventory Reconciliation (ADR-006 Section 21)', () => {
    it('should reconcile all inventories upon threshold change: create, update, and resolve alerts', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });

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

    it('should atomically roll back threshold and all alert modifications via transaction when reconciliation fails midway, preserving concurrent alerts', async () => {
      const reorderAlertService = require('../../src/services/reorderAlert.service');

      // Set initial threshold to 5
      await InventoryConfig.create({
        key: 'REORDER_THRESHOLD',
        value: 5,
      });

      // Item 1 has quantity 4 (<= 5) and has an existing alert at threshold 5
      const item1 = await Inventory.create({
        branchId: branch._id,
        itemName: 'Reconcile Item 1',
        category: 'Frames',
        brand: 'Brand 1',
        price: 5000,
        quantity: 4,
      });

      const initialAlert1 = await ReorderAlert.create({
        inventoryId: item1._id,
        branchId: branch._id,
        currentQuantity: 4,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });

      // Item 2 has quantity 8 (> 5, so no alert at initial threshold 5; becomes low stock at threshold 10)
      const item2 = await Inventory.create({
        branchId: branch._id,
        itemName: 'Reconcile Item 2',
        category: 'Frames',
        brand: 'Brand 2',
        price: 6000,
        quantity: 8,
      });

      // Concurrent Item 3 has an active alert created outside the transaction
      const concurrentItem = await Inventory.create({
        branchId: branch._id,
        itemName: 'Concurrent Item',
        category: 'Frames',
        brand: 'Brand Concurrent',
        price: 4500,
        quantity: 2,
      });

      const concurrentAlert = await ReorderAlert.create({
        inventoryId: concurrentItem._id,
        branchId: branch._id,
        currentQuantity: 2,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });

      // Item 4 (evaluation will fail on this item)
      await Inventory.create({
        branchId: branch._id,
        itemName: 'Failing Item 4',
        category: 'Frames',
        brand: 'Brand 4',
        price: 7000,
        quantity: 3,
      });

      let evaluationCount = 0;
      const originalEvaluate = reorderAlertService.evaluateReorderAlert;
      const evalSpy = jest
        .spyOn(reorderAlertService, 'evaluateReorderAlert')
        .mockImplementation(async (...args) => {
          evaluationCount += 1;
          if (evaluationCount === 4) {
            throw new Error('Midway reconciliation network error');
          }
          return originalEvaluate(...args);
        });

      const token = createToken({
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });

      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(500);

      // Verify the global threshold remained at 5 (not left at 10)
      const config = await InventoryConfig.findOne({ key: 'REORDER_THRESHOLD' });
      expect(config.value).toBe(5);

      // Verify pre-existing alert on Item 1 was rolled back to threshold 5
      const restoredAlert1 = await ReorderAlert.findById(initialAlert1._id);
      expect(restoredAlert1).not.toBeNull();
      expect(restoredAlert1.threshold).toBe(5);
      expect(restoredAlert1.status).toBe(REORDER_ALERT_STATUS.ACTIVE);

      // Verify no alert was created for Item 2 because transaction aborted
      const alert2 = await ReorderAlert.findOne({ inventoryId: item2._id });
      expect(alert2).toBeNull();

      // Verify concurrent alert outside transaction was NOT deleted by rollback
      const preservedConcurrentAlert = await ReorderAlert.findById(concurrentAlert._id);
      expect(preservedConcurrentAlert).not.toBeNull();
      expect(preservedConcurrentAlert.threshold).toBe(5);
      expect(preservedConcurrentAlert.status).toBe(REORDER_ALERT_STATUS.ACTIVE);

      // Verify no alerts in the database remain with the failed threshold 10
      const inconsistentAlerts = await ReorderAlert.find({ threshold: 10 });
      expect(inconsistentAlerts.length).toBe(0);

      // Overall active alerts count should match initial state (alert 1 and concurrentAlert)
      const totalActiveAlerts = await ReorderAlert.countDocuments({
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(totalActiveAlerts).toBe(2);

      evalSpy.mockRestore();
    });

    it('should safely reject threshold update with 500 TRANSACTION_REQUIRED when MongoDB deployment does not support transactions (regression test)', async () => {
      const unsupportedErr = new Error(
        'Transaction numbers are only allowed on a replica set member or mongos'
      );
      unsupportedErr.name = 'MongoServerError';
      unsupportedErr.code = 20;
      unsupportedErr.codeName = 'IllegalOperation';

      const sessionSpy = jest.spyOn(mongoose, 'startSession').mockRejectedValueOnce(unsupportedErr);

      const token = createToken({
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });

      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${token}`)
        .send({ threshold: 10 });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('TRANSACTION_REQUIRED');
      expect(response.body.error.message).toMatch(/transaction-capable MongoDB deployment/);

      sessionSpy.mockRestore();
    });
  });
});
