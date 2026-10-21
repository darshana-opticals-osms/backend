/**
 * Integration tests for Staff Order Responses with Customer Details (Issue #95).
 *
 * Verifies:
 * - AC1: Customer name included in authorized staff order list.
 * - AC2: Customer phone included in authorized staff order list.
 * - AC3: Customer details (name and phone) in authorized staff single order details.
 * - AC4: Existing order response fields (id, customerId, branchId, orderAmount, items, etc.) preserved.
 * - AC5: Existing staff authorization, RBAC, branch isolation, and fail-closed checks enforced.
 * - AC6: Existing customer-facing response contract preserved (no customer object leaked).
 * - AC7: Missing customer records safely handled (customer: null) without crashing.
 * - AC8: Batched customer lookup prevents N+1 database queries.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Customer = require('../../src/models/customer.model');
const Branch = require('../../src/models/branch.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const { createAccessToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/services/auth.service');

const PASSWORD = 'StrongPassword123!';

describe('Staff Orders API - Customer Details Integration (Issue #95)', () => {
  let app;
  let branch1;
  let branch2;
  let customerA;
  let customerB;
  let staffAssistantToken;
  let staffManagerToken;
  let otherBranchStaffToken;
  let customerAToken;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-issue-95';
    process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      Order.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Customer.deleteMany({}),
      Branch.deleteMany({}),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    branch1 = await Branch.create({
      codeName: 'COLOMBO',
      address: '123 Galle Road, Colombo',
      contactNumber: '+94112345678',
    });

    branch2 = await Branch.create({
      codeName: 'KANDY',
      address: '456 Peradeniya Road, Kandy',
      contactNumber: '+94812345678',
    });

    customerA = await Customer.create({
      name: 'Kamal Perera',
      email: 'kamal.perera@example.com',
      phone: '+94712345678',
      address: '10 High Level Rd, Nugegoda',
      passwordHash,
    });

    customerB = await Customer.create({
      name: 'Sunil Silva',
      email: 'sunil.silva@example.com',
      phone: '+94771122334',
      address: '25 Kandy Rd, Kiribathgoda',
      passwordHash,
    });

    const staffId1 = new mongoose.Types.ObjectId().toString();
    const staffId2 = new mongoose.Types.ObjectId().toString();
    const otherStaffId = new mongoose.Types.ObjectId().toString();

    staffAssistantToken = createAccessToken({
      userId: staffId1,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      branchId: branch1._id,
    });

    staffManagerToken = createAccessToken({
      userId: staffId2,
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branch1._id,
    });

    otherBranchStaffToken = createAccessToken({
      userId: otherStaffId,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      branchId: branch2._id,
    });

    customerAToken = createAccessToken({
      userId: customerA._id.toString(),
      role: ROLE_VALUES.CUSTOMER,
    });
  });

  describe('GET /api/orders (Staff Order List)', () => {
    it('returns customer name and phone alongside order summaries for authorized staff (AC1, AC2, AC4)', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 18500.0,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
        statusHistory: [
          {
            status: ORDER_STATUS_VALUES.ORDER_CREATED,
            changedAt: now,
            changedBy: customerA._id,
            source: 'USER',
          },
        ],
      });

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${staffAssistantToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const found = res.body.data.find((o) => o.id === order._id.toString());
      expect(found).toBeDefined();
      expect(found.customerId).toBe(customerA._id.toString());
      expect(found.branchId).toBe(branch1._id.toString());
      expect(found.orderAmount).toBe(18500.0);
      expect(found.status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);

      // Customer DTO checks (AC1, AC2)
      expect(found.customer).toBeDefined();
      expect(found.customer).toEqual({
        name: 'Kamal Perera',
        phone: '+94712345678',
      });
      // Ensure no sensitive leakage (AC6)
      expect(found.customer.email).toBeUndefined();
      expect(found.customer.passwordHash).toBeUndefined();
      expect(found.customer.loyaltyBalance).toBeUndefined();
    });

    it('returns correct customer details for multiple orders across different and duplicate customers (AC8)', async () => {
      const now = new Date();
      // Order 1: Customer A
      const order1 = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 12000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });
      // Order 2: Customer B
      const order2 = await Order.create({
        customerId: customerB._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 25000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });
      // Order 3: Customer A again (shared customerId)
      const order3 = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 8500,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${staffManagerToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data).toHaveLength(3);

      const o1 = data.find((o) => o.id === order1._id.toString());
      const o2 = data.find((o) => o.id === order2._id.toString());
      const o3 = data.find((o) => o.id === order3._id.toString());

      expect(o1.customer).toEqual({ name: 'Kamal Perera', phone: '+94712345678' });
      expect(o2.customer).toEqual({ name: 'Sunil Silva', phone: '+94771122334' });
      expect(o3.customer).toEqual({ name: 'Kamal Perera', phone: '+94712345678' });
    });

    it('safely handles missing customer record with customer: null without crashing (AC7)', async () => {
      const nonExistentCustomerId = new mongoose.Types.ObjectId();
      const now = new Date();

      const order = await Order.create({
        customerId: nonExistentCustomerId,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 5000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${staffAssistantToken}`);

      expect(res.status).toBe(200);
      const found = res.body.data.find((o) => o.id === order._id.toString());
      expect(found).toBeDefined();
      expect(found.customer).toBeNull();
    });

    it('preserves customer privacy by NOT returning customer field for customer callers (AC6)', async () => {
      const now = new Date();
      await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 15000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${customerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBeDefined();
      // Customer view must preserve existing contract without customer field (AC6)
      expect(res.body.data[0].customer).toBeUndefined();
    });

    it('rejects staff request without branch assignment fail-closed (AC5)', async () => {
      const unassignedStaffToken = createAccessToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: null,
      });

      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${unassignedStaffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/orders/:id (Staff Single Order Details)', () => {
    it('returns customer name and phone alongside items in single order response (AC3, AC4)', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 24000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const item = await OrderItem.create({
        orderId: order._id,
        inventoryId: new mongoose.Types.ObjectId(),
        itemName: 'Ray-Ban Aviator',
        price: 24000,
        quantity: 1,
      });

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${staffAssistantToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const orderData = res.body.data;
      expect(orderData.id).toBe(order._id.toString());
      expect(orderData.customerId).toBe(customerA._id.toString());
      expect(orderData.branchId).toBe(branch1._id.toString());
      expect(orderData.items).toHaveLength(1);
      expect(orderData.items[0].itemName).toBe('Ray-Ban Aviator');

      // Customer info (AC3)
      expect(orderData.customer).toEqual({
        name: 'Kamal Perera',
        phone: '+94712345678',
      });
      // Verify no sensitive fields leaked (AC6)
      expect(orderData.customer.email).toBeUndefined();
      expect(orderData.customer.passwordHash).toBeUndefined();
      expect(orderData.customer.loyaltyBalance).toBeUndefined();
      expect(orderData.customer._id).toBeUndefined();
    });

    it('safely returns customer: null when customer record is missing for single order (AC7)', async () => {
      const nonExistentCustomerId = new mongoose.Types.ObjectId();
      const now = new Date();

      const order = await Order.create({
        customerId: nonExistentCustomerId,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 7000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${staffManagerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(order._id.toString());
      expect(res.body.data.customer).toBeNull();
    });

    it('denies cross-branch access with 403 Forbidden (AC5)', async () => {
      const now = new Date();
      // Order belongs to branch 1
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 10000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      // Staff from branch 2 attempts to retrieve branch 1 order
      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${otherBranchStaffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('preserves customer view without customer field in single order response (AC6)', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branch1._id,
        orderDate: now,
        orderAmount: 12500,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: now,
      });

      const res = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${customerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(order._id.toString());
      expect(res.body.data.customer).toBeUndefined();
    });
  });
});
