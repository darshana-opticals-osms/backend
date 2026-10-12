const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { REORDER_ALERT_STATUS } = require('../../src/constants/inventoryAlert.constants');

const JWT_SECRET = 'reorder-alert-api-test-secret';
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

describe('Reorder Alert Retrieval API (ADR-006 / ADR-002)', () => {
  let app;
  let originalEnv;
  let branchA;
  let branchB;
  let invA;
  let invB;

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

    branchA = await Branch.create({
      address: 'Branch A Address',
      contactNumber: '+94 11 200 0001',
    });

    branchB = await Branch.create({
      address: 'Branch B Address',
      contactNumber: '+94 11 200 0002',
    });

    invA = await Inventory.create({
      branchId: branchA._id,
      itemName: 'Ray-Ban Aviator',
      category: 'Frames',
      brand: 'Ray-Ban',
      price: 15000,
      quantity: 3,
    });

    invB = await Inventory.create({
      branchId: branchB._id,
      itemName: 'Oakley Holbrook',
      category: 'Sunglasses',
      brand: 'Oakley',
      price: 22000,
      quantity: 2,
    });

    // Seed 1 active alert for invA, 1 active alert for invB, 1 resolved alert for invA
    await ReorderAlert.create({
      inventoryId: invA._id,
      branchId: branchA._id,
      currentQuantity: 3,
      threshold: 5,
      status: REORDER_ALERT_STATUS.ACTIVE,
    });

    await ReorderAlert.create({
      inventoryId: invB._id,
      branchId: branchB._id,
      currentQuantity: 2,
      threshold: 5,
      status: REORDER_ALERT_STATUS.ACTIVE,
    });

    await ReorderAlert.create({
      inventoryId: invA._id,
      branchId: branchA._id,
      currentQuantity: 1,
      threshold: 5,
      status: REORDER_ALERT_STATUS.RESOLVED,
      resolvedAt: new Date(),
    });
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

  describe('RBAC Authorization', () => {
    it('should allow SYSTEM_ADMIN to view all active reorder alerts across branches', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.alerts).toHaveLength(2);
      expect(response.body.data.total).toBe(2);
    });

    it('should allow BRANCH_MANAGER to view active reorder alerts auto-scoped to their branch', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.alerts).toHaveLength(1);
      expect(response.body.data.alerts[0].branchId._id.toString()).toBe(branchA._id.toString());
    });

    it('should reject BRANCH_MANAGER trying to view alerts for another branch with 403 Forbidden', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      });
      const response = await request(app)
        .get(`/api/inventory/reorder-alerts?branchId=${branchB._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject CUSTOMER access with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.CUSTOMER });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject OPTOMETRIST access with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.OPTOMETRIST });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject BRANCH_ASSISTANT access with 403 Forbidden', async () => {
      const token = createToken({ role: ROLE_VALUES.BRANCH_ASSISTANT });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      const response = await request(app).get('/api/inventory/reorder-alerts');

      expect(response.status).toBe(401);
    });
  });

  describe('Branch Filtering and Data Contract', () => {
    it('should filter active alerts by branch using query parameter ?branchId= for SYSTEM_ADMIN', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .get(`/api/inventory/reorder-alerts?branchId=${branchA._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.alerts).toHaveLength(1);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.alerts[0].branchId._id.toString()).toBe(branchA._id.toString());
      expect(response.body.data.alerts[0].inventoryId.itemName).toBe('Ray-Ban Aviator');
    });

    it('should filter active alerts by branch using path parameter /branch/:branchId for matching BRANCH_MANAGER', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchB._id.toString(),
      });
      const response = await request(app)
        .get(`/api/inventory/reorder-alerts/branch/${branchB._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.alerts).toHaveLength(1);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.alerts[0].branchId._id.toString()).toBe(branchB._id.toString());
      expect(response.body.data.alerts[0].inventoryId.itemName).toBe('Oakley Holbrook');
    });

    it('should reject BRANCH_MANAGER accessing /branch/:branchId for a foreign branch with 403 Forbidden', async () => {
      const token = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      });
      const response = await request(app)
        .get(`/api/inventory/reorder-alerts/branch/${branchB._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it('should reject malformed branchId with 422 Validation Error', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts?branchId=invalid-id')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(422);
    });

    it('should support pagination (page and limit) for SYSTEM_ADMIN', async () => {
      const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });
      const response = await request(app)
        .get('/api/inventory/reorder-alerts?page=1&limit=1')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.alerts).toHaveLength(1);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.limit).toBe(1);
    });
  });
});
