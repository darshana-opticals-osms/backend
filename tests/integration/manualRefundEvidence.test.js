const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const Order = require('../../src/models/order.model');
const Inventory = require('../../src/models/inventory.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const ManualRefundEvidence = require('../../src/models/manualRefundEvidence.model');
const {
  appendConfirmedManualRefundEvidence,
} = require('../../src/services/manualRefundEvidence.service');

describe('Manual full-refund evidence persistence (no operational endpoint)', () => {
  let server;
  let originalEnv;
  let app;
  const auth = { role: 'BRANCH_MANAGER', userId: new mongoose.Types.ObjectId().toString() };
  const evidence = {
    amount: 100,
    currency: 'LKR',
    refundChannel: 'payhere_portal',
    refundReference: 'REFUND-EXTERNAL-123',
  };
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: 'refund-infrastructure-test-secret',
      JWT_EXPIRES_IN: '1h',
    });
    server = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = server.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: new URL(uri).host }],
      },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([Payment.init(), PaymentEvent.init(), ManualRefundEvidence.init()]);
    app = createApp();
  }, 60000);
  beforeEach(async () => {
    // Native cleanup is confined to this disposable test DB. Application model deletes are prohibited.
    await ManualRefundEvidence.collection.deleteMany({});
    await Promise.all([
      Payment.deleteMany({}),
      PaymentEvent.deleteMany({}),
      Order.deleteMany({}),
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
    ]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);
  async function fixture(overrides = {}) {
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Test',
      quantity: 5,
      price: 100,
    });
    const customer = await Customer.create({
      name: 'Refund Customer',
      email: 'refund@example.com',
      address: 'Test',
      phone: '+94711234567',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
    const order = await Order.create({
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: 100,
      status: 'PROCESSING',
      reservationExpiresAt: new Date(Date.now() + 1800000),
    });
    const payment = await Payment.create({
      orderId: order._id,
      amount: 100,
      currency: 'LKR',
      method: 'online_gateway',
      status: 'completed',
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      providerTransactionId: 'PH-ORIGINAL-CAPTURE',
      reconciliationRequired: false,
      reconciliationReason: null,
      ...overrides,
    });
    const event = await PaymentEvent.create({
      paymentId: payment._id,
      orderId: order._id,
      providerOrderId: payment.providerOrderId,
      providerTransactionId: payment.providerTransactionId,
      eventKey: 'original-success-event',
      statusCode: '2',
      amount: '100.00',
      currency: 'LKR',
      action: 'applied',
    });
    return { order, payment, event, inventory, customer };
  }
  const append = (payment, key = 'request-1', changes = {}) =>
    appendConfirmedManualRefundEvidence({
      auth,
      paymentId: payment._id.toString(),
      evidence,
      idempotencyKey: key,
      ...changes,
    });

  it('appends evidence with original capture identity while all financial/domain records remain unchanged', async () => {
    const { order, payment, event, inventory, customer } = await fixture();
    const snapshot = () =>
      Promise.all([
        Payment.findById(payment._id).lean(),
        Order.findById(order._id).lean(),
        PaymentEvent.findById(event._id).lean(),
        Inventory.findById(inventory._id).lean(),
        Customer.findById(customer._id).lean(),
      ]);
    const before = await snapshot();
    const result = await append(payment);
    expect(result).toMatchObject({
      paymentId: payment._id.toString(),
      orderId: order._id.toString(),
      providerOrderId: payment.providerOrderId,
      providerTransactionId: 'PH-ORIGINAL-CAPTURE',
      amount: 100,
      currency: 'LKR',
      recordedBy: auth.userId,
    });
    expect(result).not.toHaveProperty('requestHash');
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(await snapshot()).toEqual(before);
    expect(await PaymentEvent.countDocuments()).toBe(1);
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
  });
  it('makes concurrent identical appends idempotent without changing Payment status', async () => {
    const { payment } = await fixture();
    const results = await Promise.all([append(payment), append(payment), append(payment)]);
    expect(new Set(results.map((result) => result.evidenceId)).size).toBe(1);
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    expect((await Payment.findById(payment._id)).status).toBe('completed');
    expect(await append(payment)).toEqual(results[0]);
  });
  it('holds a reconciliation-flagged capture without inserting evidence or changing domain records', async () => {
    const { payment, order, inventory, event } = await fixture({
      reconciliationRequired: true,
      reconciliationReason: 'PAYHERE_CHARGEBACK_REVIEW',
    });
    const before = await Payment.findById(payment._id).lean();
    await expect(append(payment)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
    expect(await ManualRefundEvidence.countDocuments()).toBe(0);
    expect(await Payment.findById(payment._id).lean()).toEqual(before);
    expect(await Order.findById(order._id).lean()).toEqual(order.toObject());
    expect(await Inventory.findById(inventory._id).lean()).toEqual(inventory.toObject());
    expect(await PaymentEvent.findById(event._id).lean()).toEqual(event.toObject());
  });
  it.each(['pending', 'processing', 'failed', 'cancelled', 'refunded'])(
    'holds evidence when another %s attempt on the Order needs reconciliation',
    async (status) => {
      const { payment } = await fixture();
      const other = await Payment.create({
        orderId: payment.orderId,
        amount: 100,
        method: 'online_gateway',
        status,
        reconciliationRequired: true,
        reconciliationReason: 'LATE_SUCCESS_AFTER_TERMINAL_ATTEMPT',
      });
      const before = await Payment.find({ orderId: payment.orderId }).sort({ _id: 1 }).lean();
      await expect(append(payment)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
      expect(await Payment.find({ orderId: payment.orderId }).sort({ _id: 1 }).lean()).toEqual(
        before
      );
      expect((await Payment.findById(other._id)).reconciliationRequired).toBe(true);
    }
  );
  it('does not let an identical replay bypass a subsequently raised reconciliation hold', async () => {
    const { payment } = await fixture();
    const original = await append(payment);
    await Payment.updateOne({ _id: payment._id }, { $set: { reconciliationRequired: true } });
    await expect(append(payment)).rejects.toMatchObject({
      errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
    });
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    expect((await ManualRefundEvidence.findById(original.evidenceId)).amount).toBe(100);
  });
  it('keeps inserts and identical replay in the caller transaction and rolls them back together', async () => {
    const { payment } = await fixture();
    const session = await mongoose.startSession();
    const rollback = new Error('rollback caller workflow');
    try {
      await expect(
        session.withTransaction(async () => {
          const result = await append(payment, 'transaction-key', { session });
          expect(session.inTransaction()).toBe(true);
          expect(await ManualRefundEvidence.countDocuments().session(session)).toBe(1);
          expect(await ManualRefundEvidence.countDocuments()).toBe(0);
          expect(await append(payment, 'transaction-key', { session })).toEqual(result);
          throw rollback;
        })
      ).rejects.toBe(rollback);
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
      expect((await Payment.findById(payment._id)).status).toBe('completed');
      // An aborted insertion must not consume either unique identity.
      await expect(append(payment, 'transaction-key')).resolves.toHaveProperty('evidenceId');
    } finally {
      await session.endSession();
    }
  });
  it('reads the source Payment from the supplied transaction and leaves commit to its caller', async () => {
    await fixture();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const [source] = await Payment.create(
        [
          {
            orderId: new mongoose.Types.ObjectId(),
            amount: 100,
            method: 'online_gateway',
            status: 'completed',
            providerTransactionId: 'PH-TRANSACTION-SOURCE',
          },
        ],
        { session }
      );
      const result = await append(source, 'transaction-source', { session });
      expect(session.inTransaction()).toBe(true);
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
      await session.commitTransaction();
      expect((await ManualRefundEvidence.findById(result.evidenceId)).paymentId).toEqual(
        source._id
      );
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });
  it('reads other-attempt reconciliation flags from the caller transaction', async () => {
    const { payment } = await fixture();
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await Payment.create(
        [
          {
            orderId: payment.orderId,
            amount: 100,
            method: 'online_gateway',
            status: 'failed',
            reconciliationRequired: true,
          },
        ],
        { session }
      );
      await expect(append(payment, 'held-in-session', { session })).rejects.toMatchObject({
        errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect(await ManualRefundEvidence.countDocuments().session(session)).toBe(0);
      await session.abortTransaction();
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });
  it('propagates transactional duplicate keys without querying an aborted transaction, then safely replays after abort', async () => {
    const { payment } = await fixture();
    const original = await append(payment, 'winner-key');
    const session = await mongoose.startSession();
    const read = jest.spyOn(ManualRefundEvidence, 'findOne');
    try {
      session.startTransaction();
      await expect(append(payment, 'loser-key', { session })).rejects.toMatchObject({
        code: 11000,
      });
      // One initial idempotency read only, never a recovery read after insert failure.
      expect(read).toHaveBeenCalledTimes(1);
      await session.abortTransaction();
      expect(await append(payment, 'winner-key', { session })).toEqual(original);
      await expect(append(payment, 'loser-key', { session })).rejects.toMatchObject({
        errorCode: 'REFUND_EVIDENCE_CONFLICT',
      });
      expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    } finally {
      read.mockRestore();
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });
  it('rejects key reuse with changed evidence or recording actor', async () => {
    const { payment } = await fixture();
    await append(payment);
    await expect(
      append(payment, 'request-1', { evidence: { ...evidence, refundReference: 'CHANGED' } })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      append(payment, 'request-1', {
        auth: { ...auth, userId: new mongoose.Types.ObjectId().toString() },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
  });
  it('uniquely protects the full Payment even with concurrent different request keys', async () => {
    const { payment } = await fixture();
    const results = await Promise.allSettled([append(payment, 'key-a'), append(payment, 'key-b')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.statusCode).toBe(409);
    const original = await ManualRefundEvidence.findOne()
      .select('+requestHash +idempotencyKey')
      .lean();
    await expect(
      ManualRefundEvidence.create({
        ...original,
        _id: new mongoose.Types.ObjectId(),
        idempotencyKey: 'third-key',
      })
    ).rejects.toMatchObject({ code: 11000 });
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
  });
  it('rejects cross-Payment idempotency reuse at both helper and database boundaries', async () => {
    const { payment } = await fixture();
    await append(payment);
    const other = await Payment.create({
      orderId: new mongoose.Types.ObjectId(),
      amount: 100,
      method: 'online_gateway',
      status: 'completed',
      providerTransactionId: 'PH-OTHER',
    });
    await expect(append(other)).rejects.toMatchObject({ statusCode: 409 });
    const original = await ManualRefundEvidence.findOne()
      .select('+requestHash +idempotencyKey')
      .lean();
    await expect(
      ManualRefundEvidence.create({
        ...original,
        _id: new mongoose.Types.ObjectId(),
        paymentId: other._id,
      })
    ).rejects.toMatchObject({ code: 11000 });
  });
  it.each(['pending', 'processing', 'failed', 'cancelled'])(
    'does not invent a refund resolution path for %s attempts',
    async (status) => {
      const { payment } = await fixture({ status });
      await expect(append(payment)).rejects.toMatchObject({
        errorCode: 'REFUND_EVIDENCE_SOURCE_UNSUPPORTED',
      });
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
    }
  );
  it('retains known already-refunded and legacy capture records without guessing missing references', async () => {
    const { payment } = await fixture({ status: 'refunded', providerTransactionId: null });
    const result = await append(payment, 'legacy-key', {
      evidence: { amount: 100, currency: 'LKR' },
    });
    expect(result.providerTransactionId).toBeNull();
    expect(result.refundReference).toBeNull();
    expect((await Payment.findById(payment._id)).status).toBe('refunded');
  });
  it('rejects partial/wrong evidence and client-controlled source data without persisting it', async () => {
    const { payment } = await fixture();
    for (const invalid of [
      { ...evidence, amount: 99 },
      { ...evidence, currency: 'USD' },
      { ...evidence, providerTransactionId: 'OTHER' },
      { ...evidence, rawPayload: { card_no: 'secret' } },
    ]) {
      await expect(append(payment, 'invalid', { evidence: invalid })).rejects.toMatchObject({
        statusCode: 422,
      });
    }
    expect(await ManualRefundEvidence.countDocuments()).toBe(0);
  });
  it('rejects invalid audit context and missing Payment without creating evidence', async () => {
    const { payment } = await fixture();
    await expect(
      append(payment, 'invalid-context', { auth: { ...auth, userId: 'bad-id' } })
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(append(payment, 'invalid-context', { paymentId: 'bad-id' })).rejects.toMatchObject(
      { statusCode: 422 }
    );
    await expect(append(payment, '')).rejects.toMatchObject({ statusCode: 422 });
    await expect(append({ _id: new mongoose.Types.ObjectId() })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await ManualRefundEvidence.countDocuments()).toBe(0);
  });
  it.each([
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ])('blocks %s against persisted audit evidence', async (operation) => {
    const { payment } = await fixture();
    const result = await append(payment);
    const before = await ManualRefundEvidence.findById(result.evidenceId).lean();
    const replacement = operation.includes('Replace') || operation === 'replaceOne';
    const query = ManualRefundEvidence[operation](
      { _id: result.evidenceId },
      replacement ? { amount: 1 } : { $set: { amount: 1 } }
    );
    await expect(query).rejects.toMatchObject({ errorCode: 'REFUND_EVIDENCE_APPEND_ONLY' });
    expect(await ManualRefundEvidence.findById(result.evidenceId).lean()).toEqual(before);
  });
  it('blocks document saves/deletes and batch-write bypasses', async () => {
    const { payment } = await fixture();
    const result = await append(payment);
    const document = await ManualRefundEvidence.findById(result.evidenceId).select(
      '+requestHash +idempotencyKey'
    );
    await expect(document.save()).rejects.toMatchObject({
      errorCode: 'REFUND_EVIDENCE_APPEND_ONLY',
    });
    await expect(document.deleteOne()).rejects.toMatchObject({
      errorCode: 'REFUND_EVIDENCE_APPEND_ONLY',
    });
    await expect(document.updateOne({ $set: { amount: 1 } })).rejects.toMatchObject({
      errorCode: 'REFUND_EVIDENCE_APPEND_ONLY',
    });
    await expect(
      ManualRefundEvidence.bulkWrite([{ deleteOne: { filter: {} } }])
    ).rejects.toMatchObject({ errorCode: 'REFUND_EVIDENCE_APPEND_ONLY' });
    await expect(
      ManualRefundEvidence.insertMany(
        [{ ...document.toObject(), _id: new mongoose.Types.ObjectId() }],
        { lean: true }
      )
    ).rejects.toMatchObject({ errorCode: 'REFUND_EVIDENCE_APPEND_ONLY' });
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
  });
  it.each(['$out', '$merge'])('blocks aggregation write stage %s', async (stage) => {
    const { payment } = await fixture();
    const result = await append(payment);
    const before = await ManualRefundEvidence.findById(result.evidenceId).lean();
    await expect(
      ManualRefundEvidence.aggregate([
        { $match: {} },
        { $set: { amount: 1 } },
        { [stage]: ManualRefundEvidence.collection.name },
      ])
    ).rejects.toMatchObject({ errorCode: 'REFUND_EVIDENCE_APPEND_ONLY' });
    expect(await ManualRefundEvidence.findById(result.evidenceId).lean()).toEqual(before);
  });
  it('rejects unknown persistence fields and keeps internal identity fields out of default reads', async () => {
    const { payment } = await fixture();
    const result = await append(payment);
    const persisted = await ManualRefundEvidence.findById(result.evidenceId).lean();
    expect(persisted).not.toHaveProperty('idempotencyKey');
    expect(persisted).not.toHaveProperty('requestHash');
    expect(() => new ManualRefundEvidence({ ...persisted, md5sig: 'secret' })).toThrow();
  });
  it('does not activate refund or reconciliation mutation routes', async () => {
    const { payment } = await fixture();
    const token = jwt.sign(auth, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    for (const route of ['refunds', 'refund', 'reconciliation', 'resolve']) {
      const response = await request(app)
        .post(`/api/payments/${payment._id}/${route}`)
        .set('Authorization', `Bearer ${token}`)
        .send(evidence);
      expect(response.status).toBe(404);
    }
    expect(await ManualRefundEvidence.countDocuments()).toBe(0);
    expect((await Payment.findById(payment._id)).status).toBe('completed');
  });
});
