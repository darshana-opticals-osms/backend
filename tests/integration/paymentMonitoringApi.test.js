const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const Order = require('../../src/models/order.model');

const JWT_SECRET = 'management-payment-monitoring-test-secret';
const token = (role = 'BRANCH_MANAGER', userId = new mongoose.Types.ObjectId().toString()) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

describe('BRANCH_MANAGER payment monitoring APIs', () => {
  let server;
  let app;
  let originalEnv;
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET, JWT_EXPIRES_IN: '1h' });
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all([Payment.init(), PaymentEvent.init()]);
    app = createApp();
  }, 60000);
  beforeEach(async () => {
    await Promise.all([PaymentEvent.deleteMany({}), Payment.deleteMany({}), Order.deleteMany({})]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);

  const payment = (overrides = {}) =>
    Payment.create({
      orderId: new mongoose.Types.ObjectId(),
      amount: 100,
      method: 'online_gateway',
      status: 'failed',
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      ...overrides,
    });
  const event = (attempt, overrides = {}) =>
    PaymentEvent.create({
      paymentId: attempt._id,
      orderId: attempt.orderId,
      providerOrderId: attempt.providerOrderId,
      providerTransactionId: 'PH-VERIFIED',
      eventKey: new mongoose.Types.ObjectId().toString(),
      statusCode: '2',
      amount: '100.00',
      currency: 'LKR',
      action: 'reconciliation_required',
      reason: 'LATE_SUCCESS_TERMINAL_ATTEMPT',
      ...overrides,
    });
  const get = (path, query = {}, auth = token()) =>
    request(app).get(path).set('Authorization', `Bearer ${auth}`).query(query);
  const paths = [
    '/api/payments',
    '/api/payments/507f1f77bcf86cd799439011',
    '/api/payments/507f1f77bcf86cd799439011/events',
  ];

  it.each(paths)('requires authentication before reading %s', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });
  it.each(['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN'])(
    'denies all management monitoring endpoints to %s',
    async (role) => {
      for (const path of paths) expect((await get(path, {}, token(role))).status).toBe(403);
    }
  );
  it('rejects a retired MANAGEMENT token instead of reviving the role', async () => {
    expect((await get('/api/payments', {}, token('MANAGEMENT'))).status).toBe(401);
  });
  it('returns all historical attempts with bounded defaults and stable pagination', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const createdAt = new Date('2026-10-01T10:00:00Z');
    const a = await payment({ orderId, status: 'failed', createdAt });
    const b = await payment({ orderId, status: 'cancelled', createdAt });
    const c = await payment({ orderId, status: 'pending', createdAt });
    const first = await get('/api/payments', { limit: '2' });
    const second = await get('/api/payments', { limit: '2', page: '2' });
    expect(first.status).toBe(200);
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(
      [...first.body.data.items, ...second.body.data.items].map((item) => item.paymentId)
    ).toEqual([c, b, a].map((item) => item._id.toString()));
    const defaults = await get('/api/payments');
    expect(defaults.body.data.pagination).toMatchObject({ page: 1, limit: 25, total: 3 });
    expect((await get('/api/payments', { page: '10000', limit: '100' })).body.data.items).toEqual(
      []
    );
  });
  it('combines status, Order, provider reference and reconciliation filters using exact matching', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const flagged = await payment({
      orderId,
      reconciliationRequired: true,
      reconciliationReason: 'LATE_SUCCESS_TERMINAL_ATTEMPT',
      providerTransactionId: 'PH.[literal]',
    });
    await payment({ orderId, status: 'cancelled' });
    await payment({ reconciliationRequired: true, providerTransactionId: 'PH-OTHER' });
    const filtered = await get('/api/payments', {
      orderId: orderId.toString(),
      status: 'failed',
      reconciliationRequired: 'true',
      providerTransactionId: 'PH.[literal]',
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items.map((item) => item.paymentId)).toEqual([
      flagged._id.toString(),
    ]);
    expect(filtered.body.data.items[0].reconciliationReason).toBe('LATE_SUCCESS_TERMINAL_ATTEMPT');
    expect((await get('/api/payments', { providerTransactionId: 'PH.*' })).body.data.items).toEqual(
      []
    );
    expect(
      (await get('/api/payments', { reconciliationRequired: 'false' })).body.data.items
    ).toHaveLength(1);
  });
  it('treats absent legacy reconciliation flags as not flagged and keeps old attempts visible', async () => {
    const legacy = await payment();
    await Payment.collection.updateOne(
      { _id: legacy._id },
      { $unset: { reconciliationRequired: '', providerOrderId: '' } }
    );
    const response = await get('/api/payments', { reconciliationRequired: 'false' });
    expect(response.body.data.items[0]).toMatchObject({
      paymentId: legacy._id.toString(),
      reconciliationRequired: false,
      providerOrderId: null,
    });
  });
  it('sorts amounts ascending and descending without accepting arbitrary field names', async () => {
    await payment({ amount: 300 });
    await payment({ amount: 100 });
    const asc = await get('/api/payments', { sortBy: 'amount', sortOrder: 'asc' });
    const desc = await get('/api/payments', { sortBy: 'amount', sortOrder: 'desc' });
    expect(asc.body.data.items.map((item) => item.amount)).toEqual([100, 300]);
    expect(desc.body.data.items.map((item) => item.amount)).toEqual([300, 100]);
  });
  it.each([
    { page: '0' },
    { page: '10001' },
    { limit: '101' },
    { limit: '2.5' },
    { status: 'PAID' },
    { reconciliationRequired: '1' },
    { orderId: 'invalid' },
    { sortBy: '__v' },
    { sortOrder: 'ascending' },
    { providerTransactionId: 'x'.repeat(121) },
    { 'status[]': ['failed', 'pending'] },
    { 'providerTransactionId[$ne]': 'x' },
    { customerId: 'ignored-authority' },
  ])('rejects invalid listing input %j', async (query) => {
    const response = await get('/api/payments', query);
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
  });
  it('returns safe detail and event DTOs even if legacy records contain sensitive extra fields', async () => {
    const attempt = await payment({
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_CHARGEBACK_REVIEW',
      providerTransactionId: 'PH-DETAIL',
      providerPaymentMethod: 'VISA',
    });
    const evidence = await event(attempt, {
      reason: 'PAYHERE_CHARGEBACK_REVIEW',
      statusCode: '-3',
    });
    const poison = {
      merchantSecret: 'private-merchant-secret',
      md5sig: 'private-signature',
      rawPayload: { cvv: 'sensitive-cvv' },
      customerEmail: 'private@example.com',
      card_no: 'sensitive-card',
    };
    await Payment.collection.updateOne(
      { _id: attempt._id },
      { $set: { ...poison, failureReason: 'private-provider-error' } }
    );
    await PaymentEvent.collection.updateOne({ _id: evidence._id }, { $set: poison });
    const detail = await get(`/api/payments/${attempt._id}`);
    const events = await get(`/api/payments/${attempt._id}/events`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      paymentId: attempt._id.toString(),
      providerTransactionId: 'PH-DETAIL',
      providerPaymentMethod: 'VISA',
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_CHARGEBACK_REVIEW',
      failureReason: null,
    });
    expect(events.body.data.items[0]).toMatchObject({
      eventId: evidence._id.toString(),
      statusCode: '-3',
      action: 'reconciliation_required',
      reason: 'PAYHERE_CHARGEBACK_REVIEW',
    });
    for (const dto of [detail.body.data, ...events.body.data.items]) {
      expect(dto).not.toHaveProperty('_id');
      expect(dto).not.toHaveProperty('__v');
      expect(dto).not.toHaveProperty('eventKey');
    }
    const serialized = JSON.stringify([detail.body, events.body]);
    for (const secret of [
      'private-',
      'sensitive-',
      'merchantSecret',
      'md5sig',
      'rawPayload',
      'customerEmail',
      'card_no',
    ])
      expect(serialized).not.toContain(secret);
  });
  it('pages verified events and filters distinct successful transaction evidence without applying financial state', async () => {
    const attempt = await payment({
      reconciliationRequired: true,
      reconciliationReason: 'DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION',
    });
    const unrelated = await payment();
    await event(attempt, {
      action: 'applied',
      reason: null,
      providerTransactionId: 'PH-FIRST',
      verifiedAt: new Date('2026-10-01T10:00:00Z'),
    });
    const distinct = await event(attempt, {
      reason: 'DISTINCT_SUCCESSFUL_PROVIDER_TRANSACTION',
      providerTransactionId: 'PH-SECOND',
      verifiedAt: new Date('2026-10-02T10:00:00Z'),
    });
    await event(unrelated, { providerTransactionId: 'PH-UNRELATED' });
    const response = await get(`/api/payments/${attempt._id}/events`, { limit: '1' });
    expect(response.status).toBe(200);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(response.body.data.items[0].eventId).toBe(distinct._id.toString());
    const filtered = await get(`/api/payments/${attempt._id}/events`, {
      action: 'reconciliation_required',
      statusCode: '2',
      providerTransactionId: 'PH-SECOND',
    });
    expect(filtered.body.data.items).toHaveLength(1);
    const ascending = await get(`/api/payments/${attempt._id}/events`, { sortOrder: 'asc' });
    expect(ascending.body.data.items.map((item) => item.providerTransactionId)).toEqual([
      'PH-FIRST',
      'PH-SECOND',
    ]);
    expect((await Payment.findById(attempt._id)).status).toBe('failed');
  });
  it('distinguishes invalid IDs, missing Payments and empty event history', async () => {
    const attempt = await payment();
    expect((await get('/api/payments/not-an-id')).status).toBe(422);
    expect((await get('/api/payments/not-an-id/events')).status).toBe(422);
    expect((await get(`/api/payments/${attempt._id}`, { status: 'failed' })).status).toBe(422);
    expect(
      (await get(`/api/payments/${attempt._id}/events`, { action: 'unverified' })).status
    ).toBe(422);
    const missing = new mongoose.Types.ObjectId();
    expect((await get(`/api/payments/${missing}`)).status).toBe(404);
    expect((await get(`/api/payments/${missing}/events`)).status).toBe(404);
    const empty = await get(`/api/payments/${attempt._id}/events`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      items: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });
  });
  it('monitoring leaves Payment, Order and verified events byte-for-byte unchanged', async () => {
    const order = await Order.create({
      customerId: new mongoose.Types.ObjectId(),
      orderDate: new Date(),
      orderAmount: 100,
      status: 'ORDER_CREATED',
    });
    const attempt = await payment({
      orderId: order._id,
      reconciliationRequired: true,
      reconciliationReason: 'LATE_SUCCESS_TERMINAL_ATTEMPT',
    });
    const evidence = await event(attempt);
    const before = await Promise.all([
      Payment.findById(attempt._id).lean(),
      Order.findById(order._id).lean(),
      PaymentEvent.findById(evidence._id).lean(),
    ]);
    await get('/api/payments', { reconciliationRequired: 'true' });
    await get(`/api/payments/${attempt._id}`);
    await get(`/api/payments/${attempt._id}/events`);
    const after = await Promise.all([
      Payment.findById(attempt._id).lean(),
      Order.findById(order._id).lean(),
      PaymentEvent.findById(evidence._id).lean(),
    ]);
    expect(after).toEqual(before);
    expect(await Payment.countDocuments()).toBe(1);
    expect(await PaymentEvent.countDocuments()).toBe(1);
  });
  it('keeps customer payment retrieval ownership-scoped and excludes provider references', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const order = await Order.create({
      customerId: ownerId,
      orderDate: new Date(),
      orderAmount: 100,
    });
    await payment({ orderId: order._id, providerTransactionId: 'PH-MANAGEMENT-ONLY' });
    const owner = await get(
      `/api/orders/${order._id}/payment-status`,
      {},
      token('CUSTOMER', ownerId.toString())
    );
    expect(owner.status).toBe(200);
    expect(JSON.stringify(owner.body)).not.toContain('PH-MANAGEMENT-ONLY');
    expect(
      (await get(`/api/orders/${order._id}/payment-status`, {}, token('CUSTOMER'))).status
    ).toBe(404);
    expect((await get(`/api/orders/${order._id}/payment-status`)).status).toBe(403);
  });
});
