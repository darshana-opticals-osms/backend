const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Customer = require('../../src/models/customer.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');

const JWT_SECRET = 'order-api-test-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const createToken = ({ userId, role } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

const createCustomer = (email = 'ordercustomer@example.com') =>
  Customer.create({
    name: 'Order Customer',
    email,
    address: '45 Temple Road',
    phone: '+94771234567',
    passwordHash: PASSWORD_HASH,
  });

describe('Staff Order Status Update API (PATCH /api/orders/:id/status)', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([Order.deleteMany({}), OrderItem.deleteMany({}), Customer.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectDatabase();
    process.env = originalEnv;
  });

  describe('Authentication and RBAC (ADR-004 §11, ADR-002)', () => {
    it('returns 401 when no token is provided', async () => {
      const orderId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(401);
    });

    it('returns 403 when called by a CUSTOMER', async () => {
      const customer = await createCustomer();
      const token = createToken({ userId: customer._id.toString(), role: ROLE_VALUES.CUSTOMER });
      const orderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(403);
    });

    it('returns 403 when called by an OPTOMETRIST', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({ userId: staffId.toString(), role: ROLE_VALUES.OPTOMETRIST });
      const orderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(403);
    });
  });

  describe('Validation & Not Found', () => {
    it('returns 422 when order ID is not a valid ObjectId', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.INVENTORY_MANAGER,
      });

      const res = await request(app)
        .patch('/api/orders/not-an-id/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(422);
      expect(res.body.error.details[0].field).toBe('id');
    });

    it('returns 422 when status is missing or empty', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.INVENTORY_MANAGER,
      });
      const orderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.details[0].field).toBe('status');
    });

    it('returns 422 when status is not a canonical ADR-004 status', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
      });
      const orderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SHIPPED' });

      expect(res.status).toBe(422);
      expect(res.body.error.details[0].message).toContain('SHIPPED');
    });

    it('returns 404 when order does not exist', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });
      const orderId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(404);
    });
  });

  describe('Lifecycle State Transitions & History (ADR-004 §9, §15, §16, §17)', () => {
    it('rejects illegal transition skip from ORDER_CREATED to COMPLETED with 422', async () => {
      const customer = await createCustomer();
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 12000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: new Date(),
        statusHistory: [
          {
            status: ORDER_STATUS_VALUES.ORDER_CREATED,
            changedAt: new Date(),
            changedBy: customer._id,
          },
        ],
      });

      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.INVENTORY_MANAGER,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.COMPLETED });

      expect(res.status).toBe(422);

      // Verify order in database was NOT changed
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder.status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
      expect(dbOrder.statusHistory).toHaveLength(1);
    });

    it('successfully transitions ORDER_CREATED -> PROCESSING by INVENTORY_MANAGER', async () => {
      const customer = await createCustomer();
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 15000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: new Date(),
        statusHistory: [
          {
            status: ORDER_STATUS_VALUES.ORDER_CREATED,
            changedAt: new Date(),
            changedBy: customer._id,
          },
        ],
      });

      await OrderItem.create({
        orderId: order._id,
        itemName: 'Prescription Glasses',
        price: 15000,
        quantity: 1,
      });

      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.INVENTORY_MANAGER,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(res.body.data.statusHistory).toHaveLength(2);
      expect(res.body.data.statusHistory[1].status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(res.body.data.statusHistory[1].changedBy).toBe(staffId.toString());
      expect(res.body.data.items).toHaveLength(1);

      // Verify persistence in DB
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(dbOrder.statusHistory).toHaveLength(2);
    });

    it('successfully transitions to CANCELLED and locks further transitions', async () => {
      const customer = await createCustomer('canceltest@example.com');
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 18000,
        status: ORDER_STATUS_VALUES.PROCESSING,
        statusUpdatedAt: new Date(),
        statusHistory: [
          {
            status: ORDER_STATUS_VALUES.ORDER_CREATED,
            changedAt: new Date(),
            changedBy: customer._id,
          },
          {
            status: ORDER_STATUS_VALUES.PROCESSING,
            changedAt: new Date(),
            changedBy: customer._id,
          },
        ],
      });

      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
      });

      // Cancel the order
      const cancelRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.CANCELLED });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe(ORDER_STATUS_VALUES.CANCELLED);

      // Attempting further transition from CANCELLED (terminal state) must be rejected
      const nextRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.READY_FOR_PICKUP });

      expect(nextRes.status).toBe(422);
      expect(nextRes.body.error.message).toContain('terminal');
    });
  });
});
