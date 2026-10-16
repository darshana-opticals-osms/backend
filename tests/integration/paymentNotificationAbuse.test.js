jest.mock('../../src/config/security', () => ({
  ...jest.requireActual('../../src/config/security'),
  PAYHERE_NOTIFICATION_RATE_LIMIT: { windowMs: 60000, max: 6 },
}));

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Customer = require('../../src/models/customer.model');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const Inventory = require('../../src/models/inventory.model');
const Branch = require('../../src/models/branch.model');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');

describe('PayHere callback volume protection', () => {
  let server;
  let originalEnv;
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PAYHERE_MODE: 'sandbox',
      PAYMENT_CURRENCY: 'LKR',
      PAYHERE_MERCHANT_ID: '1211149',
      PAYHERE_MERCHANT_SECRET: 'abuse-test-secret',
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
    await Promise.all([Payment.init(), PaymentEvent.init()]);
  }, 60000);
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);

  it('permits signed delivery and retries, bounds forged traffic and rejects before financial processing', async () => {
    const app = createApp();
    const customer = await Customer.create({
      name: 'Test Customer',
      email: 'notify@example.com',
      phone: '+94711234567',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 100,
      quantity: 4,
    });
    const payments = [];
    for (let index = 0; index < 2; index += 1) {
      const order = await Order.create({
        customerId: customer._id,
        orderAmount: 100,
        orderDate: new Date(),
        status: 'ORDER_CREATED',
        reservationExpiresAt: new Date(Date.now() + 1800000),
      });
      payments.push(
        await Payment.create({
          orderId: order._id,
          amount: 100,
          method: 'online_gateway',
          providerOrderId: `PAY-${index}`,
          expiresAt: order.reservationExpiresAt,
        })
      );
    }
    const fieldsFor = (payment) => {
      const fields = {
        merchant_id: '1211149',
        order_id: payment.providerOrderId,
        payment_id: `PH-${payment._id}`,
        payhere_amount: '100.00',
        payhere_currency: 'LKR',
        status_code: '2',
        captured_amount: '100.00',
        custom_1: '',
        method: 'VISA',
      };
      fields.md5sig = createNotificationSignature(fields, 'abuse-test-secret');
      return fields;
    };
    const send = (fields) => request(app).post('/api/payments/notify').type('form').send(fields);
    const fields = fieldsFor(payments[0]);
    for (let delivery = 0; delivery < 3; delivery += 1)
      expect((await send(fields)).status).toBe(200);
    expect(await PaymentEvent.countDocuments({ paymentId: payments[0]._id })).toBe(1);
    expect((await Order.findById(payments[0].orderId)).statusHistory).toHaveLength(1);
    const valid = fieldsFor(payments[1]);
    for (let invalid = 0; invalid < 3; invalid += 1)
      expect((await send({ ...valid, md5sig: '0'.repeat(32) })).status).toBe(403);
    const paymentBefore = await Payment.findById(payments[1]._id).lean();
    const orderBefore = await Order.findById(payments[1].orderId).lean();
    const inventoryBefore = await Inventory.findById(inventory._id).lean();
    const blocked = await send(valid);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(app).post('/api/payments/notify').send({})).status).toBe(429);
    expect(await Payment.findById(payments[1]._id).lean()).toEqual(paymentBefore);
    expect(await Order.findById(payments[1].orderId).lean()).toEqual(orderBefore);
    expect(await Inventory.findById(inventory._id).lean()).toEqual(inventoryBefore);
    expect(await PaymentEvent.countDocuments({ paymentId: payments[1]._id })).toBe(0);
  });
});
