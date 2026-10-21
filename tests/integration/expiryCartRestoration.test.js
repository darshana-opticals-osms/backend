const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Cart = require('../../src/models/cart.model');
const Customer = require('../../src/models/customer.model');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const {
  sweepExpiredReservations,
  cancelUnpaidReservation,
} = require('../../src/services/orderReservation.service');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');
const { domainEvents, ORDER_EVENTS } = require('../../src/utils/domainEvents');
const { updateOrderStatus } = require('../../src/services/order.service');
const swagger = require('../../src/config/swagger');

const SECRET = 'cart-expiry-http-test-secret';
const MERCHANT_SECRET = 'cart-expiry-provider-test-secret';
const PASSWORD = 'CartExpiry-Test123!';
const WINDOW_MS = 30 * 60 * 1000;

describe('Automatic unpaid expiry Cart recovery (isolated HTTP and transactions)', () => {
  let server;
  let app;
  let originalEnv;
  let passwordHash;
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: SECRET,
      JWT_EXPIRES_IN: '1h',
      PAYHERE_MODE: 'sandbox',
      PAYMENT_CURRENCY: 'LKR',
      PAYHERE_MERCHANT_ID: '1211149',
      PAYHERE_MERCHANT_SECRET: MERCHANT_SECRET,
      PAYHERE_RETURN_URL: 'http://localhost:3000/return',
      PAYHERE_CANCEL_URL: 'http://localhost:3000/cancel',
      PAYHERE_NOTIFY_URL: 'https://example.test/api/payments/notify',
    });
    server = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = server.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: new URL(uri).host }] },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    passwordHash = await bcrypt.hash(PASSWORD, 4);
    await Promise.all([Cart.init(), Payment.init(), PaymentEvent.init(), ReorderAlert.init()]);
    app = createApp();
  }, 60000);
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(domainEvents, 'emit');
    await mongoose.connection.db.dropDatabase();
    await Promise.all([
      Cart.createIndexes(),
      Payment.createIndexes(),
      PaymentEvent.createIndexes(),
      ReorderAlert.createIndexes(),
    ]);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);

  const tokenFor = (customer) =>
    jwt.sign({ userId: customer._id.toString(), role: 'CUSTOMER' }, SECRET, { expiresIn: '1h' });
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const newCustomer = () =>
    Customer.create({
      name: 'Recovery Customer',
      email: `recovery-${new mongoose.Types.ObjectId()}@example.com`,
      address: '12 Test Road',
      phone: '+94711234567',
      passwordHash,
    });
  async function ensureFulfillmentBranch() {
    let branch = await Branch.findOne({ codeName: 'GAMPAHA_CENTRAL' });
    if (!branch) {
      branch = await Branch.create({
        codeName: 'GAMPAHA_CENTRAL',
        address: 'Test Branch',
        contactNumber: '+94332000000',
      });
    }
    return branch;
  }

  async function inventory(overrides = {}) {
    const branch = await ensureFulfillmentBranch();
    return Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Test',
      price: 100,
      quantity: 8,
      itemClassification: 'MERCHANDISE',
      ...overrides,
    });
  }
  const selections = (cart) =>
    Object.fromEntries(
      (cart?.items || []).map((item) => [item.inventoryId.toString(), item.quantity])
    );
  const getCart = (source) => request(app).get('/api/cart').set(auth(source.token));
  const checkout = (source) => request(app).post('/api/checkout').set(auth(source.token)).send({});
  async function purchase(quantities = [2]) {
    const customer = await newCustomer();
    const token = tokenFor(customer);
    const inventories = [];
    for (const [index, quantity] of quantities.entries()) {
      inventories.push(await inventory({ itemName: `Item ${index}`, price: 100 * (index + 1) }));
      expect(quantity).toBeGreaterThan(0);
    }
    await Cart.create({
      customerId: customer._id,
      items: inventories.map((item, index) => ({
        inventoryId: item._id,
        quantity: quantities[index],
      })),
    });
    const source = { customer, token, inventories, quantities };
    const response = await checkout(source);
    expect(response.status).toBe(201);
    source.order = await Order.findById(response.body.data.order.id);
    expect((await getCart(source)).body.data.items).toEqual([]);
    return source;
  }
  const expire = (source) => sweepExpiredReservations({ now: source.order.reservationExpiresAt });
  const attempt = (source, status = 'pending', overrides = {}) =>
    Payment.create({
      orderId: source.order._id,
      amount: source.order.orderAmount,
      method: 'online_gateway',
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      status,
      expiresAt: source.order.reservationExpiresAt,
      ...overrides,
    });
  const notify = (payment, code = '2') => {
    const fields = {
      merchant_id: '1211149',
      order_id: payment.providerOrderId,
      payment_id: `PH-${payment._id}`,
      payhere_amount: payment.amount.toFixed(2),
      payhere_currency: 'LKR',
      status_code: code,
    };
    fields.md5sig = createNotificationSignature(fields, MERCHANT_SECRET);
    return request(app).post('/api/payments/notify').type('form').send(fields);
  };
  async function snapshot(source) {
    return {
      order: await Order.findById(source.order._id).lean(),
      cart: await Cart.findOne({ customerId: source.customer._id }).lean(),
      inventories: await Inventory.find({
        _id: { $in: source.inventories.map((item) => item._id) },
      })
        .sort({ _id: 1 })
        .lean(),
      payments: await Payment.find({ orderId: source.order._id }).sort({ _id: 1 }).lean(),
      alerts: await ReorderAlert.find({}).sort({ _id: 1 }).lean(),
    };
  }

  function expectHeld(before, after) {
    const { __v: previousVersion, updatedAt: previousWrite, ...previousOrder } = before.order;
    const { __v: nextVersion, updatedAt: nextWrite, ...nextOrder } = after.order;
    // A held sweep still commits the established Order coordination write.
    expect(nextVersion).toBe(previousVersion + 1);
    expect(nextWrite.getTime()).toBeGreaterThanOrEqual(previousWrite.getTime());
    expect({ ...after, order: nextOrder }).toEqual({ ...before, order: previousOrder });
  }

  it('runs authenticated HTTP Cart -> checkout -> expiry -> Cart -> NEW checkout/payment using current Inventory and Swagger', async () => {
    const customer = await newCustomer();
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: customer.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const source = { customer, token: login.body.data.token };
    const items = [
      await inventory({ itemName: 'Frame' }),
      await inventory({ itemName: 'Sunglasses', price: 200 }),
      await inventory({ itemName: 'Lens Cleaner', price: 50 }),
    ];
    const quantities = [1, 2, 1];
    for (let index = 0; index < items.length; index += 1) {
      expect(
        (
          await request(app)
            .post('/api/cart/items')
            .set(auth(source.token))
            .send({ inventoryId: items[index]._id.toString(), quantity: quantities[index] })
        ).status
      ).toBe(200);
    }
    const expected = Object.fromEntries(
      items.map((item, index) => [item._id.toString(), quantities[index]])
    );
    expect(selections((await getCart(source)).body.data)).toEqual(expected);
    const first = await checkout(source);
    expect(first.status).toBe(201);
    const oldOrder = await Order.findById(first.body.data.order.id);
    expect(oldOrder.orderAmount).toBe(550);
    expect((await getCart(source)).body.data.items).toEqual([]);
    const firstPayment = await request(app)
      .post('/api/payments/initiate')
      .set(auth(source.token))
      .send({ orderId: oldOrder._id.toString(), city: 'Colombo' });
    expect(firstPayment.status).toBe(201);
    const originalPayment = await Payment.findById(firstPayment.body.data.payment.paymentId);

    // Advance Date only; MongoDB/socket timers and monotonic clocks remain real.
    jest.useFakeTimers({
      now: oldOrder.reservationExpiresAt.getTime() + 1000,
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
      ],
    });
    expect((await sweepExpiredReservations()).cancelled).toBe(1);
    expect(selections((await getCart(source)).body.data)).toEqual(expected);
    expect((await Payment.findById(originalPayment._id)).failureReason).toBe('session_expired');
    for (const item of items) expect((await Inventory.findById(item._id)).quantity).toBe(8);
    for (let retry = 0; retry < 2; retry += 1) {
      const rejected = await request(app)
        .post('/api/payments/initiate')
        .set(auth(source.token))
        .send({ orderId: oldOrder._id.toString(), city: 'Colombo' });
      expect(rejected.status).toBe(409);
    }
    expect(await Payment.countDocuments({ orderId: oldOrder._id })).toBe(1);
    await Inventory.updateOne({ _id: items[0]._id }, { $set: { price: 150 } });
    await Inventory.updateOne({ _id: items[1]._id }, { $set: { price: 210 } });
    await Inventory.updateOne({ _id: items[2]._id }, { $set: { price: 55, quantity: 3 } });
    const second = await checkout(source);
    expect(second.status).toBe(201);
    const newOrder = await Order.findById(second.body.data.order.id);
    expect(newOrder._id.equals(oldOrder._id)).toBe(false);
    expect(newOrder.orderAmount).toBe(625);
    expect(newOrder.orderDate.getTime()).toBeGreaterThan(oldOrder.reservationExpiresAt.getTime());
    expect(newOrder.reservationExpiresAt.getTime() - newOrder.orderDate.getTime()).toBe(WINDOW_MS);
    expect((await getCart(source)).body.data.items).toEqual([]);
    const secondPayment = await request(app)
      .post('/api/payments/initiate')
      .set(auth(source.token))
      .send({ orderId: newOrder._id.toString(), city: 'Colombo' });
    expect(secondPayment.status).toBe(201);
    expect(secondPayment.body.data.gateway.fields.order_id).not.toBe(
      originalPayment.providerOrderId
    );
    for (const [index, remaining] of [7, 6, 2].entries())
      expect((await Inventory.findById(items[index]._id)).quantity).toBe(remaining);
    expect((await Order.findById(oldOrder._id)).status).toBe('CANCELLED');
    expect((await Order.findById(oldOrder._id)).orderAmount).toBe(550);
    expect(await OrderItem.countDocuments({ orderId: oldOrder._id })).toBe(3);
    expect(swagger.paths['/cart'].get.description).toContain('automatic unpaid reservation expiry');
    expect(swagger.paths['/checkout'].post.description).toContain('distinct new Order');
    const docs = await request(app).get('/api-docs/');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('swagger-ui');
  });

  it('preserves a newer Cart, combines matching IDs, and restores once across concurrent workers', async () => {
    const source = await purchase([1, 2, 1]);
    const extra = await inventory();
    const cart = await Cart.create({
      customerId: source.customer._id,
      items: [
        { inventoryId: source.inventories[1]._id, quantity: 3 },
        { inventoryId: extra._id, quantity: 4 },
      ],
    });
    const results = await Promise.all([expire(source), expire(source), expire(source)]);
    expect(results.reduce((total, result) => total + result.cancelled, 0)).toBe(1);
    const restored = await Cart.findOne({ customerId: source.customer._id });
    expect(restored._id).toEqual(cart._id);
    expect(selections(restored)).toEqual({
      [source.inventories[0]._id]: 1,
      [source.inventories[1]._id]: 5,
      [source.inventories[2]._id]: 1,
      [extra._id]: 4,
    });
    expect(restored.items).toHaveLength(4);
    const before = await snapshot(source);
    expect((await expire(source)).cancelled).toBe(0);
    expect(await snapshot(source)).toEqual(before);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      ORDER_EVENTS.STATUS_CHANGED,
      expect.objectContaining({
        orderId: source.order._id,
        targetStatus: 'CANCELLED',
      })
    );
  });

  it.each(['pending', 'processing', 'failed', 'cancelled'])(
    'recovers selections from genuinely expired unpaid %s purchases',
    async (status) => {
      const source = await purchase();
      const payment = await attempt(source, status);
      expect((await expire(source)).cancelled).toBe(1);
      expect(selections(await Cart.findOne({ customerId: source.customer._id }))).toEqual({
        [source.inventories[0]._id]: 2,
      });
      expect((await Inventory.findById(source.inventories[0]._id)).quantity).toBe(8);
      const retained = await Payment.findById(payment._id);
      expect(retained.status).toBe(
        ['pending', 'processing'].includes(status) ? 'cancelled' : status
      );
      expect(retained.providerOrderId).toBe(payment.providerOrderId);
    }
  );

  it('does not recover a verified completed purchase or an unexpired pending purchase', async () => {
    const source = await purchase();
    const payment = await attempt(source);
    expect(
      (
        await sweepExpiredReservations({
          now: new Date(source.order.reservationExpiresAt.getTime() - 1),
        })
      ).examined
    ).toBe(0);
    expect(await Cart.countDocuments({ customerId: source.customer._id })).toBe(0);
    expect((await notify(payment)).status).toBe(200);
    const before = await snapshot(source);
    expect((await expire(source)).cancelled).toBe(0);
    expect(await snapshot(source)).toEqual(before);
  });

  it('retains a reconciliation hold without Cart or Inventory recovery', async () => {
    const source = await purchase();
    const payment = await attempt(source, 'failed');
    expect((await notify(payment)).status).toBe(200);
    const before = await snapshot(source);
    expect((await expire(source)).held[0].reason).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expectHeld(before, await snapshot(source));
    expect(before.cart).toBeNull();
  });

  it('preserves restored selections and stock on late success/replay without reviving the expired Order', async () => {
    const source = await purchase();
    const payment = await attempt(source);
    expect((await expire(source)).cancelled).toBe(1);
    const before = await snapshot(source);
    expect((await notify(payment)).status).toBe(200);
    expect((await notify(payment)).status).toBe(200);
    const after = await snapshot(source);
    expect(after.cart).toEqual(before.cart);
    expect(after.inventories).toEqual(before.inventories);
    expect(after.order.status).toBe('CANCELLED');
    expect(after.order.statusHistory).toEqual(before.order.statusHistory);
    expect(after.payments[0].status).toBe('cancelled');
    expect(after.payments[0].reconciliationRequired).toBe(true);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
  });

  it('rolls back local payment expiry, Inventory/alerts, Order/history and partial Cart writes on failure', async () => {
    const source = await purchase([1, 2]);
    await attempt(source);
    const before = await snapshot(source);
    const original = Cart.findOneAndUpdate.bind(Cart);
    let writes = 0;
    const spy = jest
      .spyOn(Cart, 'findOneAndUpdate')
      .mockImplementation((filter, pipeline, options) => {
        if (options?.session && ++writes === 2) throw new Error('simulated Cart write failure');
        return original(filter, pipeline, options);
      });
    expect((await expire(source)).failed).toHaveLength(1);
    expect(await snapshot(source)).toEqual(before);
    expect(domainEvents.emit).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await expire(source)).cancelled).toBe(1);
    expect((await Cart.findOne({ customerId: source.customer._id })).items).toHaveLength(2);
  });

  it('rejects merged quantity overflow without truncation or partial recovery', async () => {
    const source = await purchase([1, 2]);
    await attempt(source);
    await Cart.create({
      customerId: source.customer._id,
      items: [{ inventoryId: source.inventories[1]._id, quantity: Number.MAX_SAFE_INTEGER }],
    });
    const before = await snapshot(source);
    const result = await expire(source);
    expect(result.failed[0].code).toBe('CART_QUANTITY_OVERFLOW');
    expect(await snapshot(source)).toEqual(before);
    expect(domainEvents.emit).not.toHaveBeenCalled();
  });

  it.each(['missing-reference', 'deleted-inventory', 'invalid-quantity'])(
    'holds %s without malformed Cart recovery',
    async (kind) => {
      const source = await purchase();
      const item = await OrderItem.findOne({ orderId: source.order._id });
      // Deliberate corruption of this disposable test database only.
      if (kind === 'missing-reference')
        await OrderItem.collection.updateOne({ _id: item._id }, { $set: { inventoryId: null } });
      if (kind === 'deleted-inventory')
        await Inventory.deleteOne({ _id: source.inventories[0]._id });
      if (kind === 'invalid-quantity')
        await OrderItem.collection.updateOne({ _id: item._id }, { $set: { quantity: 1.5 } });
      const before = await snapshot(source);
      expect((await expire(source)).held[0].reason).toBe('INVENTORY_RESTORATION_UNVERIFIABLE');
      expectHeld(before, await snapshot(source));
    }
  );

  it.each([
    'negative-quantity',
    'string-reference',
    'string-quantity',
    'duplicate-reference',
    'empty',
  ])('holds a malformed persisted current Cart (%s) rather than overwriting it', async (kind) => {
    const source = await purchase();
    const inventoryId = source.inventories[0]._id;
    let items = [{ inventoryId, quantity: 1 }];
    if (kind === 'negative-quantity') items[0].quantity = -1;
    if (kind === 'string-reference') items[0].inventoryId = inventoryId.toString();
    if (kind === 'string-quantity') items[0].quantity = '1';
    if (kind === 'duplicate-reference') items.push({ inventoryId, quantity: 2 });
    if (kind === 'empty') items = [];
    await Cart.collection.insertOne({
      customerId: source.customer._id,
      items,
    });
    const before = await snapshot(source);
    expect((await expire(source)).failed).toHaveLength(1);
    expect(await snapshot(source)).toEqual(before);
  });

  it('does not restore Cart selections on ordinary staff cancellation', async () => {
    const source = await purchase();
    await updateOrderStatus(
      source.order._id.toString(),
      'CANCELLED',
      new mongoose.Types.ObjectId().toString()
    );
    expect((await Inventory.findById(source.inventories[0]._id)).quantity).toBe(8);
    expect((await getCart(source)).body.data.items).toEqual([]);
    expect((await expire(source)).cancelled).toBe(0);
  });

  it('revalidates reduced available stock without losing the restored Cart on failed new checkout', async () => {
    const source = await purchase();
    expect((await expire(source)).cancelled).toBe(1);
    await Inventory.updateOne({ _id: source.inventories[0]._id }, { $set: { quantity: 1 } });
    const before = await snapshot(source);
    expect((await checkout(source)).status).toBe(409);
    expect(await snapshot(source)).toEqual(before);
    expect(await Order.countDocuments({ customerId: source.customer._id })).toBe(1);
  });

  it('keeps recovery and HTTP Cart/Order access scoped to the original Customer', async () => {
    const source = await purchase();
    const other = await newCustomer();
    const token = tokenFor(other);
    const extra = await inventory();
    await Cart.create({ customerId: other._id, items: [{ inventoryId: extra._id, quantity: 3 }] });
    const otherBefore = await Cart.findOne({ customerId: other._id }).lean();
    expect((await expire(source)).cancelled).toBe(1);
    expect(await Cart.findOne({ customerId: other._id }).lean()).toEqual(otherBefore);
    expect(
      (await request(app).get(`/api/orders/${source.order._id}/payment-status`).set(auth(token)))
        .status
    ).toBe(404);
    expect(
      (await request(app).get(`/api/cart?customerId=${source.customer._id}`).set(auth(token)))
        .status
    ).toBe(422);
    expect(
      (
        await request(app).post('/api/cart/items').set(auth(token)).send({
          customerId: source.customer._id.toString(),
          inventoryId: extra._id.toString(),
          quantity: 1,
        })
      ).status
    ).toBe(422);
    expect(await Cart.findOne({ customerId: other._id }).lean()).toEqual(otherBefore);
    expect(selections((await getCart(source)).body.data)).toEqual({
      [source.inventories[0]._id]: 2,
    });
  });

  it.each(['add', 'set', 'remove'])(
    'preserves a concurrent Customer Cart %s through a transaction retry',
    async (edit) => {
      const source = await purchase();
      const item = source.inventories[0];
      const extra = await inventory();
      await Cart.create({
        customerId: source.customer._id,
        items: [
          { inventoryId: item._id, quantity: 1 },
          { inventoryId: extra._id, quantity: 4 },
        ],
      });
      const original = Cart.findOneAndUpdate.bind(Cart);
      let injected = false;
      jest.spyOn(Cart, 'findOneAndUpdate').mockImplementation(async (filter, pipeline, options) => {
        if (options?.session && !injected) {
          injected = true;
          let response;
          if (edit === 'add')
            response = await request(app)
              .post('/api/cart/items')
              .set(auth(source.token))
              .send({ inventoryId: item._id.toString(), quantity: 3 });
          if (edit === 'set')
            response = await request(app)
              .patch(`/api/cart/items/${item._id}`)
              .set(auth(source.token))
              .send({ quantity: 5 });
          if (edit === 'remove')
            response = await request(app)
              .delete(`/api/cart/items/${extra._id}`)
              .set(auth(source.token));
          expect(response.status).toBe(200);
        }
        return original(filter, pipeline, options);
      });
      expect((await expire(source)).cancelled).toBe(1);
      expect(injected).toBe(true);
      const restored = selections(await Cart.findOne({ customerId: source.customer._id }));
      expect(restored[item._id]).toBe({ add: 6, set: 7, remove: 3 }[edit]);
      if (edit === 'remove') expect(restored).not.toHaveProperty(extra._id.toString());
      else expect(restored[extra._id]).toBe(4);
      expect((await Inventory.findById(item._id)).quantity).toBe(8);
    }
  );

  it('recovers a real first-Cart unique-key/write-conflict race after transaction abort', async () => {
    const source = await purchase();
    await attempt(source);
    const extra = await inventory();
    const original = Cart.create.bind(Cart);
    let injected = false;
    let collision = null;
    jest.spyOn(Cart, 'create').mockImplementation(async (data, options) => {
      if (options?.session && !injected) {
        injected = true;
        const response = await request(app)
          .post('/api/cart/items')
          .set(auth(source.token))
          .send({ inventoryId: extra._id.toString(), quantity: 3 });
        expect(response.status).toBe(200);
        try {
          return await original(data, options);
        } catch (error) {
          collision = error.code;
          throw error;
        }
      }
      return original(data, options);
    });
    expect((await expire(source)).cancelled).toBe(1);
    expect([11000, 112]).toContain(collision);
    expect(await Cart.countDocuments({ customerId: source.customer._id })).toBe(1);
    expect(selections(await Cart.findOne({ customerId: source.customer._id }))).toEqual({
      [source.inventories[0]._id]: 2,
      [extra._id]: 3,
    });
    expect((await Inventory.findById(source.inventories[0]._id)).quantity).toBe(8);
    expect((await Order.findById(source.order._id)).statusHistory).toHaveLength(2);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      ORDER_EVENTS.STATUS_CHANGED,
      expect.objectContaining({
        orderId: source.order._id,
        targetStatus: 'CANCELLED',
      })
    );
  });

  it('bounds persistent duplicate-key retries and rolls back every attempted recovery', async () => {
    const source = await purchase();
    await attempt(source);
    const before = await snapshot(source);
    const spy = jest
      .spyOn(Cart, 'create')
      .mockRejectedValue(
        Object.assign(new Error('simulated duplicate customer Cart'), { code: 11000 })
      );
    expect((await expire(source)).failed).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await snapshot(source)).toEqual(before);
    expect(domainEvents.emit).not.toHaveBeenCalled();
  });

  it('merges two distinct expiring Orders into the same newer Customer Cart', async () => {
    const source = await purchase();
    const secondItem = await inventory();
    await Cart.create({
      customerId: source.customer._id,
      items: [{ inventoryId: secondItem._id, quantity: 3 }],
    });
    const response = await checkout(source);
    expect(response.status).toBe(201);
    const secondOrder = await Order.findById(response.body.data.order.id);
    const extra = await inventory();
    const currentCart = await Cart.create({
      customerId: source.customer._id,
      items: [{ inventoryId: extra._id, quantity: 4 }],
    });
    const now = secondOrder.reservationExpiresAt;
    const outcomes = await Promise.all(
      [source.order, secondOrder].map((order) =>
        cancelUnpaidReservation({ orderId: order._id, now, expiry: true })
      )
    );
    expect(outcomes.map((outcome) => outcome.action)).toEqual(['cancelled', 'cancelled']);
    expect(await Cart.countDocuments({ customerId: source.customer._id })).toBe(1);
    const restored = await Cart.findOne({ customerId: source.customer._id });
    expect(restored._id).toEqual(currentCart._id);
    expect(selections(restored)).toEqual({
      [source.inventories[0]._id]: 2,
      [secondItem._id]: 3,
      [extra._id]: 4,
    });
    for (const item of [source.inventories[0], secondItem, extra])
      expect((await Inventory.findById(item._id)).quantity).toBe(8);
    expect(domainEvents.emit).toHaveBeenCalledTimes(2);
  });

  it('serializes expiry against a new Customer checkout without losing or duplicating selections', async () => {
    const source = await purchase();
    const item = source.inventories[0];
    await Cart.create({
      customerId: source.customer._id,
      items: [{ inventoryId: item._id, quantity: 1 }],
    });
    const [expired, response] = await Promise.all([expire(source), checkout(source)]);
    expect(expired.cancelled).toBe(1);
    expect(response.status).toBe(201);
    const newItems = await OrderItem.find({ orderId: response.body.data.order.id });
    const committed = newItems.reduce((total, line) => total + line.quantity, 0);
    const cart = selections(await Cart.findOne({ customerId: source.customer._id }));
    expect(committed + (cart[item._id] || 0)).toBe(3);
    expect((await Inventory.findById(item._id)).quantity).toBe(8 - committed);
    expect((await Order.findById(source.order._id)).status).toBe('CANCELLED');
  });
});
