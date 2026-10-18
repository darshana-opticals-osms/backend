const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Inventory = require('../../src/models/inventory.model');
const Customer = require('../../src/models/customer.model');
const Payment = require('../../src/models/payment.model');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');

const JWT_SECRET = 'order-api-test-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const DEFAULT_STAFF_BRANCH_ID = new mongoose.Types.ObjectId().toString();

const createToken = ({ userId, role, branchId, omitBranch = false } = {}) => {
  const payload = { userId, role };
  if (!omitBranch) {
    if (branchId) {
      payload.branchId = branchId;
    } else if (role && role !== ROLE_VALUES.CUSTOMER) {
      payload.branchId = DEFAULT_STAFF_BRANCH_ID;
    }
  }
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
};

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
  let mongoServer;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: new URL(uri).host }] },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Payment.init();
    app = createApp();
  }, 60000);

  beforeEach(async () => {
    await Promise.all([
      Payment.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Inventory.deleteMany({}),
      Customer.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
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

    it('allows BRANCH_MANAGER to update order status', async () => {
      const customer = await createCustomer('bm-status@example.com');
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 10000,
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
      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({ userId: staffId.toString(), role: ROLE_VALUES.BRANCH_MANAGER });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
    });

    it('returns 403 when called by a SYSTEM_ADMIN', async () => {
      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({ userId: staffId.toString(), role: ROLE_VALUES.SYSTEM_ADMIN });
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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

    it('denies an unpaid ORDER_CREATED -> PROCESSING staff transition', async () => {
      const customer = await createCustomer('unpaid-transition@example.com');
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
      const token = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });

      const response = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('PAYMENT_REQUIRED');
      const stored = await Order.findById(order._id);
      expect(stored.status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
      expect(stored.statusHistory).toHaveLength(1);
    });

    it('successfully transitions ORDER_CREATED -> PROCESSING by BRANCH_ASSISTANT', async () => {
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

      await Inventory.create({
        branchId: DEFAULT_STAFF_BRANCH_ID,
        itemName: 'Prescription Glasses',
        category: 'FRAMES',
        brand: 'Darshana',
        price: 15000,
        quantity: 10,
      });

      await OrderItem.create({
        orderId: order._id,
        itemName: 'Prescription Glasses',
        price: 15000,
        quantity: 1,
      });
      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const staffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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
        role: ROLE_VALUES.BRANCH_ASSISTANT,
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

  describe('Staff Order Tracking Visibility (AC6, ADR-004 §13)', () => {
    it('allows BRANCH_ASSISTANT to view all orders and Customer to view only own orders', async () => {
      const customerA = await createCustomer('customera@example.com');
      const customerB = await createCustomer('customerb@example.com');

      await Order.create({
        customerId: customerA._id,
        orderDate: new Date(),
        orderAmount: 10000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: new Date(),
      });

      await Order.create({
        customerId: customerB._id,
        orderDate: new Date(),
        orderAmount: 20000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
        statusUpdatedAt: new Date(),
      });

      // Customer A query -> only 1 order
      const customerToken = createToken({
        userId: customerA._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });
      const custRes = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data).toHaveLength(1);
      expect(custRes.body.data[0].customerId).toBe(customerA._id.toString());

      // Staff query -> all 2 orders
      const staffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });
      const staffRes = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.data).toHaveLength(2);
    });

    it('allows authorized staff to view single order and blocks unauthorized roles', async () => {
      const customer = await createCustomer('singleordertest@example.com');
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 15000,
        status: ORDER_STATUS_VALUES.PROCESSING,
        statusUpdatedAt: new Date(),
      });

      await OrderItem.create({
        orderId: order._id,
        itemName: 'Progressive Lens',
        price: 15000,
        quantity: 1,
      });

      // Staff view -> 200
      const staffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });
      const staffRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.data.id).toBe(order._id.toString());
      expect(staffRes.body.data.items).toHaveLength(1);

      // Customer B (different customer) -> 404 (IDOR prevented)
      const otherCust = await createCustomer('other@example.com');
      const otherCustToken = createToken({
        userId: otherCust._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });
      const otherRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${otherCustToken}`);

      expect(otherRes.status).toBe(404);

      // Unauthorized roles -> 403 Forbidden
      for (const unauthorizedRole of [ROLE_VALUES.OPTOMETRIST, ROLE_VALUES.SYSTEM_ADMIN]) {
        const unauthRes = await request(app)
          .get(`/api/orders/${order._id}`)
          .set(
            'Authorization',
            `Bearer ${createToken({
              userId: new mongoose.Types.ObjectId().toString(),
              role: unauthorizedRole,
            })}`
          );

        expect(unauthRes.status).toBe(403);
      }

      // Authorized staff BRANCH_MANAGER can also view order tracking
      const bmToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
      });
      const bmRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${bmToken}`);
      expect(bmRes.status).toBe(200);
      expect(bmRes.body.data.id).toBe(order._id.toString());
    });

    it('omits changedBy from statusHistory for customer view, but includes it for staff (Comment 3 Security)', async () => {
      const customer = await createCustomer('changedbytest@example.com');
      const staffId = new mongoose.Types.ObjectId();
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 12000,
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
            changedBy: staffId,
          },
        ],
      });

      // Customer view -> changedBy must be undefined in history entries
      const customerToken = createToken({
        userId: customer._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });
      const custRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(custRes.status).toBe(200);
      expect(custRes.body.data.statusHistory[0].changedBy).toBeUndefined();
      expect(custRes.body.data.statusHistory[1].changedBy).toBeUndefined();

      // Staff view -> changedBy must be included
      const staffToken = createToken({
        userId: staffId.toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });
      const staffRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.data.statusHistory[1].changedBy).toBe(staffId.toString());
    });
  });

  describe('Concurrent Status Update Protection (Comment 1)', () => {
    it('handles concurrent status updates atomically and rejects conflicting requests with 422', async () => {
      const customer = await createCustomer('concurrent@example.com');
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 18000,
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
      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const staffToken1 = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });
      const staffToken2 = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
      });

      // Dispatch two concurrent status update requests from ORDER_CREATED
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/orders/${order._id}/status`)
          .set('Authorization', `Bearer ${staffToken1}`)
          .send({ status: ORDER_STATUS_VALUES.PROCESSING }),
        request(app)
          .patch(`/api/orders/${order._id}/status`)
          .set('Authorization', `Bearer ${staffToken2}`)
          .send({ status: ORDER_STATUS_VALUES.CANCELLED }),
      ]);

      const statuses = [res1.status, res2.status];
      // One request MUST succeed (200), and the conflicting concurrent request MUST be rejected (422)
      expect(statuses).toContain(200);
      expect(statuses).toContain(422);

      const rejectedRes = res1.status === 422 ? res1 : res2;
      expect(rejectedRes.body.success).toBe(false);
      expect(rejectedRes.body.error.message).toMatch(/(concurrent|transition)/i);

      // Verify the final order state in the database has exactly one transition recorded
      const finalOrder = await Order.findById(order._id);
      expect([ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.CANCELLED]).toContain(
        finalOrder.status
      );
      expect(finalOrder.statusHistory).toHaveLength(2);
    });
  });

  describe('Branch Claiming and Isolation (End-to-End API)', () => {
    it('claims order for branch at PROCESSING and enforces isolation against other branches', async () => {
      const customer = await createCustomer('branchclaim@example.com');
      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 10000,
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
      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const colomboBranchId = new mongoose.Types.ObjectId().toString();
      const kandyBranchId = new mongoose.Types.ObjectId().toString();

      const colomboStaffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: colomboBranchId,
      });

      const kandyStaffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: kandyBranchId,
      });

      // Before claiming: both branches can see the unassigned ORDER_CREATED order
      const preListColombo = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${colomboStaffToken}`);
      const preListKandy = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${kandyStaffToken}`);

      expect(preListColombo.body.data.some((o) => o.id === order._id.toString())).toBe(true);
      expect(preListKandy.body.data.some((o) => o.id === order._id.toString())).toBe(true);

      // Colombo branch claims the order into PROCESSING
      const claimRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${colomboStaffToken}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(claimRes.status).toBe(200);
      expect(claimRes.body.data.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(claimRes.body.data.branchId).toBe(colomboBranchId);

      // Verify database record has branchId set to Colombo
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder.branchId.toString()).toBe(colomboBranchId);

      // After claiming: Colombo can see the order, Kandy CANNOT see the order
      const postListColombo = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${colomboStaffToken}`);
      const postListKandy = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${kandyStaffToken}`);

      expect(postListColombo.body.data.some((o) => o.id === order._id.toString())).toBe(true);
      expect(postListKandy.body.data.some((o) => o.id === order._id.toString())).toBe(false);

      // Kandy attempts to GET single order -> 403 Forbidden
      const kandyGetRes = await request(app)
        .get(`/api/orders/${order._id}`)
        .set('Authorization', `Bearer ${kandyStaffToken}`);
      expect(kandyGetRes.status).toBe(403);
      expect(kandyGetRes.body.success).toBe(false);

      // Kandy attempts to update status -> 403 Forbidden
      const kandyPatchRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${kandyStaffToken}`)
        .send({ status: ORDER_STATUS_VALUES.READY_FOR_PICKUP });
      expect(kandyPatchRes.status).toBe(403);
      expect(kandyPatchRes.body.success).toBe(false);

      // Colombo updates status -> 200 OK
      const colomboPatchRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${colomboStaffToken}`)
        .send({ status: ORDER_STATUS_VALUES.READY_FOR_PICKUP });
      expect(colomboPatchRes.status).toBe(200);
      expect(colomboPatchRes.body.data.status).toBe(ORDER_STATUS_VALUES.READY_FOR_PICKUP);
    });

    it('deducts stock from claiming branch inventory and restores upon cancellation', async () => {
      const customer = await createCustomer('branchstock@example.com');
      const colomboBranchId = new mongoose.Types.ObjectId();
      const kandyBranchId = new mongoose.Types.ObjectId();

      // Kandy original inventory (where customer initially added to cart)
      const kandyInventory = await Inventory.create({
        branchId: kandyBranchId,
        itemName: 'Designer Sunglasses',
        category: 'SUNGLASSES',
        brand: 'Ray-Ban',
        price: 15000,
        quantity: 8,
      });

      // Colombo branch has 5 in stock
      const colomboInventory = await Inventory.create({
        branchId: colomboBranchId,
        itemName: 'Designer Sunglasses',
        category: 'SUNGLASSES',
        brand: 'Ray-Ban',
        price: 15000,
        quantity: 5,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 30000,
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
        inventoryId: kandyInventory._id,
        itemName: 'Designer Sunglasses',
        price: 15000,
        quantity: 2,
      });

      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const colomboStaffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: colomboBranchId.toString(),
      });

      // Colombo claims the order into PROCESSING
      const claimRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${colomboStaffToken}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });

      expect(claimRes.status).toBe(200);

      // Verify Colombo inventory deducted: 5 - 2 = 3
      const updatedColomboInv = await Inventory.findById(colomboInventory._id);
      expect(updatedColomboInv.quantity).toBe(3);

      // Verify Kandy original inventory was restored: 8 + 2 = 10
      const updatedKandyInv = await Inventory.findById(kandyInventory._id);
      expect(updatedKandyInv.quantity).toBe(10);

      // Now cancel the order from PROCESSING
      const cancelRes = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${colomboStaffToken}`)
        .send({ status: ORDER_STATUS_VALUES.CANCELLED });

      expect(cancelRes.status).toBe(200);

      // Verify Colombo inventory restored: 3 + 2 = 5
      const restoredColomboInv = await Inventory.findById(colomboInventory._id);
      expect(restoredColomboInv.quantity).toBe(5);
    });
  });

  describe('Review Findings Regression Tests (PR #88)', () => {
    // ─── Comment 1: IPN Lifecycle & Branch Claiming ─────────────────────────
    it('Comment 1: executes sequence checkout -> verified PayHere IPN -> branch fulfillment claim -> inventory allocation', async () => {
      const customer = await createCustomer('ipnclaim@example.com');
      const originBranchId = new mongoose.Types.ObjectId();
      const colomboBranchId = new mongoose.Types.ObjectId();

      const originInventory = await Inventory.create({
        branchId: originBranchId,
        itemName: 'Progressive Lens UV400',
        category: 'LENSES',
        brand: 'Essilor',
        price: 20000,
        quantity: 10,
      });

      const colomboInventory = await Inventory.create({
        branchId: colomboBranchId,
        itemName: 'Progressive Lens UV400',
        category: 'LENSES',
        brand: 'Essilor',
        price: 20000,
        quantity: 8,
      });

      // 1. Checkout creates order in ORDER_CREATED (online, no branchId assigned yet)
      const order = await Order.create({
        customerId: customer._id,
        branchId: null,
        orderDate: new Date(),
        orderAmount: 40000,
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
        inventoryId: originInventory._id,
        itemName: 'Progressive Lens UV400',
        price: 20000,
        quantity: 2,
        classificationSnapshot: {
          source: 'Inventory',
          sourceInventoryId: originInventory._id,
          category: 'LENSES',
          itemClassification: 'UNKNOWN',
          loyaltyEligibility: 'UNKNOWN',
        },
      });

      // 2. PayHere IPN verified notification transitions Order to PROCESSING (ADR-011)
      const payment = await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        providerTransactionId: 'PAYHERE_TXN_9999',
      });

      await Order.findByIdAndUpdate(order._id, {
        $set: { status: ORDER_STATUS_VALUES.PROCESSING, statusUpdatedAt: new Date() },
        $push: {
          statusHistory: {
            status: ORDER_STATUS_VALUES.PROCESSING,
            changedAt: new Date(),
            changedBy: null,
            source: 'PAYMENT_SYSTEM',
            paymentId: payment._id,
          },
        },
      });

      // Verify order is in PROCESSING without a branchId
      const ipnOrder = await Order.findById(order._id);
      expect(ipnOrder.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(ipnOrder.branchId).toBeNull();

      // 3. Colombo branch claims the order for fulfillment
      const colomboStaffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: colomboBranchId.toString(),
      });

      const claimRes = await request(app)
        .patch(`/api/orders/${order._id}/claim`)
        .set('Authorization', `Bearer ${colomboStaffToken}`);

      expect(claimRes.status).toBe(200);
      expect(claimRes.body.data.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(claimRes.body.data.branchId).toBe(colomboBranchId.toString());

      // 4. Inventory is allocated from Colombo branch: 8 - 2 = 6, and origin reservation restored: 10 + 2 = 12
      const updatedColomboInv = await Inventory.findById(colomboInventory._id);
      expect(updatedColomboInv.quantity).toBe(6);

      const updatedOriginInv = await Inventory.findById(originInventory._id);
      expect(updatedOriginInv.quantity).toBe(12);
    });

    // ─── Comment 2: Atomic Rollback & Competing Branches ────────────────────
    it('Comment 2a: multi-item allocation rolls back completely when an item has insufficient stock', async () => {
      const customer = await createCustomer('rollback@example.com');
      const branchId = new mongoose.Types.ObjectId();

      const itemA = await Inventory.create({
        branchId,
        itemName: 'Lens Cleaner Spray',
        category: 'ACCESSORIES',
        brand: 'OptiClean',
        price: 1500,
        quantity: 10,
      });

      const itemB = await Inventory.create({
        branchId,
        itemName: 'Microfiber Cleaning Cloth',
        category: 'ACCESSORIES',
        brand: 'OptiClean',
        price: 500,
        quantity: 1, // only 1 in stock, order needs 3!
      });

      const order = await Order.create({
        customerId: customer._id,
        branchId: null,
        orderDate: new Date(),
        orderAmount: 4500,
        status: ORDER_STATUS_VALUES.PROCESSING,
        statusUpdatedAt: new Date(),
      });

      await OrderItem.create([
        {
          orderId: order._id,
          inventoryId: itemA._id,
          itemName: 'Lens Cleaner Spray',
          price: 1500,
          quantity: 2,
          classificationSnapshot: {
            source: 'Inventory',
            sourceInventoryId: itemA._id,
            category: 'ACCESSORIES',
            itemClassification: 'UNKNOWN',
            loyaltyEligibility: 'UNKNOWN',
          },
        },
        {
          orderId: order._id,
          inventoryId: itemB._id,
          itemName: 'Microfiber Cleaning Cloth',
          price: 500,
          quantity: 3,
          classificationSnapshot: {
            source: 'Inventory',
            sourceInventoryId: itemB._id,
            category: 'ACCESSORIES',
            itemClassification: 'UNKNOWN',
            loyaltyEligibility: 'UNKNOWN',
          },
        },
      ]);

      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const staffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchId.toString(),
      });

      const claimRes = await request(app)
        .patch(`/api/orders/${order._id}/claim`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(claimRes.status).toBe(409);
      expect(claimRes.body.success).toBe(false);

      // Verify itemA was NOT deducted (atomic rollback preserved quantity 10)
      const checkItemA = await Inventory.findById(itemA._id);
      expect(checkItemA.quantity).toBe(10);

      // Order branchId remains unassigned
      const checkOrder = await Order.findById(order._id);
      expect(checkOrder.branchId).toBeNull();
    });

    it('Comment 2b: competing branches attempting concurrent claim results in single winner and clean conflict', async () => {
      const customer = await createCustomer('competing@example.com');
      const branchAId = new mongoose.Types.ObjectId();
      const branchBId = new mongoose.Types.ObjectId();

      const invA = await Inventory.create({
        branchId: branchAId,
        itemName: 'Titanium Frame Model X',
        category: 'FRAMES',
        brand: 'Titan',
        price: 25000,
        quantity: 5,
      });

      await Inventory.create({
        branchId: branchBId,
        itemName: 'Titanium Frame Model X',
        category: 'FRAMES',
        brand: 'Titan',
        price: 25000,
        quantity: 5,
      });

      const order = await Order.create({
        customerId: customer._id,
        branchId: null,
        orderDate: new Date(),
        orderAmount: 25000,
        status: ORDER_STATUS_VALUES.PROCESSING,
        statusUpdatedAt: new Date(),
      });

      await OrderItem.create({
        orderId: order._id,
        inventoryId: invA._id,
        itemName: 'Titanium Frame Model X',
        price: 25000,
        quantity: 1,
        classificationSnapshot: {
          source: 'Inventory',
          sourceInventoryId: invA._id,
          category: 'FRAMES',
          itemClassification: 'UNKNOWN',
          loyaltyEligibility: 'UNKNOWN',
        },
      });

      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const tokenA = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchAId.toString(),
      });

      const tokenB = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchBId.toString(),
      });

      const [resA, resB] = await Promise.all([
        request(app)
          .patch(`/api/orders/${order._id}/claim`)
          .set('Authorization', `Bearer ${tokenA}`),
        request(app)
          .patch(`/api/orders/${order._id}/claim`)
          .set('Authorization', `Bearer ${tokenB}`),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Winning branch is recorded on order
      const claimedOrder = await Order.findById(order._id);
      expect([branchAId.toString(), branchBId.toString()]).toContain(
        claimedOrder.branchId.toString()
      );
    });

    // ─── Comment 3: Fail-Closed Branch Authorization ────────────────────────
    it('Comment 3: rejects staff request with missing or invalid branch claim with 403 Forbidden', async () => {
      const orderId = new mongoose.Types.ObjectId();

      // Token without branchId
      const noBranchToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        omitBranch: true,
      });

      const getListRes = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${noBranchToken}`);
      expect(getListRes.status).toBe(403);

      const getSingleRes = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${noBranchToken}`);
      expect(getSingleRes.status).toBe(403);

      const patchRes = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${noBranchToken}`)
        .send({ status: ORDER_STATUS_VALUES.PROCESSING });
      expect(patchRes.status).toBe(403);
    });

    // ─── Comment 4: Authoritative Identity & Unresolved Legacy References ────
    it('Comment 4: fails allocation with ConflictError on unresolved legacy inventory reference', async () => {
      const customer = await createCustomer('unresolved@example.com');
      const branchId = new mongoose.Types.ObjectId();
      const ghostInventoryId = new mongoose.Types.ObjectId(); // does not exist in Inventory collection

      const order = await Order.create({
        customerId: customer._id,
        branchId: null,
        orderDate: new Date(),
        orderAmount: 12000,
        status: ORDER_STATUS_VALUES.PROCESSING,
        statusUpdatedAt: new Date(),
      });

      await OrderItem.create({
        orderId: order._id,
        inventoryId: ghostInventoryId,
        itemName: 'Vintage Sunglasses',
        price: 12000,
        quantity: 1,
        classificationSnapshot: {
          source: 'Inventory',
          sourceInventoryId: ghostInventoryId,
          category: 'SUNGLASSES',
          itemClassification: 'UNKNOWN',
          loyaltyEligibility: 'UNKNOWN',
        },
      });

      await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
      });

      const staffToken = createToken({
        userId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchId.toString(),
      });

      const claimRes = await request(app)
        .patch(`/api/orders/${order._id}/claim`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(claimRes.status).toBe(409);
      expect(claimRes.body.success).toBe(false);
    });
  });
});
