const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Customer = require('../../src/models/customer.model');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const AuditEvent = require('../../src/models/auditEvent.model');
const ManualRefundEvidence = require('../../src/models/manualRefundEvidence.model');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
  AUDIT_SOURCE,
} = require('../../src/constants/audit');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');
const { recordConfirmedManualFullRefund } = require('../../src/services/manualRefund.service');
const loyaltyRefund = require('../../src/services/loyaltyRefundBoundary.service');

const JWT_SECRET = 'payment-audit-integration-test-secret';
const MERCHANT_ID = '1211149';
const MERCHANT_SECRET = 'sandbox-payment-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const tokenFor = (customer) =>
  jwt.sign({ userId: customer._id.toString(), role: ROLE_VALUES.CUSTOMER }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

describe('Payment Operations - Audit Trail Integration (ADR-012 / DDP-065)', () => {
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
      Customer.init(),
      Order.init(),
      Payment.init(),
      PaymentEvent.init(),
      AuditEvent.init(),
      ManualRefundEvidence.init(),
      LoyaltyTransaction.init(),
    ]);

    app = createApp();
  }, 60000);

  beforeEach(async () => {
    await Promise.all([
      AuditEvent.collection.deleteMany({}),
      PaymentEvent.collection.deleteMany({}),
      Payment.collection.deleteMany({}),
      Order.collection.deleteMany({}),
      Customer.collection.deleteMany({}),
      ManualRefundEvidence.collection.deleteMany({}),
      LoyaltyTransaction.collection.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      AuditEvent.collection.deleteMany({}),
      PaymentEvent.collection.deleteMany({}),
      Payment.collection.deleteMany({}),
      Order.collection.deleteMany({}),
      Customer.collection.deleteMany({}),
      ManualRefundEvidence.collection.deleteMany({}),
      LoyaltyTransaction.collection.deleteMany({}),
    ]);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      try {
        await mongoServer.stop();
      } catch {
        // Ignored MongoServerSelectionError during server shutdown
      }
    }
    process.env = originalEnv;
  }, 30000);

  const createCustomer = (email = 'payment-audit-user@example.com') =>
    Customer.create({
      name: 'Audit Customer',
      email,
      address: '45 Galle Road, Colombo',
      phone: '+94711234567',
      passwordHash: PASSWORD_HASH,
    });

  const createOrder = (customer, overrides = {}) => {
    const now = new Date();
    return Order.create({
      customerId: customer._id,
      orderDate: now,
      orderAmount: 3500,
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      statusUpdatedAt: now,
      reservationExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      statusHistory: [
        { status: ORDER_STATUS_VALUES.ORDER_CREATED, changedAt: now, changedBy: customer._id },
      ],
      ...overrides,
    });
  };

  const notificationPayload = (payment, overrides = {}) => {
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

  describe('1. Payment Initiation (PAYMENT_INITIATED)', () => {
    it('persists an AuditEvent when customer initiates a payment with safe metadata (AC23, AC36-AC41)', async () => {
      const customer = await createCustomer('init-audit@example.com');
      const order = await createOrder(customer);

      const response = await request(app)
        .post('/api/payments/initiate')
        .set('Authorization', `Bearer ${tokenFor(customer)}`)
        .send({ orderId: order._id.toString(), city: 'Colombo' });

      expect(response.status).toBe(201);
      const paymentId = response.body.data.payment.paymentId;

      // Verify AuditEvent persisted in MongoDB
      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PAYMENT_INITIATED,
        targetId: paymentId,
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.action).toBe(AUDIT_ACTION.PAYMENT_INITIATED);
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(auditEvent.actorId).toBe(customer._id.toString());
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.CUSTOMER);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.PAYMENT);
      expect(auditEvent.targetId).toBe(paymentId);
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);

      // Verify metadata does not leak sensitive information
      expect(auditEvent.metadata).toBeDefined();
      expect(auditEvent.metadata.orderId).toBe(order._id.toString());
      expect(auditEvent.metadata.amount).toBe(3500);
      expect(auditEvent.metadata.currency).toBe('LKR');
      expect(auditEvent.metadata.merchantSecret).toBeUndefined();
      expect(auditEvent.metadata.password).toBeUndefined();
      expect(auditEvent.metadata.token).toBeUndefined();

      // Immutability: attempts to update or delete this event must fail
      await expect(
        AuditEvent.updateOne({ _id: auditEvent._id }, { $set: { outcome: 'FAILURE' } })
      ).rejects.toThrow(/AuditEvent records are immutable and append-only/);

      await expect(AuditEvent.deleteOne({ _id: auditEvent._id })).rejects.toThrow(
        /AuditEvent records are immutable and append-only/
      );
    });
  });

  describe('2. Provider Callback and Payment Completion (PAYMENT_PROVIDER_CALLBACK_VERIFIED & PAYMENT_COMPLETED)', () => {
    it('persists callback and completion audit events with external provider actor upon verified callback (AC24-AC25)', async () => {
      const customer = await createCustomer('callback-audit@example.com');
      const order = await createOrder(customer);

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Authorization', `Bearer ${tokenFor(customer)}`)
        .send({ orderId: order._id.toString(), city: 'Colombo' });

      expect(initRes.status).toBe(201);
      const payment = await Payment.findById(initRes.body.data.payment.paymentId);

      const payload = notificationPayload(payment, {
        status_code: '2',
        payment_id: 'PH-TXN-12345',
      });

      const notifyRes = await request(app).post('/api/payments/notify').type('form').send(payload);

      expect(notifyRes.status).toBe(200);

      // Verify callback verification AuditEvent
      const callbackEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PAYMENT_PROVIDER_CALLBACK_VERIFIED,
        targetId: payment._id.toString(),
      });

      expect(callbackEvent).not.toBeNull();
      expect(callbackEvent.actorType).toBe(AUDIT_ACTOR_TYPE.EXTERNAL_PROVIDER);
      expect(callbackEvent.actorId).toBe(AUDIT_SOURCE.PAYHERE_GATEWAY);
      expect(callbackEvent.source).toBe(AUDIT_SOURCE.PAYHERE_GATEWAY);
      expect(callbackEvent.targetType).toBe(AUDIT_TARGET_TYPE.PAYMENT);
      expect(callbackEvent.targetId).toBe(payment._id.toString());
      expect(callbackEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(callbackEvent.metadata.statusCode).toBe('2');
      expect(callbackEvent.metadata.md5sig).toBeUndefined(); // Signature stripped

      // Verify payment completion AuditEvent
      const completedEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PAYMENT_COMPLETED,
        targetId: payment._id.toString(),
      });

      expect(completedEvent).not.toBeNull();
      expect(completedEvent.targetType).toBe(AUDIT_TARGET_TYPE.PAYMENT);
      expect(completedEvent.targetId).toBe(payment._id.toString());
      expect(completedEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(completedEvent.metadata.orderId).toBe(order._id.toString());
    });
  });

  describe('3. Manual Refund Recording (PAYMENT_REFUNDED)', () => {
    it('persists an AuditEvent when branch manager records a confirmed manual refund (AC28)', async () => {
      const customer = await createCustomer('refund-audit@example.com');
      const order = await createOrder(customer, { orderAmount: 2500 });
      const managerId = new mongoose.Types.ObjectId().toString();

      // Create a completed payment
      const payment = await Payment.create({
        orderId: order._id,
        amount: 2500,
        currency: 'LKR',
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        provider: 'payhere',
        providerOrderId: `PAY-${order._id}`,
        providerTransactionId: 'PH-TXN-COMPLETED-99',
      });

      // Create applied capture PaymentEvent required by refund invariant
      await PaymentEvent.create({
        paymentId: payment._id,
        orderId: order._id,
        provider: payment.provider,
        providerOrderId: payment.providerOrderId,
        providerTransactionId: payment.providerTransactionId,
        statusCode: '2',
        action: 'applied',
        amount: '2500.00',
        currency: 'LKR',
        eventKey: 'event-key-applied-01',
      });

      const loyaltySpy = jest
        .spyOn(loyaltyRefund, 'verifyNeverEarnedFullRefund')
        .mockResolvedValue(true);

      const refundResult = await recordConfirmedManualFullRefund({
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, userId: managerId },
        paymentId: payment._id.toString(),
        evidence: {
          amount: 2500,
          currency: 'LKR',
          refundChannel: 'payhere_portal',
          refundReference: 'REFUND-PORTAL-999',
        },
        idempotencyKey: 'idemp-refund-test-1',
      });

      loyaltySpy.mockRestore();

      expect(refundResult.status).toBe(PAYMENT_STATUS.REFUNDED);

      // Verify refund AuditEvent persisted
      const refundEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PAYMENT_REFUNDED,
        targetId: payment._id.toString(),
      });

      expect(refundEvent).not.toBeNull();
      expect(refundEvent.action).toBe(AUDIT_ACTION.PAYMENT_REFUNDED);
      expect(refundEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(refundEvent.actorId).toBe(managerId);
      expect(refundEvent.actorRole).toBe(ROLE_VALUES.BRANCH_MANAGER);
      expect(refundEvent.targetType).toBe(AUDIT_TARGET_TYPE.PAYMENT);
      expect(refundEvent.targetId).toBe(payment._id.toString());
      expect(refundEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);

      expect(refundEvent.metadata).toMatchObject({
        orderId: order._id.toString(),
        amount: 2500,
        currency: 'LKR',
      });
      expect(refundEvent.metadata.refundEvidenceId).toBeDefined();
    });
  });
});
