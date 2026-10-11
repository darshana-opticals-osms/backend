const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Cart = require('../../src/models/cart.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { REORDER_ALERT_STATUS } = require('../../src/constants/inventoryAlert.constants');


const JWT_SECRET = 'checkout-api-test-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const createToken = ({ userId, role = ROLE_VALUES.CUSTOMER } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

const createCustomer = (email) =>
  Customer.create({
    name: 'Checkout Customer',
    email,
    address: '12 Main Street',
    phone: '+94711234567',
    passwordHash: PASSWORD_HASH,
  });

const createInventory = async (branchId, overrides = {}) =>
  Inventory.create({
    branchId,
    itemName: 'Classic Frame',
    category: 'Frames',
    brand: 'Optical Co',
    price: 12000,
    quantity: 7,
    ...overrides,
  });

describe('Secure Checkout API', () => {
  let app;
  let mongoServer;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
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
    await Promise.all([Cart.init(), Order.init(), OrderItem.init()]);
    app = createApp();
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      Cart.deleteMany({}),
      OrderItem.deleteMany({}),
      Order.deleteMany({}),
      Inventory.deleteMany({}),
      Customer.deleteMany({}),
      Branch.deleteMany({}),
      ReorderAlert.deleteMany({}),
    ]);

  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    process.env = originalEnv;
  }, 30000);

  const createBranch = () =>
    Branch.create({ address: 'Gampaha Branch', contactNumber: '+94 33 200 0000' });

  const createCart = (customerId, inventoryItems) =>
    Cart.create({ customerId, items: inventoryItems });

  it('should create an Order from authoritative Inventory prices and atomically deduct stock', async () => {
    const customer = await createCustomer('checkout.success@example.com');
    const branch = await createBranch();
    const frame = await createInventory(branch._id, { price: 12000.25, quantity: 7 });
    const glasses = await createInventory(branch._id, {
      itemName: 'Reading Glasses',
      price: 2500.5,
      quantity: 4,
    });
    await createCart(customer._id, [
      { inventoryId: frame._id, quantity: 2 },
      { inventoryId: glasses._id, quantity: 1 },
    ]);
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        order: {
          customerId: customer._id.toString(),
          orderAmount: 26501,
          status: 'ORDER_CREATED',
          statusHistory: [
            {
              status: 'ORDER_CREATED',
              changedBy: customer._id.toString(),
            },
          ],
        },
        items: [
          { itemName: 'Classic Frame', price: 12000.25, quantity: 2 },
          { itemName: 'Reading Glasses', price: 2500.5, quantity: 1 },
        ],
      },
    });
    expect(response.body.data.order.statusUpdatedAt).toBe(
      response.body.data.order.statusHistory[0].changedAt
    );
    expect(await Order.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await OrderItem.countDocuments({ orderId: response.body.data.order.id })).toBe(2);
    const persistedOrder = await Order.findById(response.body.data.order.id).lean();
    expect(persistedOrder.status).toBe('ORDER_CREATED');
    expect(persistedOrder.statusUpdatedAt).toEqual(persistedOrder.statusHistory[0].changedAt);
    expect(persistedOrder.statusHistory).toEqual([
      {
        status: 'ORDER_CREATED',
        changedAt: persistedOrder.statusUpdatedAt,
        changedBy: customer._id,
      },
    ]);
    expect((await Inventory.findById(frame._id)).quantity).toBe(5);
    expect((await Inventory.findById(glasses._id)).quantity).toBe(3);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it('should reject a missing or empty Cart without creating an Order', async () => {
    const customer = await createCustomer('checkout.empty@example.com');
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(409);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await Cart.countDocuments({})).toBe(0);
  });

  it('should reject missing Inventory references and preserve the Cart', async () => {
    const customer = await createCustomer('checkout.missing-inventory@example.com');
    const missingInventoryId = new mongoose.Types.ObjectId();
    await createCart(customer._id, [{ inventoryId: missingInventoryId, quantity: 1 }]);
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(404);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
  });

  it('should reject insufficient stock without changing stock or Cart', async () => {
    const customer = await createCustomer('checkout.stock@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id, { quantity: 1 });
    await createCart(customer._id, [{ inventoryId: inventory._id, quantity: 2 }]);
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(409);
    expect(await Order.countDocuments({})).toBe(0);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(1);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
  });

  it('should commit only one checkout when requests race for the same Cart', async () => {
    const customer = await createCustomer('checkout.concurrent@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id, { quantity: 5 });
    await createCart(customer._id, [{ inventoryId: inventory._id, quantity: 2 }]);
    const token = createToken({ userId: customer._id.toString() });
    const checkoutRequest = () =>
      request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send({});

    const responses = await Promise.all([checkoutRequest(), checkoutRequest()]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await Order.countDocuments({ customerId: customer._id })).toBe(1);
    expect(await OrderItem.countDocuments({})).toBe(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(3);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it('should allow only one customer to check out when customers compete for limited stock', async () => {
    const customerA = await createCustomer('checkout.stock-race.a@example.com');
    const customerB = await createCustomer('checkout.stock-race.b@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id, { quantity: 1 });
    await Promise.all([
      createCart(customerA._id, [{ inventoryId: inventory._id, quantity: 1 }]),
      createCart(customerB._id, [{ inventoryId: inventory._id, quantity: 1 }]),
    ]);
    const checkoutRequest = (customer) =>
      request(app)
        .post('/api/checkout')
        .set('Authorization', `Bearer ${createToken({ userId: customer._id.toString() })}`)
        .send({});

    const responses = await Promise.all([checkoutRequest(customerA), checkoutRequest(customerB)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await Order.countDocuments({})).toBe(1);
    expect(await OrderItem.countDocuments({})).toBe(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(0);
    expect(await Cart.countDocuments({})).toBe(1);
  });

  it('should roll back Order, OrderItems, stock changes, and Cart deletion when persistence fails', async () => {
    const customer = await createCustomer('checkout.rollback@example.com');
    const branch = await createBranch();
    const firstInventory = await createInventory(branch._id, { quantity: 5 });
    const secondInventory = await createInventory(branch._id, {
      itemName: 'Reading Glasses',
      quantity: 4,
    });
    await createCart(customer._id, [
      { inventoryId: firstInventory._id, quantity: 2 },
      { inventoryId: secondInventory._id, quantity: 1 },
    ]);
    const token = createToken({ userId: customer._id.toString() });
    const updateInventory = Inventory.updateOne.bind(Inventory);
    let stockUpdates = 0;
    jest.spyOn(Inventory, 'updateOne').mockImplementation((...args) => {
      stockUpdates += 1;
      if (stockUpdates === 2) {
        return Promise.reject(new Error('simulated stock persistence failure'));
      }
      return updateInventory(...args);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('simulated stock persistence failure');
    expect(response.body.error.stack).toBeUndefined();
    expect(stockUpdates).toBe(2);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await OrderItem.countDocuments({})).toBe(0);
    expect((await Inventory.findById(firstInventory._id)).quantity).toBe(5);
    expect((await Inventory.findById(secondInventory._id)).quantity).toBe(4);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
  });

  it('should redact internal database details from production checkout errors', async () => {
    const customer = await createCustomer('checkout.production-error@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    await createCart(customer._id, [{ inventoryId: inventory._id, quantity: 1 }]);
    const token = createToken({ userId: customer._id.toString() });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Inventory, 'find').mockReturnValue({
      session: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockRejectedValue(
          new Error('MongoDB failure mongodb://user:secret@db.internal/data C:\\private\\db')
        ),
    });

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let response;
    try {
      response = await request(app)
        .post('/api/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({});
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      message: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/mongodb|secret|db\.internal|private|stack/i);
    const loggedOutput = consoleSpy.mock.calls.flat().join(' ');
    expect(loggedOutput).not.toMatch(/secret|db\.internal|private|C:\\|\/data/i);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
  });

  it('should enforce JWT ownership, CUSTOMER RBAC, and server-controlled identity', async () => {
    const customerA = await createCustomer('checkout.owner.a@example.com');
    const customerB = await createCustomer('checkout.owner.b@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    await createCart(customerA._id, [{ inventoryId: inventory._id, quantity: 1 }]);
    const customerBToken = createToken({ userId: customerB._id.toString() });
    const staffToken = createToken({
      userId: customerA._id.toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
    });

    const anonymous = await request(app).post('/api/checkout').send({});
    const staff = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    const invalidJwt = await request(app)
      .post('/api/checkout')
      .set('Authorization', 'Bearer invalid.jwt.token')
      .send({});
    const otherCustomer = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({});

    expect(anonymous.status).toBe(401);
    expect(invalidJwt.status).toBe(401);
    expect(staff.status).toBe(403);
    expect(otherCustomer.status).toBe(409);
    expect(await Cart.countDocuments({ customerId: customerA._id })).toBe(1);
    expect(await Order.countDocuments({})).toBe(0);
  });

  it('should reject client-supplied, sanitizer-removed, non-JSON, and malformed payloads', async () => {
    const customer = await createCustomer('checkout.payload@example.com');
    const token = createToken({ userId: customer._id.toString() });

    const unsupported = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: customer._id.toString(), orderAmount: 0, items: [] });
    const sanitizerRemovedFields = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"$orderAmount":0,"customer.secret":true}');
    const nonJson = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('orderAmount=0');
    const malformed = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{');

    expect(unsupported.status).toBe(422);
    expect(sanitizerRemovedFields.status).toBe(422);
    expect(nonJson.status).toBe(422);
    expect(malformed.status).toBe(400);
    expect(await Order.countDocuments({})).toBe(0);
  });

  it('should reject malformed persisted Cart references without creating an Order', async () => {
    const customer = await createCustomer('checkout.corrupt-cart@example.com');
    await Cart.collection.insertOne({
      customerId: customer._id,
      items: [{ inventoryId: 'not-an-object-id', quantity: 1 }],
    });
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
  });

  describe('Checkout stock deduction and reorder alert integration (ADR-006 / AC5)', () => {
    it('should automatically evaluate and create a ReorderAlert when checkout stock deduction crosses threshold (quantity <= 5)', async () => {
      const branch = await Branch.create({ address: 'Colombo', contactNumber: '+94112000000' });
      // Initial stock: 7. Deduct 3 -> Remaining: 4 (which is <= 5)
      const inventory = await createInventory(branch._id, { quantity: 7 });
      const customer = await createCustomer('checkout.alert.low@example.com');
      await Cart.create({
        customerId: customer._id,
        items: [{ inventoryId: inventory._id, quantity: 3 }],
      });
      const token = createToken({ userId: customer._id.toString() });

      const response = await request(app)
        .post('/api/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(201);

      // Verify stock was decremented to 4
      const updatedInventory = await Inventory.findById(inventory._id);
      expect(updatedInventory.quantity).toBe(4);

      // Verify authoritative ReorderAlert was generated
      const activeAlert = await ReorderAlert.findOne({
        inventoryId: inventory._id,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(activeAlert).not.toBeNull();
      expect(activeAlert.currentQuantity).toBe(4);
      expect(activeAlert.threshold).toBe(5);
      expect(activeAlert.branchId.toString()).toBe(branch._id.toString());
    });

    it('should not create a ReorderAlert when checkout stock deduction leaves quantity > 5', async () => {
      const branch = await Branch.create({ address: 'Colombo', contactNumber: '+94112000000' });
      // Initial stock: 10. Deduct 2 -> Remaining: 8 (> 5)
      const inventory = await createInventory(branch._id, { quantity: 10 });
      const customer = await createCustomer('checkout.alert.normal@example.com');
      await Cart.create({
        customerId: customer._id,
        items: [{ inventoryId: inventory._id, quantity: 2 }],
      });
      const token = createToken({ userId: customer._id.toString() });

      const response = await request(app)
        .post('/api/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(201);

      const updatedInventory = await Inventory.findById(inventory._id);
      expect(updatedInventory.quantity).toBe(8);

      const count = await ReorderAlert.countDocuments({ inventoryId: inventory._id });
      expect(count).toBe(0);
    });
  });
});

