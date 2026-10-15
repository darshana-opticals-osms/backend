const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const Evidence = require('../../src/models/paymentRetrievalEvidence.model');
const Customer = require('../../src/models/customer.model');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const OrderItem = require('../../src/models/orderItem.model');
const Cart = require('../../src/models/cart.model');
const { recoverPayment } = require('../../src/services/paymentRecovery.service');
const { cancelUnpaidReservation } = require('../../src/services/orderReservation.service');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');
jest.mock('../../src/services/notification.service', () => ({
  sendOrderCancellationNotification: jest.fn().mockResolvedValue({ delivered: true }),
}));

const secret = 'retrieval-integration-jwt-secret';
const managerId = new mongoose.Types.ObjectId().toString();
const auth = { role: 'BRANCH_MANAGER', userId: managerId };
const token = (role = 'BRANCH_MANAGER') =>
  jwt.sign({ userId: managerId, role }, secret, { expiresIn: '1h' });
let sequence = 0;

describe('Controlled PayHere retrieval and recovery (mock provider only)', () => {
  let server, app, originalEnv, fetchSpy, providerResponse;
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: secret,
      JWT_EXPIRES_IN: '1h',
      PAYHERE_MODE: 'sandbox',
      PAYHERE_MERCHANT_ID: 'test-merchant',
      PAYHERE_MERCHANT_SECRET: 'retrieval-checkout-test-secret',
      PAYHERE_RETURN_URL: 'http://localhost:3000/return',
      PAYHERE_CANCEL_URL: 'http://localhost:3000/cancel',
      PAYHERE_NOTIFY_URL: 'https://example.test/api/payments/notify',
      PAYHERE_API_APP_SECRET: 'test-oauth-secret',
      PAYHERE_RETRIEVAL_TIMEOUT_MS: '1000',
    });
    server = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = server.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db
      .admin()
      .command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: new URL(uri).host }] } });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([
      Order.init(),
      Payment.init(),
      PaymentEvent.init(),
      Evidence.init(),
      Cart.init(),
    ]);
    app = createApp();
  }, 60000);
  beforeEach(async () => {
    process.env.PAYHERE_API_APP_ID = `test-app-${++sequence}`;
    process.env.PAYHERE_API_APP_SECRET = 'test-oauth-secret';
    await Evidence.collection.deleteMany({});
    await OrderItem.collection.deleteMany({});
    await Promise.all([
      PaymentEvent.deleteMany({}),
      Payment.deleteMany({}),
      Order.deleteMany({}),
      Cart.deleteMany({}),
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
    ]);
    providerResponse = { status: -1, data: null };
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            url.endsWith('/oauth/token')
              ? {
                  access_token: 'test-retrieval-token',
                  token_type: 'bearer',
                  expires_in: 599,
                  scope: 'SANDBOX',
                }
              : providerResponse
          )
        )
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);
  async function fixture(overrides = {}) {
    const now = new Date();
    const customer = await Customer.create({
      name: 'Retrieval Customer',
      email: `retrieval-${sequence}@example.test`,
      address: 'Test Address',
      phone: '+94711234567',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Test',
      price: 100,
      quantity: 5,
    });
    const order = await Order.create({
      customerId: customer._id,
      orderDate: now,
      orderAmount: 200,
      status: 'ORDER_CREATED',
      reservationExpiresAt: new Date(now.getTime() + 1800000),
      statusHistory: [{ status: 'ORDER_CREATED', changedAt: now, changedBy: customer._id }],
      ...overrides,
    });
    await OrderItem.create({
      orderId: order._id,
      inventoryId: inventory._id,
      itemName: 'Frame',
      price: 100,
      quantity: 2,
    });
    const paymentId = new mongoose.Types.ObjectId();
    const payment = await Payment.create({
      _id: paymentId,
      orderId: order._id,
      amount: 200,
      currency: 'LKR',
      method: 'online_gateway',
      provider: 'payhere',
      providerOrderId: `PAY-${paymentId}`,
      status: 'pending',
      expiresAt: order.reservationExpiresAt,
    });
    providerResponse = {
      status: 1,
      data: [
        {
          payment_id: 'PH-CAPTURE',
          order_id: payment.providerOrderId,
          status: 'RECEIVED',
          amount: 200,
          currency: 'LKR',
          customer: { email: 'private-pii' },
          payment_method: { card_no: 'private-card' },
        },
      ],
    };
    return { order, payment, inventory, customer };
  }
  const pathFor = (p) => `/api/payments/${p._id}/recovery`;
  const post = (payment, body = {}, role = 'BRANCH_MANAGER') =>
    request(app)
      .post(pathFor(payment))
      .set('Authorization', `Bearer ${token(role)}`)
      .send(body);
  const snapshot = async ({ order, payment, inventory, customer }) => ({
    order: await Order.findById(order._id).lean(),
    payment: await Payment.findById(payment._id).lean(),
    inventory: await Inventory.findById(inventory._id).lean(),
    cart: await Cart.findOne({ customerId: customer._id }).lean(),
    customer: await Customer.findById(customer._id).lean(),
    events: await PaymentEvent.find({ paymentId: payment._id }).lean(),
  });
  function signed(payment) {
    const fields = {
      merchant_id: 'test-merchant',
      order_id: payment.providerOrderId,
      payment_id: 'PH-CAPTURE',
      payhere_amount: '200.00',
      payhere_currency: 'LKR',
      status_code: '2',
      recurring: '0',
    };
    fields.md5sig = createNotificationSignature(fields, 'retrieval-checkout-test-secret');
    return fields;
  }
  const callback = (payment) =>
    request(app).post('/api/payments/notify').type('form').send(signed(payment));
  it('defaults to a truly read-only investigation and strips provider PII/credentials', async () => {
    const data = await fixture();
    const before = await snapshot(data);
    const response = await post(data.payment);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      dryRun: true,
      completionPermitted: false,
      proposedReconciliationReason: 'RETRIEVAL_SUCCESS_REQUIRES_IPN',
      source: 'PAYHERE_RETRIEVAL_API',
      outcome: 'records',
      reconciliationRequired: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|token|secret|md5sig|card_no|customer/
    );
    expect(await snapshot(data)).toEqual(before);
    expect(await Evidence.countDocuments()).toBe(0);
  });
  it('records successful missing-IPN evidence once without completing or changing stock/Cart', async () => {
    const data = await fixture();
    const before = await snapshot(data);
    const responses = await Promise.all([
      post(data.payment, { dryRun: false }),
      post(data.payment, { dryRun: false }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.map((r) => r.body.data.replay).sort()).toEqual([false, true]);
    expect(await Evidence.countDocuments()).toBe(1);
    const stored = await snapshot(data);
    expect(stored.payment).toMatchObject({
      status: 'pending',
      providerTransactionId: null,
      reconciliationRequired: true,
      reconciliationReason: 'RETRIEVAL_SUCCESS_REQUIRES_IPN',
    });
    expect(stored.order.status).toBe('ORDER_CREATED');
    expect(stored.order.statusHistory).toEqual(before.order.statusHistory);
    expect(stored.inventory).toEqual(before.inventory);
    expect(stored.cart).toEqual(before.cart);
    expect(stored.customer).toEqual(before.customer);
    expect(stored.events).toEqual([]);
    const evidence = await Evidence.findOne().lean();
    expect(evidence.source).toBe('PAYHERE_RETRIEVAL_API');
    expect(JSON.stringify(evidence)).not.toMatch(/private|secret|access_token|card_no|md5sig/);
  });
  it('records late provider success after genuine expiry without reviving or altering restored stock/Cart', async () => {
    const data = await fixture({ reservationExpiresAt: new Date(Date.now() - 1000) });
    expect((await cancelUnpaidReservation({ orderId: data.order._id, expiry: true })).action).toBe(
      'cancelled'
    );
    const before = await snapshot(data);
    const response = await post(data.payment, { dryRun: false });
    expect(response.status).toBe(200);
    expect(response.body.data.evidence.reconciliationReason).toBe('RETRIEVAL_LATE_SUCCESS');
    const after = await snapshot(data);
    expect(after.payment.status).toBe('cancelled');
    expect(after.payment.failureReason).toBe('session_expired');
    expect(after.payment.reconciliationRequired).toBe(true);
    expect(after.order.status).toBe('CANCELLED');
    expect(after.order.statusHistory).toEqual(before.order.statusHistory);
    expect(after.order.inventoryRestoredAt).toEqual(before.order.inventoryRestoredAt);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.cart).toEqual(before.cart);
    expect((await callback(data.payment)).status).toBe(200);
    expect((await Payment.findById(data.payment._id)).status).toBe('cancelled');
    expect((await PaymentEvent.findOne()).reason).toBe('LATE_SUCCESS_TERMINAL_ATTEMPT');
    expect(await Evidence.countDocuments()).toBe(1);
  });
  it.each([
    [0, 'pending'],
    [-1, 'not_found'],
    [-2, 'declined_or_error'],
  ])('does not treat envelope %s as proof of no capture', async (status, outcome) => {
    const data = await fixture();
    const before = await snapshot(data);
    providerResponse = { status, data: null };
    const response = await post(data.payment, { dryRun: false });
    expect(response.status).toBe(200);
    expect(response.body.data.evidence).toMatchObject({ outcome, reconciliationReason: null });
    expect(await snapshot(data)).toMatchObject({
      payment: before.payment,
      inventory: before.inventory,
      cart: before.cart,
      customer: before.customer,
      events: [],
    });
    expect((await Order.findById(data.order._id)).status).toBe('ORDER_CREATED');
  });
  it.each([{ amount: 199 }, { currency: 'USD' }, { order_id: 'PAY-other' }])(
    'holds context mismatch %# without applying financial state',
    async (extra) => {
      const data = await fixture();
      Object.assign(providerResponse.data[0], extra);
      const response = await post(data.payment, { dryRun: false });
      expect(response.status).toBe(200);
      expect(response.body.data.evidence.reconciliationReason).toBe('RETRIEVAL_CONTEXT_MISMATCH');
      expect((await Payment.findById(data.payment._id)).status).toBe('pending');
      expect((await Order.findById(data.order._id)).status).toBe('ORDER_CREATED');
      expect(await PaymentEvent.countDocuments()).toBe(0);
    }
  );
  it('detects distinct captures instead of selecting a convenient successful row', async () => {
    const data = await fixture();
    providerResponse.data.push({ ...providerResponse.data[0], payment_id: 'PH-SECOND-CAPTURE' });
    const response = await post(data.payment, { dryRun: false });
    expect(response.body.data.evidence.reconciliationReason).toBe(
      'RETRIEVAL_MULTIPLE_PROVIDER_PAYMENTS'
    );
    expect(response.body.data.evidence.records).toHaveLength(2);
    expect((await Payment.findById(data.payment._id)).providerTransactionId).toBeNull();
  });
  it.each(['REFUND REQUESTED', 'REFUND PROCESSING', 'REFUNDED', 'CHARGEBACKED'])(
    'audits %s without recording an OSMS refund or loyalty effects',
    async (status) => {
      const data = await fixture();
      providerResponse.data[0].status = status;
      const before = await snapshot(data);
      const response = await post(data.payment, { dryRun: false });
      expect(response.body.data.evidence.reconciliationReason).toBe(
        status === 'CHARGEBACKED' ? 'RETRIEVAL_CHARGEBACK_REVIEW' : 'RETRIEVAL_REFUND_REVIEW'
      );
      const after = await snapshot(data);
      expect(after.payment.status).toBe('pending');
      expect(after.inventory).toEqual(before.inventory);
      expect(after.customer).toEqual(before.customer);
      expect(after.cart).toEqual(before.cart);
    }
  );
  it('preserves an existing reconciliation reason and never clears it after an absent result', async () => {
    const data = await fixture();
    await Payment.updateOne(
      { _id: data.payment._id },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: 'PAYHERE_AMOUNT_CURRENCY_MISMATCH',
        },
      }
    );
    await post(data.payment, { dryRun: false });
    providerResponse = { status: -1, data: null };
    await post(data.payment, { dryRun: false });
    const payment = await Payment.findById(data.payment._id);
    expect(payment.reconciliationRequired).toBe(true);
    expect(payment.reconciliationReason).toBe('PAYHERE_AMOUNT_CURRENCY_MISMATCH');
    expect(await Evidence.countDocuments()).toBe(2);
  });
  it('preserves a callback-first completion without duplicating financial effects', async () => {
    const data = await fixture();
    expect((await callback(data.payment)).status).toBe(200);
    const before = await snapshot(data);
    const response = await post(data.payment, { dryRun: false });
    expect(response.body.data.evidence.reconciliationReason).toBeNull();
    expect((await Payment.findById(data.payment._id)).reconciliationRequired).toBe(false);
    expect((await Payment.findById(data.payment._id)).status).toBe('completed');
    expect((await Order.findById(data.order._id).lean()).statusHistory).toEqual(
      before.order.statusHistory
    );
    expect((await snapshot(data)).inventory).toEqual(before.inventory);
    expect(await PaymentEvent.countDocuments()).toBe(1);
  });
  it('serializes simultaneous callback and retrieval application without duplicate transitions', async () => {
    const data = await fixture();
    const before = await snapshot(data);
    const responses = await Promise.all([
      post(data.payment, { dryRun: false }),
      callback(data.payment),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const after = await snapshot(data);
    if (after.payment.status === 'completed') {
      expect(after.order.status).toBe('PROCESSING');
      expect(after.order.statusHistory).toHaveLength(2);
    } else {
      expect(after.payment.status).toBe('pending');
      expect(after.payment.reconciliationRequired).toBe(true);
      expect(after.order.status).toBe('ORDER_CREATED');
      expect(after.order.statusHistory).toHaveLength(1);
    }
    expect(after.inventory).toEqual(before.inventory);
    expect(after.cart).toEqual(before.cart);
    expect(after.events).toHaveLength(1);
    expect(await Evidence.countDocuments()).toBe(1);
  });
  it('does not open a transaction across HTTP and rechecks callback completion after retrieval', async () => {
    const data = await fixture();
    const startSession = jest.spyOn(mongoose, 'startSession');
    const original = fetchSpy.getMockImplementation();
    fetchSpy.mockImplementation(async (url, options) => {
      if (!url.endsWith('/oauth/token')) {
        expect(startSession).not.toHaveBeenCalled();
        expect((await callback(data.payment)).status).toBe(200);
      }
      return original(url, options);
    });
    const response = await post(data.payment, { dryRun: false });
    expect(response.status).toBe(200);
    expect(response.body.data.evidence.reconciliationReason).toBeNull();
    expect((await Payment.findById(data.payment._id)).status).toBe('completed');
    expect((await Order.findById(data.order._id)).statusHistory).toHaveLength(2);
    expect(await PaymentEvent.countDocuments()).toBe(1);
  });
  it('rechecks expiry that commits during retrieval without double-restoring inventory or Cart', async () => {
    const data = await fixture({ reservationExpiresAt: new Date(Date.now() - 1000) });
    const original = fetchSpy.getMockImplementation();
    fetchSpy.mockImplementation(async (url, options) => {
      if (!url.endsWith('/oauth/token')) {
        expect(
          (await cancelUnpaidReservation({ orderId: data.order._id, expiry: true })).action
        ).toBe('cancelled');
      }
      return original(url, options);
    });
    const response = await post(data.payment, { dryRun: false });
    expect(response.status).toBe(200);
    expect(response.body.data.evidence.reconciliationReason).toBe('RETRIEVAL_LATE_SUCCESS');
    expect((await Order.findById(data.order._id)).statusHistory).toHaveLength(2);
    expect((await Inventory.findById(data.inventory._id)).quantity).toBe(7);
    expect((await Cart.findOne({ customerId: data.customer._id })).items).toHaveLength(1);
    expect((await Cart.findOne({ customerId: data.customer._id })).items[0].quantity).toBe(2);
    expect(await Evidence.countDocuments()).toBe(1);
  });
  it('holds expiry after explicit verified-success evidence application without extending the deadline', async () => {
    const data = await fixture({ reservationExpiresAt: new Date(Date.now() - 1000) });
    await post(data.payment, { dryRun: false });
    const before = await snapshot(data);
    expect((await cancelUnpaidReservation({ orderId: data.order._id, expiry: true })).reason).toBe(
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
    const after = await snapshot(data);
    expect(after.order.reservationExpiresAt).toEqual(before.order.reservationExpiresAt);
    expect(after.order.statusHistory).toEqual(before.order.statusHistory);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.cart).toEqual(before.cart);
  });
  it('rolls back the Order lock and reconciliation flag if audit persistence fails', async () => {
    const data = await fixture();
    const before = await snapshot(data);
    jest.spyOn(Evidence, 'create').mockRejectedValueOnce(new Error('test audit insert failure'));
    await expect(
      recoverPayment({ auth, paymentId: data.payment._id.toString(), dryRun: false })
    ).rejects.toThrow('test audit insert failure');
    expect(await snapshot(data)).toEqual(before);
    expect(await Evidence.countDocuments()).toBe(0);
  });
  it('keeps all database state unchanged on upstream authentication/failure', async () => {
    const data = await fixture();
    const before = await snapshot(data);
    fetchSpy.mockResolvedValue(new Response('sensitive upstream text', { status: 401 }));
    const response = await post(data.payment, { dryRun: false });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PAYHERE_RETRIEVAL_AUTH_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(await snapshot(data)).toEqual(before);
    expect(await Evidence.countDocuments()).toBe(0);
  });
  it('fails closed when optional API credentials are absent', async () => {
    const data = await fixture();
    process.env.PAYHERE_API_APP_SECRET = '';
    const response = await post(data.payment);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PAYHERE_RETRIEVAL_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await Evidence.countDocuments()).toBe(0);
  });
  it.each(['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN'])(
    'denies recovery/evidence access to %s before provider requests',
    async (role) => {
      const id = new mongoose.Types.ObjectId();
      expect((await post({ _id: id }, {}, role)).status).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/payments/${id}/retrieval-evidence`)
            .set('Authorization', `Bearer ${token(role)}`)
        ).status
      ).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );
  it('requires authentication and rejects retired MANAGEMENT', async () => {
    const id = new mongoose.Types.ObjectId();
    expect((await request(app).post(`/api/payments/${id}/recovery`).send({})).status).toBe(401);
    expect((await post({ _id: id }, {}, 'MANAGEMENT')).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([
    { dryRun: 'false' },
    { amount: 1 },
    { status: 'completed' },
    { providerOrderId: 'other' },
    { dryRun: [false] },
  ])('rejects client-controlled fields and invalid inputs %#', async (body) => {
    const response = await post({ _id: new mongoose.Types.ObjectId() }, body);
    expect(response.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('validates identifiers, query parameters and missing/legacy attempts before any provider request', async () => {
    expect((await post({ _id: 'invalid' })).status).toBe(422);
    expect((await post({ _id: new mongoose.Types.ObjectId() })).status).toBe(404);
    const data = await fixture();
    expect(
      (
        await request(app)
          .post(pathFor(data.payment) + '?dryRun=false')
          .set('Authorization', `Bearer ${token()}`)
          .send({})
      ).status
    ).toBe(422);
    await Payment.collection.updateOne(
      { _id: data.payment._id },
      { $unset: { providerOrderId: '' } }
    );
    expect((await post(data.payment)).status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('provides bounded sanitized evidence history and rejects audit mutation paths', async () => {
    const data = await fixture();
    await post(data.payment, { dryRun: false });
    const url = `/api/payments/${data.payment._id}/retrieval-evidence`;
    const response = await request(app)
      .get(url + '?page=1&limit=1')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(response.body.data.items[0].source).toBe('PAYHERE_RETRIEVAL_API');
    expect(JSON.stringify(response.body)).not.toMatch(
      /observationKey|recordedBy|private|token|secret/
    );
    for (const query of ['page=0', 'limit=101', 'page=1&page=2', 'status=RECEIVED'])
      expect(
        (
          await request(app)
            .get(url + '?' + query)
            .set('Authorization', `Bearer ${token()}`)
        ).status
      ).toBe(422);
    const evidence = await Evidence.findOne();
    const rawEvidence = await Evidence.collection.findOne({ _id: evidence._id });
    await expect(
      Evidence.collection.insertOne({ ...rawEvidence, _id: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      Evidence.updateOne({ _id: evidence._id }, { $set: { outcome: 'not_found' } })
    ).rejects.toMatchObject({ errorCode: 'RETRIEVAL_EVIDENCE_APPEND_ONLY' });
    await expect(evidence.deleteOne()).rejects.toMatchObject({
      errorCode: 'RETRIEVAL_EVIDENCE_APPEND_ONLY',
    });
    await expect(Evidence.replaceOne({ _id: evidence._id }, {})).rejects.toMatchObject({
      errorCode: 'RETRIEVAL_EVIDENCE_APPEND_ONLY',
    });
    await expect(Evidence.bulkWrite([])).rejects.toMatchObject({
      errorCode: 'RETRIEVAL_EVIDENCE_APPEND_ONLY',
    });
    for (const mutation of [
      () => Evidence.updateMany({}, { $set: { outcome: 'not_found' } }),
      () => Evidence.findOneAndUpdate({}, { $set: { outcome: 'not_found' } }),
      () => Evidence.findOneAndReplace({}, {}),
      () => Evidence.deleteOne({}),
      () => Evidence.deleteMany({}),
      () => Evidence.findOneAndDelete({}),
      () => Evidence.insertMany([rawEvidence]),
      () => evidence.save({ validateBeforeSave: false }),
      () => Evidence.aggregate([{ $out: 'forbidden_retrieval_copy' }]),
      () => Evidence.aggregate([{ $merge: 'forbidden_retrieval_copy' }]),
    ]) {
      await expect(mutation()).rejects.toThrow(/append-only|immutable/);
    }
    expect(await Evidence.aggregate([{ $match: { _id: evidence._id } }])).toHaveLength(1);
    expect(await Evidence.countDocuments()).toBe(1);
    expect(
      await mongoose.connection.db.listCollections({ name: 'forbidden_retrieval_copy' }).toArray()
    ).toHaveLength(0);
    evidence.records = [];
    await expect(evidence.save()).rejects.toThrow(/immutable|append-only/);
    expect((await Evidence.findById(evidence._id)).records).toHaveLength(1);
  });
});
