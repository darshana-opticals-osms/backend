const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Customer = require('../../src/models/customer.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const OrderNotification = require('../../src/models/orderNotification.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
} = require('../../src/constants/payment');
const {
  DELIVERY_STATUS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PROVIDERS,
} = require('../../src/constants/orderNotification');
const { domainEvents } = require('../../src/utils/domainEvents');
const {
  processOrderNotification,
  initOrderNotificationListener,
} = require('../../src/services/orderNotification.service');

jest.setTimeout(30000);

const JWT_SECRET = 'notification-integration-secret';
const PASSWORD_HASH = `$2b$12$${'b'.repeat(53)}`;

function createToken({ userId, role } = {}) {
  return jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function waitForNotification(orderId, targetStatus, timeoutMs = 5000) {
  const start = Date.now();
  const idempotencyKey = `ORDER_NOTIF_${orderId.toString()}_${targetStatus}`;
  while (Date.now() - start < timeoutMs) {
    const notif = await OrderNotification.findOne({ idempotencyKey }).lean();
    if (notif && notif.deliveryStatus !== DELIVERY_STATUS.PENDING) return notif;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return OrderNotification.findOne({ idempotencyKey }).lean();
}

describe('Order Status Notification Integration Tests (ADR-013, Issue #60 AC1-AC54)', () => {
  let app;
  let originalEnv;
  let mongoServer;
  let staffToken;

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
    await PaymentEvent.init();
    await LoyaltyTransaction.init();
    await OrderNotification.init();

    staffToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_ASSISTANT,
    });

    initOrderNotificationListener();
    app = createApp();
  }, 60000);

  afterAll(async () => {
    domainEvents.removeAllListeners();
    process.env = originalEnv;
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Payment.deleteMany({}),
      PaymentEvent.deleteMany({}),
      LoyaltyTransaction.collection.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Customer.deleteMany({}),
      OrderNotification.deleteMany({}),
    ]);
  });

  describe('Approved Lifecycle Milestone Transitions', () => {
    it('Milestone 2: READY_FOR_PICKUP -> PICKED_UP triggers customer notification and persistence (AC3, AC5, AC7, AC23)', async () => {
      const customer = await Customer.create({
        name: 'Kasun Wickrama',
        email: 'kasun.w@example.com',
        phone: '+94771112233',
        address: '10 Flower Road, Colombo 07',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 18000,
        status: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: ORDER_STATUS_VALUES.PICKED_UP })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.PICKED_UP);

      // Verify notification delivery record asynchronously committed
      const notif = await waitForNotification(order._id, ORDER_STATUS_VALUES.PICKED_UP);
      expect(notif).not.toBeNull();
      expect(notif.orderId.toString()).toBe(order._id.toString());
      expect(notif.customerId.toString()).toBe(customer._id.toString());
      expect(notif.recipientEmail).toBe('kasun.w@example.com');
      expect(notif.triggerStatus).toBe(ORDER_STATUS_VALUES.PICKED_UP);
      expect(notif.channel).toBe(NOTIFICATION_CHANNELS.EMAIL);
      expect(notif.provider).toBe(NOTIFICATION_PROVIDERS.AWS_SES);
      expect(notif.deliveryStatus).toBe(DELIVERY_STATUS.SENT);
      expect(notif.errorCode).toBeNull();
    });

    it('Milestone 3: PICKED_UP -> COMPLETED triggers formal completion notification (AC5)', async () => {
      const customer = await Customer.create({
        name: 'Sunil Shantha',
        email: 'sunil.s@example.com',
        phone: '+94772223344',
        address: '22 Galle Road, Mount Lavinia',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 12000,
        status: ORDER_STATUS_VALUES.PICKED_UP,
      });

      const providerOrderId = `PAY-${Date.now()}`;
      const providerTransactionId = `TXN-${Date.now()}`;

      const eligibility = require('../../src/services/loyaltyEligibility.service');
      jest.spyOn(eligibility, 'assertEarningContract').mockResolvedValue(undefined);
      jest.spyOn(eligibility, 'deriveEligibleSpendForOrder').mockResolvedValue('12000.00');

      const payment = await Payment.create({
        orderId: order._id,
        customerId: customer._id,
        amount: 12000,
        currency: PAYMENT_CURRENCY.LKR,
        provider: PAYMENT_PROVIDER.PAYHERE,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        status: PAYMENT_STATUS.COMPLETED,
        providerOrderId,
        providerTransactionId,
      });

      await PaymentEvent.create({
        paymentId: payment._id,
        orderId: order._id,
        provider: PAYMENT_PROVIDER.PAYHERE,
        providerOrderId,
        providerTransactionId,
        currency: PAYMENT_CURRENCY.LKR,
        amount: '12000.00',
        statusCode: '2',
        action: 'applied',
        eventKey: `EVENT-${Date.now()}`,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: ORDER_STATUS_VALUES.COMPLETED })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.COMPLETED);

      const notif = await waitForNotification(order._id, ORDER_STATUS_VALUES.COMPLETED);
      expect(notif).not.toBeNull();
      expect(notif.recipientEmail).toBe('sunil.s@example.com');
      expect(notif.triggerStatus).toBe(ORDER_STATUS_VALUES.COMPLETED);
      expect(notif.deliveryStatus).toBe(DELIVERY_STATUS.SENT);
    });

    it('Milestone 5: PROCESSING -> CANCELLED triggers cancellation notice (AC5)', async () => {
      const customer = await Customer.create({
        name: 'Ruwan Silva',
        email: 'ruwan.s@example.com',
        phone: '+94773334455',
        address: '5 Main Street, Negombo',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 7500,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: ORDER_STATUS_VALUES.CANCELLED })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.CANCELLED);

      const notif = await waitForNotification(order._id, ORDER_STATUS_VALUES.CANCELLED);
      expect(notif).not.toBeNull();
      expect(notif.recipientEmail).toBe('ruwan.s@example.com');
      expect(notif.triggerStatus).toBe(ORDER_STATUS_VALUES.CANCELLED);
      expect(notif.deliveryStatus).toBe(DELIVERY_STATUS.SENT);
    });
  });

  describe('Non-Notifiable Transitions & Negative Boundaries', () => {
    it('suppresses notifications for internal packaging: PROCESSING -> READY_FOR_PICKUP (AC3)', async () => {
      const customer = await Customer.create({
        name: 'Priyani Fernando',
        email: 'priyani@example.com',
        phone: '+94774445566',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 9000,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });

      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: ORDER_STATUS_VALUES.READY_FOR_PICKUP })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ORDER_STATUS_VALUES.READY_FOR_PICKUP);

      // Verify NO notification record was persisted for READY_FOR_PICKUP
      await new Promise((resolve) => setTimeout(resolve, 300));
      const notif = await OrderNotification.findOne({
        orderId: order._id,
        triggerStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });
      expect(notif).toBeNull();
    });

    it('does not send notification when transition is invalid or rejected (AC6)', async () => {
      const customer = await Customer.create({
        name: 'Kamal Perera',
        email: 'kamal.p@example.com',
        phone: '+94775556677',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 5000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
      });

      // Illegal transition: ORDER_CREATED -> COMPLETED rejected with 422
      const res = await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: ORDER_STATUS_VALUES.COMPLETED })
        .expect(422);

      expect(res.body.success).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 300));
      const notifs = await OrderNotification.find({ orderId: order._id });
      expect(notifs).toHaveLength(0);
    });
  });

  describe('Customer Ownership Resolution (AC8, AC9)', () => {
    it('always derives destination from Order ownership and never arbitrary input', async () => {
      const customerA = await Customer.create({
        name: 'Customer A',
        email: 'customer.a@example.com',
        phone: '+94778889901',
        passwordHash: PASSWORD_HASH,
      });

      const customerB = await Customer.create({
        name: 'Customer B',
        email: 'customer.b@example.com',
        phone: '+94778889902',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customerA._id,
        orderDate: new Date(),
        orderAmount: 11000,
        status: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });

      // Request attempts to inject an unauthorized recipient email
      await request(app)
        .patch(`/api/orders/${order._id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          status: ORDER_STATUS_VALUES.PICKED_UP,
          recipientEmail: customerB.email,
          customDestination: 'attacker@evil.com',
        })
        .expect(200);

      const notif = await waitForNotification(order._id, ORDER_STATUS_VALUES.PICKED_UP);
      expect(notif).not.toBeNull();
      // Must be Customer A
      expect(notif.recipientEmail).toBe('customer.a@example.com');
      expect(notif.recipientEmail).not.toBe('customer.b@example.com');
      expect(notif.recipientEmail).not.toBe('attacker@evil.com');
    });
  });

  describe('Duplicate Replay Protection & Idempotency (AC19, AC21, AC22)', () => {
    it('suppresses duplicate dispatch when the same event is replayed', async () => {
      const customer = await Customer.create({
        name: 'Chathura Bandara',
        email: 'chathura@example.com',
        phone: '+94779990011',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 6000,
        status: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });

      // First run: dispatches notification
      const firstResult = await processOrderNotification({
        orderId: order._id,
        previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });
      expect(firstResult.handled).toBe(true);
      expect(firstResult.delivered).toBe(true);

      // Second run (replay): duplicate is suppressed
      const secondResult = await processOrderNotification({
        orderId: order._id,
        previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });
      expect(secondResult.handled).toBe(true);
      expect(secondResult.duplicate).toBe(true);

      // Verify only one notification document exists in database
      const notifs = await OrderNotification.find({
        orderId: order._id,
        triggerStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });
      expect(notifs).toHaveLength(1);
    });

    it('atomically suppresses duplicate dispatches under simultaneous concurrent execution (Review Point 2)', async () => {
      const customer = await Customer.create({
        name: 'Concurrent Customer',
        email: 'concurrent@example.com',
        phone: '+94779998877',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 15000,
        status: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });

      // Launch 5 concurrent calls simultaneously
      const results = await Promise.all([
        processOrderNotification({
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        }),
        processOrderNotification({
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        }),
        processOrderNotification({
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        }),
        processOrderNotification({
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        }),
        processOrderNotification({
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        }),
      ]);

      const deliveredCount = results.filter((r) => r.delivered === true && !r.duplicate).length;
      const duplicateCount = results.filter((r) => r.duplicate === true).length;

      expect(deliveredCount).toBe(1);
      expect(duplicateCount).toBe(4);

      // Verify only 1 record exists in MongoDB
      const notifs = await OrderNotification.find({
        orderId: order._id,
        triggerStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });
      expect(notifs).toHaveLength(1);
    });
  });

  describe('Environment-Specific Delivery Rules (ADR-013 Section 16, Review Point 3)', () => {
    it('redirects recipient strictly to staging inbox when NODE_ENV is staging', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.STAGING_NOTIFICATION_RECIPIENT = 'qa-staging@darshanaopticals.lk';

      const customer = await Customer.create({
        name: 'Staging Customer',
        email: 'real-customer@example.com',
        phone: '+94770001122',
        passwordHash: PASSWORD_HASH,
      });

      const order = await Order.create({
        customerId: customer._id,
        orderDate: new Date(),
        orderAmount: 8500,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
      });

      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'staging-ph-123' }),
      };

      const result = await processOrderNotification(
        {
          orderId: order._id,
          previousStatus: ORDER_STATUS_VALUES.ORDER_CREATED,
          targetStatus: ORDER_STATUS_VALUES.PROCESSING,
        },
        { transporter: mockTransporter }
      );

      expect(result.handled).toBe(true);
      expect(result.delivered).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'qa-staging@darshanaopticals.lk',
        })
      );

      const notif = await OrderNotification.findOne({
        orderId: order._id,
        triggerStatus: ORDER_STATUS_VALUES.PROCESSING,
      });
      expect(notif.recipientEmail).toBe('qa-staging@darshanaopticals.lk');

      process.env.NODE_ENV = 'test';
    });
  });
});
