const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Customer = require('../../src/models/customer.model');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const Inventory = require('../../src/models/inventory.model');
const Branch = require('../../src/models/branch.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
} = require('../../src/constants/payment');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');

const JWT_SECRET = 'payment-api-test-secret';
const MERCHANT_ID = '1211149';
const MERCHANT_SECRET = 'sandbox-payment-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const tokenFor = (customer) =>
  jwt.sign({ userId: customer._id.toString(), role: ROLE_VALUES.CUSTOMER }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

describe('Payment API and PayHere IPN', () => {
  let mongoServer;
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET,
      JWT_EXPIRES_IN: '1h',
      PAYMENT_CURRENCY: 'LKR',
      PAYHERE_MODE: 'sandbox',
      PAYHERE_MERCHANT_ID: MERCHANT_ID,
      PAYHERE_MERCHANT_SECRET: MERCHANT_SECRET,
      PAYHERE_RETURN_URL: 'http://localhost:3000/payments/return',
      PAYHERE_CANCEL_URL: 'http://localhost:3000/payments/cancel',
      PAYHERE_NOTIFY_URL: 'https://example.test/api/payments/notify',
    });
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
      Order.init(),
      Payment.init(),
      PaymentEvent.init(),
      LoyaltyTransaction.init(),
    ]);
    app = createApp();
  }, 60000);

  beforeEach(async () => {
    await LoyaltyTransaction.collection.deleteMany({});
    await Promise.all([
      PaymentEvent.deleteMany({}),
      Payment.deleteMany({}),
      Order.deleteMany({}),
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    process.env = originalEnv;
  }, 60000);

  const createCustomer = (email) =>
    Customer.create({
      name: 'Payment Customer',
      email,
      address: '12 Main Street',
      phone: '+94711234567',
      passwordHash: PASSWORD_HASH,
    });

  const createOrder = (customer, overrides = {}) => {
    const now = new Date();
    return Order.create({
      customerId: customer._id,
      orderDate: now,
      orderAmount: 2500,
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      statusUpdatedAt: now,
      reservationExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      statusHistory: [
        { status: ORDER_STATUS_VALUES.ORDER_CREATED, changedAt: now, changedBy: customer._id },
      ],
      ...overrides,
    });
  };

  const initiate = (customer, order, extra = {}) =>
    request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${tokenFor(customer)}`)
      .send({ orderId: order._id.toString(), city: 'Colombo', ...extra });

  const notification = (payment, overrides = {}) => {
    const fields = {
      merchant_id: MERCHANT_ID,
      order_id: payment.providerOrderId,
      payment_id: `PH-${payment._id}`,
      payhere_amount: Number(payment.amount).toFixed(2),
      payhere_currency: payment.currency,
      status_code: '2',
      method: 'VISA',
      ...overrides,
    };
    fields.md5sig = createNotificationSignature(fields, MERCHANT_SECRET);
    return fields;
  };

  it('initiates from backend Order data and reuses one active attempt under concurrency', async () => {
    const customer = await createCustomer('pay-init@example.com');
    const order = await createOrder(customer);
    const responses = await Promise.all([initiate(customer, order), initiate(customer, order)]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body.data.payment.paymentId).toBe(responses[1].body.data.payment.paymentId);
    expect(responses[0].body.data.gateway.fields).toMatchObject({
      amount: '2500.00',
      currency: 'LKR',
      city: 'Colombo',
    });
    expect(responses[0].body.data.gateway.fields.order_id).toMatch(/^PAY-/);
    expect(responses[0].body.data.gateway.fields).toEqual(
      expect.objectContaining(responses[1].body.data.gateway.fields)
    );
    expect(JSON.stringify(responses[0].body)).not.toContain(MERCHANT_SECRET);
    const attempts = await Payment.find({ orderId: order._id });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      amount: order.orderAmount,
      currency: PAYMENT_CURRENCY.LKR,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
    });
    expect(attempts[0].expiresAt.getTime()).toBe(order.reservationExpiresAt.getTime());
    expect((await Order.findById(order._id)).orderAddress).toBe('12 Main Street');
    expect(responses[0].body.data.gateway.fields.address).toBe('12 Main Street');
  });

  it('revalidates and reuses the canonical winning attempt after a duplicate-key race', async () => {
    const customer = await createCustomer('pay-duplicate-recovery@example.com');
    const order = await createOrder(customer);
    const winningPaymentId = new mongoose.Types.ObjectId();
    // Simulate the winning transaction also having durably saved its Order address.
    await Order.updateOne({ _id: order._id }, { $set: { orderAddress: '12 Main Street' } });
    const saveSpy = jest.spyOn(Payment.prototype, 'save').mockImplementationOnce(async () => {
      const timestamp = new Date();
      await Payment.collection.insertOne({
        _id: winningPaymentId,
        orderId: order._id,
        amount: order.orderAmount,
        currency: PAYMENT_CURRENCY.LKR,
        provider: PAYMENT_PROVIDER.PAYHERE,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        status: PAYMENT_STATUS.PENDING,
        providerOrderId: `PAY-${winningPaymentId}`,
        expiresAt: order.reservationExpiresAt,
        reconciliationRequired: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const duplicateError = new Error('simulated concurrent active-attempt insert');
      duplicateError.code = 11000;
      throw duplicateError;
    });

    try {
      const response = await initiate(customer, order);

      expect(response.status).toBe(201);
      expect(response.body.data.payment.paymentId).toBe(winningPaymentId.toString());
      expect(response.body.data.gateway.fields).toMatchObject({
        order_id: `PAY-${winningPaymentId}`,
        amount: '2500.00',
        currency: PAYMENT_CURRENCY.LKR,
      });
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('concurrently rejects reuse of an active attempt that is not canonical for the Order', async () => {
    const customer = await createCustomer('pay-noncanonical-attempt@example.com');
    const order = await createOrder(customer);
    const attempt = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount + 1,
      currency: PAYMENT_CURRENCY.LKR,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });

    const responses = await Promise.all([initiate(customer, order), initiate(customer, order)]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    for (const response of responses) {
      expect(response.body.error.code).toBe('PAYMENT_ATTEMPT_NOT_REUSABLE');
    }
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    expect((await Payment.findById(attempt._id)).amount).toBe(order.orderAmount + 1);
  });

  it.each([false, true])(
    'blocks a refunded Order from checkout, including active-attempt reuse=%s',
    async (withActive) => {
      const customer = await createCustomer('pay-refunded@example.com');
      const order = await createOrder(customer);
      const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
      const inventory = await Inventory.create({
        branchId: branch._id,
        itemName: 'Frame',
        category: 'Frames',
        brand: 'Brand',
        price: 2500,
        quantity: 4,
      });
      const refunded = await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        status: PAYMENT_STATUS.REFUNDED,
        providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
        providerTransactionId: 'PH-REFUNDED',
        expiresAt: order.reservationExpiresAt,
      });
      if (withActive)
        await Payment.create({
          orderId: order._id,
          amount: order.orderAmount,
          method: PAYMENT_METHOD.ONLINE_GATEWAY,
          status: PAYMENT_STATUS.PENDING,
          providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
          expiresAt: order.reservationExpiresAt,
        });
      const before = await Order.findById(order._id).lean();
      const responses = await Promise.all([initiate(customer, order), initiate(customer, order)]);
      expect(responses.map((response) => response.status)).toEqual([409, 409]);
      for (const response of responses) {
        expect(response.body.error.code).toBe('ORDER_ALREADY_REFUNDED');
        expect(response.body).not.toHaveProperty('data.gateway');
      }
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(withActive ? 2 : 1);
      expect((await Payment.findById(refunded._id)).status).toBe(PAYMENT_STATUS.REFUNDED);
      expect(await Order.findById(order._id).lean()).toEqual(before);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(4);
      expect(await PaymentEvent.countDocuments()).toBe(0);
    }
  );

  it('rechecks refunded history during duplicate-key recovery rather than returning the winning checkout', async () => {
    const customer = await createCustomer('pay-refunded-recovery@example.com');
    const order = await createOrder(customer);
    const before = await Order.findById(order._id).lean();
    const saveSpy = jest.spyOn(Payment.prototype, 'save').mockImplementationOnce(async () => {
      const timestamp = new Date();
      const base = {
        orderId: order._id,
        amount: order.orderAmount,
        currency: PAYMENT_CURRENCY.LKR,
        provider: PAYMENT_PROVIDER.PAYHERE,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        expiresAt: order.reservationExpiresAt,
        reconciliationRequired: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await Payment.collection.insertMany([
        {
          ...base,
          _id: new mongoose.Types.ObjectId(),
          status: PAYMENT_STATUS.REFUNDED,
          providerOrderId: 'PAY-REFUNDED-RACE',
          providerTransactionId: 'PH-REFUNDED-RACE',
        },
        {
          ...base,
          _id: new mongoose.Types.ObjectId(),
          status: PAYMENT_STATUS.PENDING,
          providerOrderId: 'PAY-WINNING-RACE',
        },
      ]);
      const duplicateError = new Error('simulated concurrent attempt insert');
      duplicateError.code = 11000;
      throw duplicateError;
    });
    try {
      const response = await initiate(customer, order);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ORDER_ALREADY_REFUNDED');
      expect(response.body).not.toHaveProperty('data.gateway');
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(2);
      expect(await Order.findById(order._id).lean()).toEqual(before);
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('holds inconsistent attempt expiry without extending an unexpired Order reservation', async () => {
    const customer = await createCustomer('pay-expired-attempt@example.com');
    const order = await createOrder(customer);
    const attempt = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: new Date(Date.now() - 1000),
    });

    const responses = await Promise.all([initiate(customer, order), initiate(customer, order)]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    for (const response of responses) {
      expect(response.body.error.code).toBe('PAYMENT_ATTEMPT_NOT_REUSABLE');
    }
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    expect((await Payment.findById(attempt._id)).expiresAt.getTime()).toBe(
      attempt.expiresAt.getTime()
    );
  });

  it.each([PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING])(
    'closes a stale %s session on initiation but never creates checkout past the original deadline',
    async (status) => {
      const customer = await createCustomer(`pay-stale-${status}@example.com`);
      const order = await createOrder(customer, {
        reservationExpiresAt: new Date(Date.now() - 1000),
      });
      const attempt = await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        status,
        providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
        expiresAt: order.reservationExpiresAt,
      });
      const responses = await Promise.all([initiate(customer, order), initiate(customer, order)]);
      expect(responses.map((response) => response.status)).toEqual([409, 409]);
      for (const response of responses)
        expect(response.body.error.code).toBe('ORDER_PAYMENT_EXPIRED');
      const retained = await Payment.findById(attempt._id);
      expect(retained.status).toBe(PAYMENT_STATUS.CANCELLED);
      expect(retained.failureReason).toBe('session_expired');
      expect(retained.expiresAt).toEqual(order.reservationExpiresAt);
      expect(retained.providerOrderId).toBe(attempt.providerOrderId);
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
      const stored = await Order.findById(order._id);
      expect(stored.status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
      expect(stored.reservationExpiresAt).toEqual(order.reservationExpiresAt);
      expect(stored.statusHistory).toHaveLength(1);
      expect(stored.inventoryRestoredAt).toBeNull();
      expect(await PaymentEvent.countDocuments()).toBe(0);
    }
  );

  it.each(['reconciliation_required', 'applied'])(
    'does not cancel an expired local attempt with stored verified %s success evidence',
    async (action) => {
      const customer = await createCustomer('pay-expired-evidence@example.com');
      const order = await createOrder(customer, {
        reservationExpiresAt: new Date(Date.now() - 1000),
      });
      const payment = await Payment.create({
        orderId: order._id,
        amount: order.orderAmount,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
        expiresAt: order.reservationExpiresAt,
      });
      await PaymentEvent.create({
        eventKey: 'verified-before-expiry',
        paymentId: payment._id,
        orderId: order._id,
        providerOrderId: payment.providerOrderId,
        providerTransactionId: 'PH-VERIFIED',
        statusCode: '2',
        amount: '2500.00',
        currency: 'LKR',
        action,
      });
      const paymentBefore = await Payment.findById(payment._id).lean();
      const orderBefore = await Order.findById(order._id).lean();
      const response = await initiate(customer, order);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
      expect(await Payment.findById(payment._id).lean()).toEqual(paymentBefore);
      expect(await Order.findById(order._id).lean()).toEqual(orderBefore);
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
      expect(await PaymentEvent.countDocuments()).toBe(1);
    }
  );

  it('blocks reuse of an active attempt that already requires reconciliation', async () => {
    const customer = await createCustomer('pay-flagged-attempt@example.com');
    const order = await createOrder(customer);
    const attempt = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      currency: PAYMENT_CURRENCY.LKR,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_AMOUNT_CURRENCY_MISMATCH',
    });

    const response = await initiate(customer, order);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    expect((await Payment.findById(attempt._id)).reconciliationRequired).toBe(true);
  });

  it('uses validated billing overrides without changing the Customer profile', async () => {
    const customer = await createCustomer('pay-billing@example.com');
    const order = await createOrder(customer);

    const response = await initiate(customer, order, {
      firstName: 'Nimali',
      lastName: 'Perera',
      address: '45 Lake Road',
      city: 'Kandy',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.gateway.fields).toMatchObject({
      first_name: 'Nimali',
      last_name: 'Perera',
      address: '45 Lake Road',
      city: 'Kandy',
      amount: '2500.00',
      currency: 'LKR',
    });
    const storedCustomer = await Customer.findById(customer._id);
    expect(storedCustomer.name).toBe('Payment Customer');
    expect(storedCustomer.address).toBe('12 Main Street');
    expect((await Order.findById(order._id)).orderAddress).toBe('45 Lake Road');
  });

  it('rejects missing registered address and city before creating a payment attempt', async () => {
    const customer = await createCustomer('pay-missing-address@example.com');
    const order = await createOrder(customer);
    await Customer.updateOne({ _id: customer._id }, { $set: { address: '' } });

    const noAddress = await initiate(customer, order);
    expect(noAddress.status).toBe(422);
    expect(noAddress.body.error.code).toBe('PAYMENT_BILLING_REQUIRED');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(0);
    expect((await Order.findById(order._id)).orderAddress).toBe('');

    const noCity = await initiate(customer, order, { address: '9 New Road', city: undefined });
    expect(noCity.status).toBe(422);
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(0);

    const valid = await initiate(customer, order, { address: ' 9 New Road ', city: 'Galle' });
    expect(valid.status).toBe(201);
    expect(valid.body.data.gateway.fields.address).toBe('9 New Road');
    expect((await Order.findById(order._id)).orderAddress).toBe('9 New Road');
  });

  it('keeps one immutable address through profile changes, active reuse and failed-attempt retry', async () => {
    const customer = await createCustomer('pay-address-reuse@example.com');
    const order = await createOrder(customer);
    const first = await initiate(customer, order);
    expect(first.status).toBe(201);

    await Customer.updateOne({ _id: customer._id }, { $set: { address: '88 Changed Profile Rd' } });
    const reused = await initiate(customer, order, { address: '42 Different Road' });
    expect(reused.status).toBe(201);
    expect(reused.body.data.payment.paymentId).toBe(first.body.data.payment.paymentId);
    expect(reused.body.data.gateway.fields.address).toBe('12 Main Street');

    await Payment.updateOne(
      { _id: first.body.data.payment.paymentId },
      { $set: { status: PAYMENT_STATUS.FAILED } }
    );
    const retried = await initiate(customer, order, { address: '77 Another Road' });
    expect(retried.status).toBe(201);
    expect(retried.body.data.payment.paymentId).not.toBe(first.body.data.payment.paymentId);
    expect(retried.body.data.gateway.fields.address).toBe('12 Main Street');
    expect((await Order.findById(order._id)).orderAddress).toBe('12 Main Street');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(2);
  });

  it('uses the winning address when concurrent initiations supply different overrides', async () => {
    const customer = await createCustomer('pay-two-addresses@example.com');
    const order = await createOrder(customer);
    const results = await Promise.all([
      initiate(customer, order, { address: 'First Street' }),
      initiate(customer, order, { address: 'Second Street' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const saved = (await Order.findById(order._id)).orderAddress;
    expect(['First Street', 'Second Street']).toContain(saved);
    for (const result of results) {
      expect(result.body.data.gateway.fields.address).toBe(saved);
    }
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
  });

  it('fails closed on a legacy active attempt without a saved order address', async () => {
    const customer = await createCustomer('pay-old-active@example.com');
    const order = await createOrder(customer);
    await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      currency: PAYMENT_CURRENCY.LKR,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      provider: PAYMENT_PROVIDER.PAYHERE,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });
    const response = await initiate(customer, order, { address: 'Different Road' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_ORDER_ADDRESS_UNAVAILABLE');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    expect((await Order.findById(order._id)).orderAddress).toBe('');
  });

  it('rejects client financial fields and cross-customer initiation/status access', async () => {
    const owner = await createCustomer('pay-owner@example.com');
    const other = await createCustomer('pay-other@example.com');
    const order = await createOrder(owner);

    expect((await initiate(owner, order, { amount: 1, status: 'completed' })).status).toBe(422);
    expect((await initiate(other, order)).status).toBe(404);
    const status = await request(app)
      .get(`/api/orders/${order._id}/payment-status`)
      .set('Authorization', `Bearer ${tokenFor(other)}`);
    expect(status.status).toBe(404);
  });

  it('returns the authenticated customer own-order payment status', async () => {
    const customer = await createCustomer('pay-status@example.com');
    const order = await createOrder(customer);
    const initiation = await initiate(customer, order);

    const response = await request(app)
      .get(`/api/orders/${order._id}/payment-status`)
      .set('Authorization', `Bearer ${tokenFor(customer)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      orderId: order._id.toString(),
      paymentId: initiation.body.data.payment.paymentId,
      status: PAYMENT_STATUS.PENDING,
      amount: 2500,
      currency: 'LKR',
      orderStatus: ORDER_STATUS_VALUES.ORDER_CREATED,
      summary: {
        paid: false,
        reconciliationRequired: false,
        activeAttempt: true,
        attemptCount: 1,
      },
    });
    expect(response.body.data.latestAttempt.paymentId).toBe(initiation.body.data.payment.paymentId);
    expect(response.body.data.completedAttempt).toBeNull();
    expect(response.body.data.attempts).toHaveLength(1);
    expect(response.body.data).not.toHaveProperty('providerTransactionId');
  });

  it('returns an Order-level summary that cannot hide an older completed or reconciliation attempt', async () => {
    const customer = await createCustomer('pay-summary@example.com');
    const order = await createOrder(customer, { status: ORDER_STATUS_VALUES.PROCESSING });
    const completed = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.COMPLETED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      providerTransactionId: 'PH-COMPLETED-SUMMARY',
      expiresAt: order.reservationExpiresAt,
    });
    const latest = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.FAILED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
      reconciliationRequired: true,
      reconciliationReason: 'MANUAL_REVIEW',
    });

    const response = await request(app)
      .get(`/api/orders/${order._id}/payment-status`)
      .set('Authorization', `Bearer ${tokenFor(customer)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.paymentId).toBe(latest._id.toString());
    expect(response.body.data.summary).toEqual({
      paid: true,
      reconciliationRequired: true,
      activeAttempt: false,
      attemptCount: 2,
    });
    expect(response.body.data.completedAttempt.paymentId).toBe(completed._id.toString());
    expect(response.body.data.attempts).toHaveLength(2);
    expect(JSON.stringify(response.body.data)).not.toContain('PH-COMPLETED-SUMMARY');
  });

  it('rejects forged and mismatched notifications without state changes', async () => {
    const customer = await createCustomer('pay-forged@example.com');
    const order = await createOrder(customer);
    await initiate(customer, order);
    const payment = await Payment.findOne({ orderId: order._id });

    const forged = notification(payment);
    forged.md5sig = '0'.repeat(32);
    expect((await request(app).post('/api/payments/notify').type('form').send(forged)).status).toBe(
      403
    );

    const wrongAmount = notification(payment, { payhere_amount: '1.00' });
    const mismatches = await Promise.all([
      request(app).post('/api/payments/notify').type('form').send(wrongAmount),
      request(app).post('/api/payments/notify').type('form').send(wrongAmount),
    ]);
    expect(mismatches.map((response) => response.status)).toEqual([400, 400]);

    const wrongCurrency = notification(payment, { payhere_currency: 'USD' });
    expect(
      (await request(app).post('/api/payments/notify').type('form').send(wrongCurrency)).status
    ).toBe(400);
    const stored = await Payment.findById(payment._id);
    expect(stored.status).toBe(PAYMENT_STATUS.PENDING);
    expect(stored.reconciliationRequired).toBe(true);
    expect(await PaymentEvent.countDocuments()).toBe(2);
    expect(await PaymentEvent.countDocuments({ reason: 'PAYHERE_AMOUNT_CURRENCY_MISMATCH' })).toBe(
      2
    );
  });

  it.each([
    ['failure', '-2', PAYMENT_STATUS.FAILED],
    ['cancellation', '-1', PAYMENT_STATUS.CANCELLED],
  ])('applies a verified %s notification without changing the Order', async (_, code, status) => {
    const customer = await createCustomer(`pay-${status}@example.com`);
    const order = await createOrder(customer);
    await initiate(customer, order);
    const payment = await Payment.findOne({ orderId: order._id });
    const fields = notification(payment, { status_code: code });

    const response = await request(app).post('/api/payments/notify').type('form').send(fields);

    expect(response.status).toBe(200);
    expect((await Payment.findById(payment._id)).status).toBe(status);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
    const retry = await initiate(customer, order);
    expect(retry.status).toBe(201);
    expect(retry.body.data.payment.paymentId).not.toBe(payment._id.toString());
    expect(new Date(retry.body.data.payment.expiresAt)).toEqual(order.reservationExpiresAt);
    expect((await Payment.findById(payment._id)).status).toBe(status);
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(2);
  });

  it.each(['2', '0', '-2', '-1'])(
    'discards unrecognized unsigned method metadata for status %s without rejecting verified IPN',
    async (statusCode) => {
      const customer = await createCustomer('unsigned-method@example.com');
      const order = await createOrder(customer);
      expect((await initiate(customer, order)).status).toBe(201);
      const payment = await Payment.findOne({ orderId: order._id });
      const fields = notification(payment, { status_code: statusCode });
      // method is not covered by the signature. It must not become arbitrary stored PII.
      fields.method = `private-buyer@example.test-${'x'.repeat(50)}`;

      const response = await request(app).post('/api/payments/notify').type('form').send(fields);

      expect(response.status).toBe(200);
      const stored = await Payment.findById(payment._id).lean();
      expect(stored.providerPaymentMethod).toBeNull();
      expect(stored.status).toBe(
        { 2: 'completed', 0: 'processing', '-2': 'failed', '-1': 'cancelled' }[statusCode]
      );
      expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
      const event = await PaymentEvent.findOne({ paymentId: payment._id }).lean();
      expect(JSON.stringify([stored, event])).not.toContain(fields.method);
    }
  );

  it('accepts the observed Sandbox IPN shape including recurring without trusting or persisting metadata', async () => {
    const customer = await createCustomer('sandbox-metadata@example.com');
    const order = await createOrder(customer, { orderAmount: 37000 });
    expect((await initiate(customer, order)).status).toBe(201);
    const payment = await Payment.findOne({ orderId: order._id });
    const fields = notification(payment, {
      captured_amount: '37000.00',
      recurring: '0',
      custom_1: '',
      custom_2: '',
      status_message: 'Successfully received the VISA payment',
      card_holder_name: 'Test Customer',
      card_no: '************4564',
      card_expiry: '1230',
    });
    const forged = { ...fields, md5sig: '0'.repeat(32) };
    expect((await request(app).post('/api/payments/notify').type('form').send(forged)).status).toBe(
      403
    );
    expect((await Payment.findById(payment._id)).status).toBe(PAYMENT_STATUS.PENDING);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(await PaymentEvent.countDocuments()).toBe(0);
    const send = (body) => request(app).post('/api/payments/notify').type('form').send(body);
    expect((await send({ ...fields, captured_amount: '-1.00' })).status).toBe(422);
    expect((await send({ ...fields, arbitrary: 'untrusted' })).status).toBe(422);
    const rawBody = new URLSearchParams(fields)
      .toString()
      .replace('custom_1=', 'custom_1')
      .replace('custom_2=', 'custom_2');
    // The real callback used bare empty custom fields and one scalar recurring flag.
    const duplicate = await send(`${rawBody}&recurring=1`);
    expect(duplicate.status).toBe(422);
    expect(duplicate.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'recurring' })])
    );
    expect(await PaymentEvent.countDocuments()).toBe(0);
    expect((await Payment.findById(payment._id)).status).toBe(PAYMENT_STATUS.PENDING);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect((await send(rawBody)).status).toBe(200);
    // Unsigned optional metadata cannot cause a second financial effect on replay.
    expect((await send({ ...fields, captured_amount: '1.00', recurring: '1' })).status).toBe(200);
    const stored = await Payment.findById(payment._id).lean();
    expect(stored.status).toBe(PAYMENT_STATUS.COMPLETED);
    expect(stored.providerPaymentMethod).toBe('VISA');
    expect(stored.amount).toBe(37000);
    expect((await Order.findById(order._id)).statusHistory).toHaveLength(2);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
    const event = await PaymentEvent.findOne({ paymentId: payment._id }).lean();
    for (const field of [
      'captured_amount',
      'recurring',
      'custom_1',
      'custom_2',
      'status_message',
      'card_holder_name',
      'card_no',
      'card_expiry',
      'md5sig',
    ]) {
      expect(stored).not.toHaveProperty(field);
      expect(event).not.toHaveProperty(field);
    }
  });

  it.each([
    'PAYHERE_MERCHANT_ID',
    'PAYHERE_MERCHANT_SECRET',
    'PAYHERE_RETURN_URL',
    'PAYHERE_CANCEL_URL',
    'PAYHERE_NOTIFY_URL',
  ])('returns safe 503 with no persisted effects when %s is missing', async (field) => {
    const customer = await createCustomer('pay-unavailable@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 2500,
      quantity: 4,
    });
    const orderBefore = await Order.findById(order._id).lean();
    const inventoryBefore = await Inventory.findById(inventory._id).lean();
    const saved = process.env[field];
    try {
      process.env[field] = '';
      const response = await initiate(customer, order);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'PAYMENT_UNAVAILABLE',
          message: 'Payment gateway is temporarily unavailable.',
        },
      });
      const callback = await request(app)
        .post('/api/payments/notify')
        .type('form')
        .send(
          notification({
            _id: new mongoose.Types.ObjectId(),
            providerOrderId: 'PAY-UNAVAILABLE',
            amount: order.orderAmount,
            currency: PAYMENT_CURRENCY.LKR,
          })
        );
      expect(callback.status).toBe(503);
      expect(callback.body).toEqual(response.body);
      expect(await Payment.countDocuments({ orderId: order._id })).toBe(0);
      expect(await PaymentEvent.countDocuments()).toBe(0);
      expect(await Order.findById(order._id).lean()).toEqual(orderBefore);
      expect(await Inventory.findById(inventory._id).lean()).toEqual(inventoryBefore);
    } finally {
      process.env[field] = saved;
    }
  });

  it('applies concurrent success once, transitions Order, and never changes inventory', async () => {
    const customer = await createCustomer('pay-success@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 2500,
      quantity: 4,
    });
    await initiate(customer, order);
    const payment = await Payment.findOne({ orderId: order._id });
    const fields = notification(payment);
    const send = () => request(app).post('/api/payments/notify').type('form').send(fields);
    const responses = await Promise.all([send(), send()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await Payment.findById(payment._id)).status).toBe(PAYMENT_STATUS.COMPLETED);
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
    expect(
      updatedOrder.statusHistory.filter((entry) => entry.status === 'PROCESSING')
    ).toHaveLength(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(4);
    expect(await PaymentEvent.countDocuments()).toBe(1);
  });

  it('treats an exact successful transaction replay as idempotent', async () => {
    const customer = await createCustomer('pay-exact-replay@example.com');
    const order = await createOrder(customer);
    await initiate(customer, order);
    const payment = await Payment.findOne({ orderId: order._id });
    const fields = notification(payment);

    expect((await request(app).post('/api/payments/notify').type('form').send(fields)).status).toBe(
      200
    );
    expect((await request(app).post('/api/payments/notify').type('form').send(fields)).status).toBe(
      200
    );

    const storedPayment = await Payment.findById(payment._id);
    const storedOrder = await Order.findById(order._id);
    const storedCustomer = await Customer.findById(customer._id).select('+loyaltyBalance').lean();
    expect(storedPayment.status).toBe(PAYMENT_STATUS.COMPLETED);
    expect(storedPayment.providerTransactionId).toBe(fields.payment_id);
    expect(storedPayment.reconciliationRequired).toBe(false);
    expect(storedOrder.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
    expect(
      storedOrder.statusHistory.filter((entry) => entry.status === ORDER_STATUS_VALUES.PROCESSING)
    ).toHaveLength(1);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
    expect(await LoyaltyTransaction.countDocuments({ paymentId: payment._id })).toBe(0);
    expect(storedCustomer.loyaltyBalance.toString()).toBe('0.00');
  });

  it('flags a distinct verified successful provider transaction after completion', async () => {
    const customer = await createCustomer('pay-distinct-success@example.com');
    const order = await createOrder(customer);
    await initiate(customer, order);
    const payment = await Payment.findOne({ orderId: order._id });
    const firstSuccess = notification(payment);

    expect(
      (await request(app).post('/api/payments/notify').type('form').send(firstSuccess)).status
    ).toBe(200);
    const distinctSuccess = notification(payment, { payment_id: 'PH-DISTINCT-SUCCESS' });
    expect(
      (await request(app).post('/api/payments/notify').type('form').send(distinctSuccess)).status
    ).toBe(200);

    const storedPayment = await Payment.findById(payment._id);
    const storedOrder = await Order.findById(order._id);
    expect(storedPayment.status).toBe(PAYMENT_STATUS.COMPLETED);
    expect(storedPayment.providerTransactionId).toBe(firstSuccess.payment_id);
    expect(storedPayment.reconciliationRequired).toBe(true);
    expect(storedPayment.reconciliationReason).toBe('DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION');
    expect(
      storedOrder.statusHistory.filter((entry) => entry.status === ORDER_STATUS_VALUES.PROCESSING)
    ).toHaveLength(1);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(2);
  });

  it('records signed success on an unresolved reconciliation attempt without completing it', async () => {
    const customer = await createCustomer('pay-flagged-success@example.com');
    const order = await createOrder(customer);
    const payment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      currency: PAYMENT_CURRENCY.LKR,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_AMOUNT_CURRENCY_MISMATCH',
    });
    const fields = notification(payment);

    expect((await request(app).post('/api/payments/notify').type('form').send(fields)).status).toBe(
      200
    );
    expect((await request(app).post('/api/payments/notify').type('form').send(fields)).status).toBe(
      200
    );

    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(storedPayment.providerTransactionId).toBeNull();
    expect(storedPayment.reconciliationRequired).toBe(true);
    expect(storedPayment.reconciliationReason).toBe('PAYHERE_AMOUNT_CURRENCY_MISMATCH');
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
    expect(
      await PaymentEvent.countDocuments({
        paymentId: payment._id,
        reason: 'SUCCESS_WHILE_RECONCILIATION_PENDING',
      })
    ).toBe(1);
  });

  it('records late success and chargeback as reconciliation evidence without unsafe transitions', async () => {
    const customer = await createCustomer('pay-reconcile@example.com');
    const order = await createOrder(customer);
    const payment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.FAILED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });

    const lateSuccess = notification(payment);
    expect(
      (await request(app).post('/api/payments/notify').type('form').send(lateSuccess)).status
    ).toBe(200);
    let stored = await Payment.findById(payment._id);
    expect(stored.status).toBe(PAYMENT_STATUS.FAILED);
    expect(stored.reconciliationRequired).toBe(true);

    const chargeback = notification(payment, { status_code: '-3', payment_id: 'PH-CHARGEBACK' });
    expect(
      (await request(app).post('/api/payments/notify').type('form').send(chargeback)).status
    ).toBe(200);
    stored = await Payment.findById(payment._id);
    expect(stored.status).toBe(PAYMENT_STATUS.FAILED);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(2);
  });

  it('blocks a new attempt after late success flags a failed Payment for reconciliation', async () => {
    const customer = await createCustomer('pay-failed-reconciliation@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000001' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Lens',
      category: 'Lenses',
      brand: 'Brand',
      price: 2500,
      quantity: 6,
    });
    const payment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.FAILED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });

    const lateSuccess = notification(payment);
    expect(
      (await request(app).post('/api/payments/notify').type('form').send(lateSuccess)).status
    ).toBe(200);
    const response = await initiate(customer, order);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(storedPayment.reconciliationRequired).toBe(true);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(6);
  });

  it('keeps initiation blocked when a flagged active Payment receives a signed failure', async () => {
    const customer = await createCustomer('pay-flagged-failure@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000002' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 2500,
      quantity: 5,
    });
    const payment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      currency: PAYMENT_CURRENCY.LKR,
      provider: PAYMENT_PROVIDER.PAYHERE,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_AMOUNT_CURRENCY_MISMATCH',
    });
    const signedFailure = notification(payment, { status_code: '-2' });

    expect(
      (await request(app).post('/api/payments/notify').type('form').send(signedFailure)).status
    ).toBe(200);
    const response = await initiate(customer, order);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(storedPayment.reconciliationRequired).toBe(true);
    expect(storedPayment.reconciliationReason).toBe('PAYHERE_AMOUNT_CURRENCY_MISMATCH');
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(5);
  });

  it('does not complete a newer attempt while an older attempt requires reconciliation', async () => {
    const customer = await createCustomer('pay-other-reconciliation@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000003' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 2500,
      quantity: 4,
    });
    const failedPayment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.FAILED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });
    const initiation = await initiate(customer, order);
    const activePayment = await Payment.findById(initiation.body.data.payment.paymentId);

    expect(
      (
        await request(app)
          .post('/api/payments/notify')
          .type('form')
          .send(notification(failedPayment))
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/payments/notify')
          .type('form')
          .send(notification(activePayment))
      ).status
    ).toBe(200);

    const storedFailedPayment = await Payment.findById(failedPayment._id);
    const storedActivePayment = await Payment.findById(activePayment._id);
    expect(storedFailedPayment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(storedFailedPayment.reconciliationRequired).toBe(true);
    expect(storedActivePayment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(storedActivePayment.reconciliationRequired).toBe(false);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(4);
    expect(
      await PaymentEvent.countDocuments({
        paymentId: activePayment._id,
        reason: 'OTHER_PAYMENT_RECONCILIATION_PENDING',
      })
    ).toBe(1);
  });

  it('serializes concurrent late and current successes before completing the newer attempt', async () => {
    const customer = await createCustomer('pay-concurrent-reconciliation@example.com');
    const order = await createOrder(customer);
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000004' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 2500,
      quantity: 3,
    });
    const failedPayment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.FAILED,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
    });
    const initiation = await initiate(customer, order);
    const activePayment = await Payment.findById(initiation.body.data.payment.paymentId);

    let releaseReconciliation;
    let reconciliationUpdateStarted;
    let competingOrderLockStarted;
    let reconciliationHoldsOrderLock = false;
    const releaseReconciliationPromise = new Promise((resolve) => {
      releaseReconciliation = resolve;
    });
    const reconciliationUpdateStartedPromise = new Promise((resolve) => {
      reconciliationUpdateStarted = resolve;
    });
    const competingOrderLockStartedPromise = new Promise((resolve) => {
      competingOrderLockStarted = resolve;
    });
    const originalPaymentUpdateOne = Payment.updateOne.bind(Payment);
    const originalOrderUpdateOne = Order.updateOne.bind(Order);
    const paymentUpdateSpy = jest
      .spyOn(Payment, 'updateOne')
      .mockImplementation((filter, update, options) => {
        if (
          filter._id?.toString() === failedPayment._id.toString() &&
          update?.$set?.reconciliationRequired
        ) {
          reconciliationHoldsOrderLock = true;
          reconciliationUpdateStarted();
          return releaseReconciliationPromise.then(() =>
            originalPaymentUpdateOne(filter, update, options)
          );
        }
        return originalPaymentUpdateOne(filter, update, options);
      });
    const orderUpdateSpy = jest
      .spyOn(Order, 'updateOne')
      .mockImplementation((filter, update, options) => {
        if (reconciliationHoldsOrderLock && update?.$inc?.__v) {
          competingOrderLockStarted();
        }
        return originalOrderUpdateOne(filter, update, options);
      });

    try {
      const lateSuccessRequest = request(app)
        .post('/api/payments/notify')
        .type('form')
        .send(notification(failedPayment))
        .then((response) => response);
      await reconciliationUpdateStartedPromise;
      const currentSuccessRequest = request(app)
        .post('/api/payments/notify')
        .type('form')
        .send(notification(activePayment))
        .then((response) => response);
      await competingOrderLockStartedPromise;
      releaseReconciliation();

      const responses = await Promise.all([lateSuccessRequest, currentSuccessRequest]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
    } finally {
      releaseReconciliation();
      paymentUpdateSpy.mockRestore();
      orderUpdateSpy.mockRestore();
    }

    const storedFailedPayment = await Payment.findById(failedPayment._id);
    const storedActivePayment = await Payment.findById(activePayment._id);
    expect(storedFailedPayment.status).toBe(PAYMENT_STATUS.FAILED);
    expect(storedFailedPayment.reconciliationRequired).toBe(true);
    expect(storedActivePayment.status).toBe(PAYMENT_STATUS.PENDING);
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(3);
    expect(
      await PaymentEvent.countDocuments({
        paymentId: activePayment._id,
        reason: 'OTHER_PAYMENT_RECONCILIATION_PENDING',
      })
    ).toBe(1);
  });

  it('records verified success after reservation expiry without completing Payment or Order', async () => {
    const customer = await createCustomer('pay-expired-success@example.com');
    const expiredAt = new Date(Date.now() - 1000);
    const order = await createOrder(customer, { reservationExpiresAt: expiredAt });
    const payment = await Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.PENDING,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: expiredAt,
    });
    const fields = notification(payment);

    const responses = await Promise.all([
      request(app).post('/api/payments/notify').type('form').send(fields),
      request(app).post('/api/payments/notify').type('form').send(fields),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(storedPayment.reconciliationRequired).toBe(true);
    expect(storedPayment.reconciliationReason).toBe('LATE_SUCCESS_RESERVATION_EXPIRED');
    expect((await Order.findById(order._id)).status).toBe(ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
  });
});
