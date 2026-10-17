const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const InventoryConfig = require('../../src/models/inventoryConfig.model');
const AuditEvent = require('../../src/models/auditEvent.model');
const inventoryService = require('../../src/services/inventory.service');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
} = require('../../src/constants/audit');

const JWT_SECRET = 'inventory-audit-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.BRANCH_MANAGER,
  branchId,
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

const createInventoryItem = async (branchId, overrides = {}) =>
  Inventory.create({
    branchId: branchId.toString(),
    itemName: 'Ray-Ban Aviator',
    category: 'Men',
    brand: 'Ray-Ban',
    price: 15000,
    quantity: 20,
    ...overrides,
  });

describe('Inventory Operations - Audit Trail Integration (ADR-012 / DDP-065)', () => {
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
      AuditEvent.init(),
    ]);

    app = createApp();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
      InventoryConfig.deleteMany({}),
      AuditEvent.collection.deleteMany({}),
    ]);

    branch = await createBranch();
  });

  afterAll(async () => {
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
      InventoryConfig.deleteMany({}),
      AuditEvent.collection.deleteMany({}),
    ]);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      try {
        await mongoServer.stop();
      } catch {
        // Ignored MongoServerSelectionError during server shutdown
      }
    }

    process.env = originalEnv;
  }, 30000);

  describe('1. Manual Quantity Adjustment (INVENTORY_QUANTITY_ADJUSTED)', () => {
    it('persists an immutable AuditEvent with quantity delta metadata when branch manager adjusts quantity via API (AC16-AC18)', async () => {
      const managerId = new mongoose.Types.ObjectId().toString();
      const token = createToken({
        userId: managerId,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });

      const item = await createInventoryItem(branch._id, { quantity: 20 });

      const response = await request(app)
        .patch(`/api/inventory/${item._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 35 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.quantity).toBe(35);

      // Verify AuditEvent persisted in database
      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        targetId: item._id.toString(),
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.action).toBe(AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED);
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(auditEvent.actorId).toBe(managerId);
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.BRANCH_MANAGER);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.INVENTORY);
      expect(auditEvent.targetId).toBe(item._id.toString());
      expect(auditEvent.branchId).toBe(branch._id.toString());
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(auditEvent.occurredAt).toBeInstanceOf(Date);

      // Verify safe metadata and delta calculations (AC18)
      expect(auditEvent.metadata).toEqual({
        previousQuantity: 20,
        newQuantity: 35,
        adjustmentDelta: 15,
      });

      // Immutability: attempts to modify or delete this event must fail
      await expect(
        AuditEvent.updateOne({ _id: auditEvent._id }, { $set: { outcome: 'FAILURE' } })
      ).rejects.toThrow(/AuditEvent records are immutable and append-only/);

      await expect(AuditEvent.deleteOne({ _id: auditEvent._id })).rejects.toThrow(
        /AuditEvent records are immutable and append-only/
      );
    });

    it('persists negative delta metadata when inventory quantity is decreased', async () => {
      const managerId = new mongoose.Types.ObjectId().toString();
      const token = createToken({
        userId: managerId,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });

      const item = await createInventoryItem(branch._id, { quantity: 50 });

      const response = await request(app)
        .patch(`/api/inventory/${item._id}/quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 42 });

      expect(response.status).toBe(200);
      expect(response.body.data.quantity).toBe(42);

      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        targetId: item._id.toString(),
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.metadata.previousQuantity).toBe(50);
      expect(auditEvent.metadata.newQuantity).toBe(42);
      expect(auditEvent.metadata.adjustmentDelta).toBe(-8);
    });
  });

  describe('2. Checkout Stock Deduction (INVENTORY_CHECKOUT_STOCK_DEDUCTED)', () => {
    it('persists an AuditEvent with system actor and deducted quantities when checkout occurs (AC19-AC20)', async () => {
      const item = await createInventoryItem(branch._id, { quantity: 15 });
      const orderId = new mongoose.Types.ObjectId().toString();

      await inventoryService.deductInventoryStock(
        [{ inventoryId: item._id.toString(), quantity: 3 }],
        null,
        {
          orderId,
          system: true,
          correlationId: 'checkout-req-001',
        }
      );

      const updatedItem = await Inventory.findById(item._id);
      expect(updatedItem.quantity).toBe(12);

      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.INVENTORY_CHECKOUT_STOCK_DEDUCTED,
        targetId: item._id.toString(),
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.SYSTEM);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.INVENTORY);
      expect(auditEvent.targetId).toBe(item._id.toString());
      expect(auditEvent.branchId).toBe(branch._id.toString());
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(auditEvent.correlationId).toBe('checkout-req-001');

      expect(auditEvent.metadata).toEqual({
        deductedQuantity: 3,
        remainingQuantity: 12,
        orderId,
      });
    });
  });

  describe('3. Reorder Threshold Configuration (INVENTORY_REORDER_CONFIG_CHANGED)', () => {
    it('persists an AuditEvent when reorder threshold is updated via API (AC21-AC22)', async () => {
      const adminId = new mongoose.Types.ObjectId().toString();
      const adminToken = createToken({
        userId: adminId,
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });

      const response = await request(app)
        .put('/api/inventory/reorder-threshold')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ threshold: 12 });

      expect(response.status).toBe(200);

      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.INVENTORY_REORDER_CONFIG_CHANGED,
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.action).toBe(AUDIT_ACTION.INVENTORY_REORDER_CONFIG_CHANGED);
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(auditEvent.actorId).toBe(adminId);
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.SYSTEM_ADMIN);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.INVENTORY);
      expect(auditEvent.targetId).toBe('GLOBAL_CONFIG');
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(auditEvent.metadata.previousThreshold).toBe(5);
      expect(auditEvent.metadata.newThreshold).toBe(12);
    });
  });

  describe('4. Unit Price Changes (INVENTORY_PRICE_UPDATED)', () => {
    it('persists an AuditEvent with price delta metadata when price is updated via API (ADR-012 §5.1)', async () => {
      const managerId = new mongoose.Types.ObjectId().toString();
      const token = createToken({
        userId: managerId,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branch._id.toString(),
      });

      const item = await createInventoryItem(branch._id, { price: 15000 });

      const response = await request(app)
        .patch(`/api/inventory/${item._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ price: 17500 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.price).toBe(17500);

      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.INVENTORY_PRICE_UPDATED,
        targetId: item._id.toString(),
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.action).toBe(AUDIT_ACTION.INVENTORY_PRICE_UPDATED);
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(auditEvent.actorId).toBe(managerId);
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.BRANCH_MANAGER);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.INVENTORY);
      expect(auditEvent.targetId).toBe(item._id.toString());
      expect(auditEvent.branchId).toBe(branch._id.toString());
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(auditEvent.metadata).toEqual({
        previousPrice: 15000,
        newPrice: 17500,
        priceDelta: 2500,
      });
    });
  });
});
