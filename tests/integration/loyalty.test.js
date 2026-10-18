const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { updateOrderStatus } = require('../../src/services/order.service');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Customer = require('../../src/models/customer.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const ManualRefundEvidence = require('../../src/models/manualRefundEvidence.model');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const { LOYALTY_EVENT_TYPE: TYPE } = require('../../src/constants/loyalty');
const eligibility = require('../../src/services/loyaltyEligibility.service');
const {
  earnPurchasePoints,
  reverseFullRefundPoints,
  verifyFullRefundPoints,
} = require('../../src/services/loyalty.service');
const {
  appendConfirmedManualRefundEvidence,
} = require('../../src/services/manualRefundEvidence.service');
const { recordConfirmedManualFullRefund } = require('../../src/services/manualRefund.service');
const { updateOwnProfile } = require('../../src/services/profile.service');

describe('Loyalty earning and real atomic refund reversal', () => {
  let server;
  const originalSecret = process.env.JWT_SECRET;
  const auth = {
    role: 'BRANCH_MANAGER',
    userId: new mongoose.Types.ObjectId().toString(),
    branchId: new mongoose.Types.ObjectId().toString(),
  };
  beforeAll(async () => {
    server = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = server.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db
      .admin()
      .command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: new URL(uri).host }] } });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([
      Customer.init(),
      Order.init(),
      Payment.init(),
      PaymentEvent.init(),
      ManualRefundEvidence.init(),
      LoyaltyTransaction.init(),
    ]);
  }, 60000);
  beforeEach(async () => {
    // Native deletion is confined to this disposable DB; application audit deletes are forbidden.
    await LoyaltyTransaction.collection.deleteMany({});
    await ManualRefundEvidence.collection.deleteMany({});
    await Promise.all([
      Customer.deleteMany({}),
      Order.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Branch.deleteMany({}),
      Inventory.deleteMany({}),
      Payment.deleteMany({}),
      PaymentEvent.deleteMany({}),
    ]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }, 60000);

  async function fixture({ customer = null, status = 'COMPLETED', amount = 250 } = {}) {
    customer ||= await Customer.create({
      name: 'Loyalty Customer',
      email: `${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+94711234567',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Test',
      price: amount,
      quantity: 5,
    });
    const order = await Order.create({
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: amount,
      status,
    });
    const item = await OrderItem.create({
      orderId: order._id,
      inventoryId: inventory._id,
      itemName: inventory.itemName,
      price: amount,
      quantity: 1,
    });
    const payment = await Payment.create({
      orderId: order._id,
      amount,
      method: 'online_gateway',
      status: 'completed',
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      providerTransactionId: `PH-${new mongoose.Types.ObjectId()}`,
    });
    const capture = await PaymentEvent.create({
      paymentId: payment._id,
      orderId: order._id,
      providerOrderId: payment.providerOrderId,
      providerTransactionId: payment.providerTransactionId,
      eventKey: new mongoose.Types.ObjectId().toString(),
      statusCode: '2',
      amount: amount.toFixed(2),
      currency: 'LKR',
      action: 'applied',
    });
    return { customer, order, item, inventory, payment, capture };
  }
  const args = (source) => ({ paymentId: source.payment._id.toString() });
  const readBalance = async (source) =>
    (
      await Customer.findById(source.customer._id).select('+loyaltyBalance').lean()
    ).loyaltyBalance?.toString();
  // Core isolation tests double eligibility only; activation tests above use real snapshots.
  function resolvedContracts(spend = '250.00') {
    jest.spyOn(eligibility, 'assertEarningContract').mockResolvedValue(undefined);
    jest.spyOn(eligibility, 'deriveEligibleSpendForOrder').mockResolvedValue(spend);
  }
  async function refundEvidence(source) {
    return appendConfirmedManualRefundEvidence({
      auth,
      paymentId: source.payment._id.toString(),
      evidence: {
        amount: source.payment.amount,
        currency: 'LKR',
        refundChannel: 'payhere_portal',
        refundReference: 'EXTERNAL-REFUND',
      },
      idempotencyKey: source.payment._id.toString(),
    });
  }
  async function refunded(source) {
    const evidence = await refundEvidence(source);
    await Payment.updateOne({ _id: source.payment._id }, { $set: { status: 'refunded' } });
    return { ...args(source), refundEvidenceId: evidence.evidenceId };
  }
  const snapshot = async () => ({
    customers: await Customer.collection.find({}).sort({ _id: 1 }).toArray(),
    orders: await Order.find().sort({ _id: 1 }).lean(),
    inventory: await Inventory.find().sort({ _id: 1 }).lean(),
    payments: await Payment.find().sort({ _id: 1 }).lean(),
    events: await PaymentEvent.find().sort({ _id: 1 }).lean(),
    refunds: await ManualRefundEvidence.find().sort({ _id: 1 }).lean(),
    loyalty: await LoyaltyTransaction.find().sort({ _id: 1 }).lean(),
  });

  // These fixtures model only explicit server-owned checkout snapshots; no contract doubles.
  async function classifiedFixture({
    status = 'PICKED_UP',
    lines = [
      { classification: 'MERCHANDISE', price: 100.25, quantity: 2 },
      { classification: 'CLINICAL', price: 99.5, quantity: 1 },
    ],
  } = {}) {
    const amount =
      lines.reduce((sum, line) => sum + Math.round(line.price * 100) * line.quantity, 0) / 100;
    const source = await fixture({ status, amount });
    await OrderItem.collection.deleteMany({ orderId: source.order._id });
    for (const line of lines) {
      await OrderItem.create({
        orderId: source.order._id,
        inventoryId: source.inventory._id,
        itemName: 'Authoritative item',
        price: line.price,
        quantity: line.quantity,
        classificationSnapshot: {
          source: 'Inventory',
          sourceInventoryId: source.inventory._id,
          category: 'Never used for eligibility',
          itemClassification: line.classification,
          loyaltyEligibility: {
            UNKNOWN: 'UNKNOWN',
            MERCHANDISE: 'ELIGIBLE',
            CLINICAL: 'INELIGIBLE',
          }[line.classification],
        },
      });
    }
    return source;
  }
  const complete = (source) =>
    updateOrderStatus(source.order._id.toString(), 'COMPLETED', auth.userId);
  async function withVerifiedPreCompletionHistory(source) {
    const progression = {
      PROCESSING: ['ORDER_CREATED', 'PROCESSING'],
      READY_FOR_PICKUP: ['ORDER_CREATED', 'PROCESSING', 'READY_FOR_PICKUP'],
      PICKED_UP: ['ORDER_CREATED', 'PROCESSING', 'READY_FOR_PICKUP', 'PICKED_UP'],
      CANCELLED: ['ORDER_CREATED', 'PROCESSING', 'CANCELLED'],
    }[source.order.status];
    const statusHistory = progression.map((status) => ({
      status,
      changedAt: new Date(),
      ...(status === 'PROCESSING'
        ? { source: 'PAYMENT_SYSTEM', paymentId: source.payment._id }
        : {
            source: 'USER',
            changedBy:
              status === 'ORDER_CREATED'
                ? source.customer._id
                : new mongoose.Types.ObjectId(auth.userId),
          }),
    }));
    await Order.collection.updateOne({ _id: source.order._id }, { $set: { statusHistory } });
    return source;
  }
  it.each(['PROCESSING', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'])(
    'records a full refund for provably never-earned %s Orders without inventing points',
    async (status) => {
      const source = await withVerifiedPreCompletionHistory(await fixture({ status, amount: 100 }));
      const before = await snapshot();
      const response = await refundRequest(source);
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('refunded');
      const after = await snapshot();
      expect(after.orders[0].status).toBe(status);
      expect(after.orders[0].statusHistory).toEqual(before.orders[0].statusHistory);
      expect(after.inventory).toEqual(before.inventory);
      expect(after.events).toEqual(before.events);
      expect(after.loyalty).toHaveLength(0);
      expect(after.refunds).toHaveLength(1);
      expect(await readBalance(source)).toBe('0.00');
      const replay = await refundRequest(source);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(response.body);
      expect(await LoyaltyTransaction.countDocuments()).toBe(0);
      expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    }
  );
  it('serializes concurrent pre-completion refund retries with no loyalty write', async () => {
    const source = await withVerifiedPreCompletionHistory(await fixture({ status: 'PROCESSING' }));
    const results = await Promise.all([
      refundRequest(source),
      refundRequest(source),
      refundRequest(source),
    ]);
    results.forEach((result) => expect(result.status).toBe(200));
    expect(results[1].body).toEqual(results[0].body);
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    expect(await LoyaltyTransaction.countDocuments()).toBe(0);
    expect(await readBalance(source)).toBe('0.00');
  });
  it('serializes a provably unawarded refund against Order completion', async () => {
    const source = await withVerifiedPreCompletionHistory(await classifiedFixture());
    const results = await Promise.allSettled([
      complete(source),
      recordConfirmedManualFullRefund({
        auth,
        ...args(source),
        evidence: { amount: source.payment.amount, currency: 'LKR' },
        idempotencyKey: 'refund-versus-completion',
      }),
    ]);
    expect(results[1].status).toBe('fulfilled');
    const order = await Order.findById(source.order._id);
    const payment = await Payment.findById(source.payment._id);
    expect(payment.status).toBe('refunded');
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    expect(await readBalance(source)).toBe('0.00');
    if (order.status === 'COMPLETED') {
      expect(results[0].status).toBe('fulfilled');
      expect(await LoyaltyTransaction.countDocuments({ eventType: TYPE.EARN_PURCHASE })).toBe(1);
      expect(await LoyaltyTransaction.countDocuments({ eventType: TYPE.REFUND_REVERSAL })).toBe(1);
    } else {
      expect(order.status).toBe('PICKED_UP');
      expect(results[0].status).toBe('rejected');
      expect(await LoyaltyTransaction.countDocuments()).toBe(0);
    }
    expect((await Inventory.findById(source.inventory._id)).quantity).toBe(5);
  });
  it.each(['incomplete history', 'prior completion', 'inconsistent balance'])(
    'holds pre-completion no-award proof with %s and rolls back refund writes',
    async (kind) => {
      const source = await withVerifiedPreCompletionHistory(
        await fixture({ status: 'PROCESSING' })
      );
      if (kind === 'incomplete history')
        await Order.collection.updateOne(
          { _id: source.order._id },
          { $set: { statusHistory: [] } }
        );
      if (kind === 'prior completion')
        await Order.collection.updateOne(
          { _id: source.order._id },
          {
            $push: {
              statusHistory: {
                status: 'COMPLETED',
                changedAt: new Date(),
                changedBy: new mongoose.Types.ObjectId(auth.userId),
              },
            },
          }
        );
      if (kind === 'inconsistent balance')
        await Customer.collection.updateOne(
          { _id: source.customer._id },
          { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('1.00') } }
        );
      const before = await snapshot();
      expect((await refundRequest(source)).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    }
  );
  it('reverses a real historical award even when the current Order never completed', async () => {
    const source = await withVerifiedPreCompletionHistory(await fixture({ status: 'PROCESSING' }));
    resolvedContracts('250.00'); // Test-only simulation of historical premature earning.
    await earnPurchasePoints(args(source));
    expect(await readBalance(source)).toBe('2.50');
    const original = await LoyaltyTransaction.findOne({ eventType: TYPE.EARN_PURCHASE }).lean();
    const response = await refundRequest(source);
    expect(response.status).toBe(200);
    expect(await readBalance(source)).toBe('0.00');
    expect(await LoyaltyTransaction.countDocuments()).toBe(2);
    expect(await LoyaltyTransaction.findById(original._id).lean()).toEqual(original);
    expect(
      (await LoyaltyTransaction.findOne({ eventType: TYPE.REFUND_REVERSAL })).earningTransactionId
    ).toEqual(original._id);
  });
  it.each(['BRANCH_ASSISTANT', 'BRANCH_MANAGER'])(
    'awards through the existing authorized %s Order completion API',
    async (role) => {
      const source = await classifiedFixture();
      process.env.JWT_SECRET = 'loyalty-integration-secret';
      const token = jwt.sign({ ...auth, role }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
      });
      const response = await request(createApp())
        .patch(`/api/orders/${source.order._id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'COMPLETED' });
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('COMPLETED');
      expect(await readBalance(source)).toBe('2.01');
      expect(await LoyaltyTransaction.countDocuments()).toBe(1);
      expect(response.body.data).not.toHaveProperty('loyaltyBalance');
    }
  );
  const refundRequest = (source, role = 'BRANCH_MANAGER', changes = {}) => {
    const token = jwt.sign({ ...auth, role }, 'loyalty-integration-secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    process.env.JWT_SECRET = 'loyalty-integration-secret';
    return request(createApp())
      .post(`/api/payments/${source.payment._id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'confirmed-external-refund')
      .send({
        amount: source.payment.amount,
        currency: 'LKR',
        refundChannel: 'payhere_portal',
        refundReference: 'PORTAL-REFUND',
        ...changes,
      });
  };

  it('atomically completes the authorized Order and awards from merchandise only, rounding the aggregate once', async () => {
    const source = await classifiedFixture();
    const inventory = await Inventory.findById(source.inventory._id).lean();
    expect(await eligibility.deriveEligibleSpendForOrder(source.order._id)).toBe('200.50');
    const result = await complete(source);
    expect(result.status).toBe('COMPLETED');
    expect(result.statusHistory.at(-1)).toMatchObject({
      status: 'COMPLETED',
      changedBy: auth.userId,
    });
    expect(await readBalance(source)).toBe('2.01');
    expect(await LoyaltyTransaction.findOne().lean()).toMatchObject({
      eventType: TYPE.EARN_PURCHASE,
    });
    expect((await LoyaltyTransaction.findOne()).eligibleSpend.toString()).toBe('200.50');
    expect(await Inventory.findById(source.inventory._id).lean()).toEqual(inventory);
    expect(await earnPurchasePoints(args(source))).toMatchObject({ pointsDelta: '2.01' });
    expect(await LoyaltyTransaction.countDocuments()).toBe(1);
  });
  it('records a calculated zero award for explicitly clinical-only items, not a missing-history assumption', async () => {
    const source = await classifiedFixture({
      lines: [{ classification: 'CLINICAL', price: 100, quantity: 1 }],
    });
    await complete(source);
    expect(await readBalance(source)).toBe('0.00');
    expect((await LoyaltyTransaction.findOne()).pointsDelta.toString()).toBe('0.00');
    expect((await refundRequest(source)).status).toBe(200);
    expect(await LoyaltyTransaction.countDocuments()).toBe(2);
  });
  it.each(['UNKNOWN', 'legacy', 'unverified', 'reconciliation', 'mismatch'])(
    'rolls back completion for %s without financial, inventory or history changes',
    async (kind) => {
      const source =
        kind === 'legacy'
          ? await fixture({ status: 'PICKED_UP' })
          : await classifiedFixture({
              lines: [
                {
                  classification: kind === 'UNKNOWN' ? 'UNKNOWN' : 'MERCHANDISE',
                  price: 100,
                  quantity: 1,
                },
              ],
            });
      if (kind === 'unverified') await PaymentEvent.deleteMany({});
      if (kind === 'reconciliation')
        await Payment.updateOne(
          { _id: source.payment._id },
          { $set: { reconciliationRequired: true } }
        );
      if (kind === 'mismatch')
        await OrderItem.collection.updateOne(
          { orderId: source.order._id },
          { $set: { price: 50 } }
        );
      const before = await snapshot();
      await expect(complete(source)).rejects.toMatchObject({ statusCode: 409 });
      expect(await snapshot()).toEqual(before);
    }
  );
  it('rolls back Order completion, audit history and balance if ledger persistence fails', async () => {
    const source = await classifiedFixture();
    const before = await snapshot();
    const insertSpy = jest
      .spyOn(LoyaltyTransaction.collection, 'insertOne')
      .mockRejectedValueOnce(new Error('ledger insert unavailable'));
    await expect(complete(source)).rejects.toThrow('ledger insert unavailable');
    expect(await snapshot()).toEqual(before);
    insertSpy.mockRestore();

    const completed = await complete(source);
    const after = await snapshot();
    expect(completed.status).toBe('COMPLETED');
    expect(await readBalance(source)).toBe('2.01');
    expect(await LoyaltyTransaction.countDocuments({ eventType: TYPE.EARN_PURCHASE })).toBe(1);
    expect(after.orders).toHaveLength(1);
    expect(after.payments).toEqual(before.payments);
    expect(after.inventory).toEqual(before.inventory);
    expect(
      after.orders[0].statusHistory.filter((entry) => entry.status === 'COMPLETED')
    ).toHaveLength(1);
  });
  it('allows only one concurrent completion and one award while preserving terminal state rules', async () => {
    const source = await classifiedFixture();
    const results = await Promise.allSettled([
      complete(source),
      complete(source),
      complete(source),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await Order.findById(source.order._id)).statusHistory.filter(
        (entry) => entry.status === 'COMPLETED'
      )
    ).toHaveLength(1);
    expect(await LoyaltyTransaction.countDocuments()).toBe(1);
    expect(await readBalance(source)).toBe('2.01');
  });
  it('coordinates completion against a competing manual refund without losing an earning or reversal', async () => {
    const source = await classifiedFixture();
    const results = await Promise.allSettled([
      complete(source),
      recordConfirmedManualFullRefund({
        auth,
        ...args(source),
        evidence: { amount: source.payment.amount, currency: 'LKR' },
        idempotencyKey: 'competing-refund',
      }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const payment = await Payment.findById(source.payment._id);
    expect((await Order.findById(source.order._id)).status).toBe('COMPLETED');
    expect(await LoyaltyTransaction.countDocuments({ eventType: TYPE.EARN_PURCHASE })).toBe(1);
    if (payment.status === 'refunded') {
      expect(results[1].status).toBe('fulfilled');
      expect(await LoyaltyTransaction.countDocuments({ eventType: TYPE.REFUND_REVERSAL })).toBe(1);
      expect(await readBalance(source)).toBe('0.00');
      expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    } else {
      expect(payment.status).toBe('completed');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: { errorCode: 'LOYALTY_EARNING_HISTORY_MISSING' },
      });
      expect(await readBalance(source)).toBe('2.01');
      expect(await ManualRefundEvidence.countDocuments()).toBe(0);
      expect(await LoyaltyTransaction.countDocuments()).toBe(1);
    }
    expect((await Inventory.findById(source.inventory._id)).quantity).toBe(5);
  });
  it('records and durably replays a manager full refund with real reversal; never changes Order or stock', async () => {
    const source = await classifiedFixture();
    await complete(source);
    const before = await snapshot();
    const results = await Promise.all([
      refundRequest(source),
      refundRequest(source),
      refundRequest(source),
    ]);
    results.forEach((result) => expect(result.status).toBe(200));
    expect(results[1].body).toEqual(results[0].body);
    expect(await readBalance(source)).toBe('0.00');
    const after = await snapshot();
    expect(after.inventory).toEqual(before.inventory);
    expect(after.orders[0].statusHistory).toEqual(before.orders[0].statusHistory);
    expect(after.orders[0].status).toBe('COMPLETED');
    expect(after.events).toEqual(before.events);
    expect(after.refunds).toHaveLength(1);
    expect(after.loyalty).toHaveLength(2);
    expect(after.loyalty).toEqual(expect.arrayContaining(before.loyalty));
    expect(after.payments[0].status).toBe('refunded');
    const text = JSON.stringify(results[0].body);
    for (const field of [
      'passwordHash',
      'idempotencyKey',
      'requestHash',
      'md5sig',
      'loyaltyBalance',
    ])
      expect(text).not.toContain(field);
    const replay = await refundRequest(source);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(results[0].body);
  });
  it.each(['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN'])(
    'forbids %s from recording manual refunds',
    async (role) => {
      const source = await classifiedFixture();
      await complete(source);
      const before = await snapshot();
      expect((await refundRequest(source, role)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    }
  );
  it('rejects anonymous refund recording and unsafe inputs without state changes', async () => {
    const source = await classifiedFixture();
    await complete(source);
    const before = await snapshot();
    expect(
      (await request(createApp()).post(`/api/payments/${source.payment._id}/refunds`).send({}))
        .status
    ).toBe(401);
    for (const changes of [
      { amount: 1 },
      { currency: 'USD' },
      { status: 'refunded' },
      { pointsDelta: '-100' },
      { refundReference: {} },
    ])
      expect((await refundRequest(source, 'BRANCH_MANAGER', changes)).status).toBe(422);
    expect((await refundRequest(source).unset('Idempotency-Key')).status).toBe(422);
    expect((await refundRequest(source).query({ force: 'true' })).status).toBe(422);
    expect(await snapshot()).toEqual(before);
  });
  it.each(['missing-award', 'reconciliation', 'missing-reversal'])(
    'holds refund recording/replay with %s instead of inventing resolution',
    async (kind) => {
      const source = await classifiedFixture();
      if (kind !== 'missing-award') await complete(source);
      if (kind === 'reconciliation')
        await Payment.updateOne(
          { _id: source.payment._id },
          { $set: { reconciliationRequired: true } }
        );
      if (kind === 'missing-reversal') {
        await refundEvidence(source);
        await Payment.updateOne({ _id: source.payment._id }, { $set: { status: 'refunded' } });
      }
      const before = await snapshot();
      const response =
        kind === 'missing-reversal'
          ? await recordConfirmedManualFullRefund({
              auth,
              ...args(source),
              evidence: {
                amount: source.payment.amount,
                currency: 'LKR',
                refundChannel: 'payhere_portal',
                refundReference: 'EXTERNAL-REFUND',
              },
              idempotencyKey: source.payment._id.toString(),
            }).catch((error) => ({ status: error.statusCode, errorCode: error.errorCode }))
          : await refundRequest(source);
      expect(response.status).toBe(409);
      if (kind === 'missing-reversal')
        expect(response.errorCode).toBe('REFUND_LOYALTY_REVERSAL_UNCONFIRMED');
      expect(await snapshot()).toEqual(before);
    }
  );

  it('initializes new Customers at exact zero without exposing balance in existing Customer responses', async () => {
    const source = await fixture();
    expect(await readBalance(source)).toBe('0.00');
    expect(source.customer.toJSON()).not.toHaveProperty('loyaltyBalance');
    expect(await Customer.findById(source.customer._id).lean()).not.toHaveProperty(
      'loyaltyBalance'
    );
  });
  it.each(['PROCESSING', 'PICKED_UP'])(
    'rejects earning before Order COMPLETED (%s) with no local changes',
    async (status) => {
      const source = await fixture({ status });
      const before = await snapshot();
      await expect(earnPurchasePoints(args(source))).rejects.toMatchObject({
        errorCode: 'LOYALTY_ORDER_NOT_COMPLETED',
      });
      expect(await snapshot()).toEqual(before);
    }
  );
  it.each(['Frame', 'Clinical eye test', 'Contact lens', 'Mystery item'])(
    'never infers eligibility from free-text item/category %s or substitutes total',
    async (itemName) => {
      const source = await fixture();
      await OrderItem.updateOne({ _id: source.item._id }, { $set: { itemName } });
      await Inventory.updateOne({ _id: source.inventory._id }, { $set: { category: itemName } });
      const before = await snapshot();
      await expect(eligibility.deriveEligibleSpendForOrder(source.order._id)).rejects.toMatchObject(
        { errorCode: 'LOYALTY_ITEM_CLASSIFICATION_REQUIRED' }
      );
      expect(await snapshot()).toEqual(before);
    }
  );
  it('holds legacy missing inventory references and missing item records', async () => {
    const source = await fixture();
    await OrderItem.collection.updateOne({ _id: source.item._id }, { $set: { inventoryId: null } });
    await expect(eligibility.deriveEligibleSpendForOrder(source.order._id)).rejects.toMatchObject({
      errorCode: 'LOYALTY_ITEM_CLASSIFICATION_REQUIRED',
    });
    await OrderItem.collection.deleteMany({});
    await expect(eligibility.deriveEligibleSpendForOrder(source.order._id)).rejects.toMatchObject({
      errorCode: 'LOYALTY_ITEM_CLASSIFICATION_REQUIRED',
    });
  });
  it('uses only backend-derived eligible spend and rounds the final points HALF_UP', async () => {
    resolvedContracts('250.50');
    const source = await fixture({ amount: 251 });
    expect(await earnPurchasePoints(args(source))).toMatchObject({ pointsDelta: '2.51' });
  });
  it('records exact decimal earning once under concurrent retries with the real ledger/balance transaction', async () => {
    resolvedContracts();
    const source = await fixture();
    const results = await Promise.all([
      earnPurchasePoints(args(source)),
      earnPurchasePoints(args(source)),
      earnPurchasePoints(args(source)),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      pointsDelta: '2.50',
      balanceAfter: '2.50',
      sourceEventId: source.capture._id.toString(),
    });
    expect(await readBalance(source)).toBe('2.50');
    expect(await LoyaltyTransaction.countDocuments()).toBe(1);
    const record = await LoyaltyTransaction.findOne().lean();
    await expect(
      LoyaltyTransaction.collection.insertOne({ ...record, _id: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ code: 11000 });
  });
  it('serializes different Orders for the same Customer without losing decimal balance increments', async () => {
    resolvedContracts();
    const first = await fixture();
    const second = await fixture({ customer: first.customer });
    await Promise.all([earnPurchasePoints(args(first)), earnPurchasePoints(args(second))]);
    expect(await readBalance(first)).toBe('5.00');
    expect(await LoyaltyTransaction.countDocuments()).toBe(2);
  });
  it.each(['pending', 'failed', 'cancelled', 'refunded'])(
    'requires verified successful Payment instead of %s',
    async (status) => {
      resolvedContracts();
      const source = await fixture();
      await Payment.updateOne({ _id: source.payment._id }, { $set: { status } });
      const before = await snapshot();
      await expect(earnPurchasePoints(args(source))).rejects.toMatchObject({
        errorCode: 'LOYALTY_PAYMENT_INELIGIBLE',
      });
      expect(await snapshot()).toEqual(before);
    }
  );
  it('rejects missing verified capture and Order/Payment amount mismatches', async () => {
    resolvedContracts();
    const source = await fixture();
    await PaymentEvent.deleteMany({});
    await expect(earnPurchasePoints(args(source))).rejects.toMatchObject({
      errorCode: 'LOYALTY_PAYMENT_INELIGIBLE',
    });
    expect(await readBalance(source)).toBe('0.00');
    expect(await LoyaltyTransaction.countDocuments()).toBe(0);
  });
  it('joins caller-owned earning transactions and rolls back balance/history together', async () => {
    resolvedContracts();
    const source = await fixture();
    const session = await mongoose.startSession();
    const failure = new Error('abort earning');
    try {
      await expect(
        session.withTransaction(async () => {
          const result = await earnPurchasePoints({ ...args(source), session });
          expect(session.inTransaction()).toBe(true);
          expect(
            (
              await LoyaltyTransaction.findById(result.transactionId).session(session)
            ).pointsDelta.toString()
          ).toBe('2.50');
          expect(await readBalance(source)).toBe('0.00');
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(await readBalance(source)).toBe('0.00');
      expect(await LoyaltyTransaction.countDocuments()).toBe(0);
      await earnPurchasePoints(args(source));
      expect(await readBalance(source)).toBe('2.50');
    } finally {
      await session.endSession();
    }
  });
  it('rolls back a balance write if history persistence fails', async () => {
    resolvedContracts();
    const source = await fixture();
    const before = await snapshot();
    jest
      .spyOn(LoyaltyTransaction.collection, 'insertOne')
      .mockRejectedValueOnce(new Error('ledger unavailable'));
    await expect(earnPurchasePoints(args(source))).rejects.toThrow('ledger unavailable');
    expect(await snapshot()).toEqual(before);
  });
  it('reverses precisely the original award once and preserves earning, capture, Order and inventory history', async () => {
    resolvedContracts();
    const source = await fixture();
    const earning = await earnPurchasePoints(args(source));
    const input = await refunded(source);
    const before = await snapshot();
    expect(await verifyFullRefundPoints(input)).toBe(false);
    const results = await Promise.all([
      reverseFullRefundPoints(input),
      reverseFullRefundPoints(input),
      reverseFullRefundPoints(input),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      pointsDelta: '-2.50',
      balanceAfter: '0.00',
      earningTransactionId: earning.transactionId,
      sourceEventId: input.refundEvidenceId,
    });
    expect(await verifyFullRefundPoints(input)).toBe(true);
    expect(await readBalance(source)).toBe('0.00');
    expect(await LoyaltyTransaction.countDocuments()).toBe(2);
    const after = await snapshot();
    expect(after.loyalty).toEqual(expect.arrayContaining(before.loyalty));
    expect(after.events).toEqual(before.events);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.orders[0].status).toBe(before.orders[0].status);
    expect(after.orders[0].statusHistory).toEqual(before.orders[0].statusHistory);
  });
  it('does not invent a deduction or successful verification from missing historical awards', async () => {
    const source = await fixture();
    const input = await refunded(source);
    const before = await snapshot();
    await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
      errorCode: 'LOYALTY_EARNING_HISTORY_MISSING',
    });
    expect(await verifyFullRefundPoints(input)).toBe(false);
    const after = await snapshot();
    expect(after.customers).toEqual(before.customers);
    expect(after.loyalty).toEqual([]);
  });
  it('rolls back reversal and verification evidence with its caller-owned refund transaction', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const input = await refunded(source);
    const session = await mongoose.startSession();
    const failure = new Error('abort reversal');
    try {
      await expect(
        session.withTransaction(async () => {
          await reverseFullRefundPoints({ ...input, session });
          expect(await verifyFullRefundPoints({ ...input, session })).toBe(true);
          throw failure;
        })
      ).rejects.toBe(failure);
      expect(await readBalance(source)).toBe('2.50');
      expect(await LoyaltyTransaction.countDocuments()).toBe(1);
      expect(await verifyFullRefundPoints(input)).toBe(false);
    } finally {
      await session.endSession();
    }
  });
  it.each([
    ['missing', { $unset: { loyaltyBalance: '' } }],
    ['null', { $set: { loyaltyBalance: null } }],
  ])('holds a legacy %s balance on earning without silently backfilling', async (_case, update) => {
    resolvedContracts();
    const source = await fixture();
    await Customer.collection.updateOne({ _id: source.customer._id }, update);
    const before = await snapshot();

    await expect(earnPurchasePoints(args(source))).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'LOYALTY_BALANCE_UNINITIALIZED',
    });
    expect(await snapshot()).toEqual(before);
  });
  it('holds a legacy null balance at the reversal boundary without changing stored state', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const input = await refunded(source);
    await Customer.collection.updateOne(
      { _id: source.customer._id },
      { $set: { loyaltyBalance: null } }
    );
    const before = await snapshot();

    await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'LOYALTY_BALANCE_UNINITIALIZED',
    });
    expect(await snapshot()).toEqual(before);
  });
  it('holds balance/history inconsistencies without silently backfilling', async () => {
    resolvedContracts();
    const source = await fixture();
    await Customer.collection.updateOne(
      { _id: source.customer._id },
      { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('10.00') } }
    );
    await expect(earnPurchasePoints(args(source))).rejects.toMatchObject({
      errorCode: 'LOYALTY_BALANCE_HISTORY_MISMATCH',
    });
    expect(await LoyaltyTransaction.countDocuments()).toBe(0);
  });
  it('holds a reversal needing an unspecified negative-balance policy, without clamping or debt creation', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const input = await refunded(source);
    // Fixture-only prior redemption history; no redemption implementation/API is added.
    const redemption = new LoyaltyTransaction({
      customerId: source.customer._id,
      orderId: source.order._id,
      paymentId: source.payment._id,
      eventType: TYPE.REDEMPTION_DEDUCTION,
      sourceEventId: new mongoose.Types.ObjectId(),
      providerTransactionId: source.payment.providerTransactionId,
      pointsDelta: '-1.50',
      balanceAfter: '1.00',
    });
    await redemption.validate();
    await LoyaltyTransaction.collection.insertOne(redemption.toObject());
    await Customer.collection.updateOne(
      { _id: source.customer._id },
      { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('1.00') } }
    );
    const before = await snapshot();
    await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
      errorCode: 'LOYALTY_NEGATIVE_BALANCE_POLICY_REQUIRED',
    });
    expect(await snapshot()).toEqual(before);
  });
  it('uses the real reversal boundary internally to commit a manual refund and verify durable replay', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const request = {
      auth,
      ...args(source),
      evidence: { amount: 250, currency: 'LKR', refundReference: 'CONFIRMED-REFUND' },
      idempotencyKey: 'real-refund',
    };
    const results = await Promise.all([
      recordConfirmedManualFullRefund(request),
      recordConfirmedManualFullRefund(request),
      recordConfirmedManualFullRefund(request),
    ]);
    const result = results[0];
    expect(results[1]).toEqual(result);
    expect(results[2]).toEqual(result);
    expect(result.status).toBe('refunded');
    expect(await readBalance(source)).toBe('0.00');
    expect(await recordConfirmedManualFullRefund(request)).toEqual(result);
    expect(await LoyaltyTransaction.countDocuments()).toBe(2);
    expect(await ManualRefundEvidence.countDocuments()).toBe(1);
    for (const role of ['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN'])
      await expect(
        recordConfirmedManualFullRefund({ ...request, auth: { ...auth, role } })
      ).rejects.toMatchObject({ statusCode: 403 });
    expect((await Order.findById(source.order._id)).status).toBe('COMPLETED');
    expect((await Inventory.findById(source.inventory._id)).quantity).toBe(5);
  });
  it.each(['target', 'other', 'event'])(
    'never bypasses %s unresolved reconciliation for earning or reversal',
    async (kind) => {
      resolvedContracts();
      const source = await fixture();
      await earnPurchasePoints(args(source));
      const input = await refunded(source);
      if (kind === 'target')
        await Payment.updateOne(
          { _id: source.payment._id },
          { $set: { reconciliationRequired: true } }
        );
      if (kind === 'other')
        await Payment.create({
          orderId: source.order._id,
          amount: 250,
          method: 'online_gateway',
          status: 'failed',
          reconciliationRequired: true,
        });
      if (kind === 'event')
        await PaymentEvent.updateOne(
          { _id: source.capture._id },
          { $set: { action: 'reconciliation_required' } }
        );
      const before = await snapshot();
      await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
        errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      await expect(verifyFullRefundPoints(input)).rejects.toMatchObject({
        errorCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      });
      expect(await snapshot()).toEqual(before);
    }
  );
  it('rolls back Payment, refund evidence, Customer balance and loyalty history if real reversal persistence fails', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const before = await snapshot();
    jest
      .spyOn(LoyaltyTransaction.collection, 'insertOne')
      .mockRejectedValueOnce(new Error('reversal insert failed'));
    await expect(
      recordConfirmedManualFullRefund({
        auth,
        ...args(source),
        evidence: { amount: 250, currency: 'LKR' },
        idempotencyKey: 'rollback-full-refund',
      })
    ).rejects.toThrow('reversal insert failed');
    expect(await snapshot()).toEqual(before);
  });
  it('propagates caller-owned duplicate-key aborts without leaking a balance increment or history', async () => {
    resolvedContracts();
    const source = await fixture();
    const before = await snapshot();
    const insert = LoyaltyTransaction.collection.insertOne.bind(LoyaltyTransaction.collection);
    jest
      .spyOn(LoyaltyTransaction.collection, 'insertOne')
      .mockImplementationOnce(async (document, options) => {
        await insert(document, options);
        return insert({ ...document, _id: new mongoose.Types.ObjectId() }, options);
      });
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      await expect(earnPurchasePoints({ ...args(source), session })).rejects.toMatchObject({
        code: 11000,
      });
      await session.abortTransaction();
      expect(await snapshot()).toEqual(before);
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });
  it('rejects a refund reference to another capture instead of treating refunded status as proof', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const input = await refunded(source);
    // Deliberately poisoned immutable audit field in this disposable fixture only.
    await ManualRefundEvidence.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(input.refundEvidenceId) },
      { $set: { providerTransactionId: 'UNRELATED' } }
    );
    const before = await snapshot();
    await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
      errorCode: 'LOYALTY_REFUND_SOURCE_MISMATCH',
    });
    await expect(verifyFullRefundPoints(input)).rejects.toMatchObject({
      errorCode: 'LOYALTY_REFUND_SOURCE_MISMATCH',
    });
    expect(await snapshot()).toEqual(before);
  });
  it('does not verify a persisted reversal with a different delta from its original earning', async () => {
    resolvedContracts();
    const source = await fixture();
    await earnPurchasePoints(args(source));
    const input = await refunded(source);
    await reverseFullRefundPoints(input);
    // Native tampering simulates compromised historical data, never an application write path.
    await LoyaltyTransaction.collection.updateOne(
      { eventType: TYPE.REFUND_REVERSAL },
      { $set: { pointsDelta: mongoose.Types.Decimal128.fromString('-1.00') } }
    );
    expect(await verifyFullRefundPoints(input)).toBe(false);
    await expect(reverseFullRefundPoints(input)).rejects.toMatchObject({
      errorCode: 'LOYALTY_SOURCE_CONFLICT',
    });
  });
  it('prevents ODM edits to persisted earning history and balance-replacing aggregation', async () => {
    resolvedContracts();
    const source = await fixture();
    const earning = await earnPurchasePoints(args(source));
    const document = await LoyaltyTransaction.findById(earning.transactionId);
    for (const operation of [
      () => document.save(),
      () => document.deleteOne(),
      () => LoyaltyTransaction.updateOne({ _id: document._id }, { $set: { pointsDelta: '99.00' } }),
    ])
      await expect(operation()).rejects.toMatchObject({ errorCode: 'LOYALTY_WRITE_FORBIDDEN' });
    await expect(LoyaltyTransaction.create(document.toObject())).rejects.toMatchObject({
      errorCode: 'LOYALTY_WRITE_FORBIDDEN',
    });
    await expect(
      Customer.aggregate([{ $match: {} }, { $merge: Customer.collection.name }])
    ).rejects.toMatchObject({ errorCode: 'LOYALTY_WRITE_FORBIDDEN' });
    expect((await LoyaltyTransaction.findById(earning.transactionId)).pointsDelta.toString()).toBe(
      '2.50'
    );
    expect(await readBalance(source)).toBe('2.50');
  });
  it('forbids arbitrary profile/model balance changes and ODM loyalty history writes', async () => {
    const source = await fixture();
    await expect(
      updateOwnProfile(source.customer._id.toString(), { loyaltyBalance: 999 })
    ).rejects.toMatchObject({ statusCode: 422 });
    for (const update of [
      { $set: { loyaltyBalance: '999.00' } },
      { $inc: { loyaltyBalance: 1 } },
      { $unset: { loyaltyBalance: '' } },
      { $rename: { name: 'loyaltyBalance' } },
      [{ $set: { loyaltyBalance: '1.00' } }],
    ])
      await expect(Customer.updateOne({ _id: source.customer._id }, update)).rejects.toMatchObject({
        errorCode: 'LOYALTY_WRITE_FORBIDDEN',
      });
    await expect(
      Customer.create({
        name: 'Forged',
        email: 'forged@example.com',
        phone: '+94711234567',
        passwordHash: `$2b$12$${'a'.repeat(53)}`,
        loyaltyBalance: '10.00',
      })
    ).rejects.toMatchObject({ errorCode: 'LOYALTY_WRITE_FORBIDDEN' });
    await expect(
      Customer.bulkWrite([
        {
          updateOne: {
            filter: { _id: source.customer._id },
            update: { $set: { loyaltyBalance: '1.00' } },
          },
        },
      ])
    ).rejects.toMatchObject({ errorCode: 'LOYALTY_WRITE_FORBIDDEN' });
    await expect(LoyaltyTransaction.deleteMany({})).rejects.toMatchObject({
      errorCode: 'LOYALTY_WRITE_FORBIDDEN',
    });
    await expect(LoyaltyTransaction.insertMany([])).rejects.toMatchObject({
      errorCode: 'LOYALTY_WRITE_FORBIDDEN',
    });
    expect(await readBalance(source)).toBe('0.00');
  });
});
