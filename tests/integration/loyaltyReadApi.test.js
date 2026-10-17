const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const { createAccessToken } = require('../../src/utils/jwt');
const Customer = require('../../src/models/customer.model');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

describe('GET /api/loyalty/me', () => {
  let server;
  let app;
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiry = process.env.JWT_EXPIRES_IN;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'loyalty-read-api-secret-with-adequate-length';
    process.env.JWT_EXPIRES_IN = '1h';
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    await Promise.all([Customer.init(), LoyaltyTransaction.init()]);
    app = createApp();
  });

  beforeEach(async () => {
    await LoyaltyTransaction.collection.deleteMany({});
    await Customer.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalExpiry === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = originalExpiry;
  });

  async function customer(label) {
    return Customer.create({
      name: `${label} Customer`,
      email: `${label.toLowerCase()}-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+94711234567',
      address: 'Private address',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
  }

  function token(userId, role = ROLE_VALUES.CUSTOMER) {
    return createAccessToken({ userId: userId.toString(), role });
  }

  async function insertTransaction({
    owner,
    type,
    delta,
    balance,
    orderId,
    paymentId = new mongoose.Types.ObjectId(),
    createdAt,
    id,
  }) {
    const result = await LoyaltyTransaction.collection.insertOne({
      ...(id ? { _id: id } : {}),
      customerId: owner._id,
      orderId,
      paymentId,
      eventType: type,
      sourceEventId: new mongoose.Types.ObjectId(),
      earningTransactionId: type === 'REFUND_REVERSAL' ? new mongoose.Types.ObjectId() : null,
      providerTransactionId: `private-${new mongoose.Types.ObjectId()}`,
      eligibleSpend:
        type === 'EARN_PURCHASE' ? mongoose.Types.Decimal128.fromString('250.00') : null,
      pointsDelta: mongoose.Types.Decimal128.fromString(delta),
      balanceAfter: mongoose.Types.Decimal128.fromString(balance),
      createdAt,
    });
    return { id: result.insertedId, customerId: owner._id, orderId, paymentId, type };
  }

  it('returns an initialized Customer zero balance and empty history', async () => {
    const owner = await customer('Zero');
    const response = await request(app)
      .get('/api/loyalty/me')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        balance: '0.00',
        transactions: [],
        pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
      },
    });
  });

  it('returns only the authenticated Customer history in deterministic pages and safe DTOs', async () => {
    const owner = await customer('Owner');
    const other = await customer('Other');
    const olderOrder = new mongoose.Types.ObjectId();
    const newerOrder = new mongoose.Types.ObjectId();
    await Customer.collection.updateOne(
      { _id: owner._id },
      { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('1.25') } }
    );
    await insertTransaction({
      owner,
      type: 'EARN_PURCHASE',
      delta: '2.50',
      balance: '2.50',
      orderId: olderOrder,
      createdAt: new Date('2026-10-15T10:00:00.000Z'),
    });
    await insertTransaction({
      owner,
      type: 'REFUND_REVERSAL',
      delta: '-1.25',
      balance: '1.25',
      orderId: newerOrder,
      createdAt: new Date('2026-10-16T10:00:00.000Z'),
    });
    await insertTransaction({
      owner: other,
      type: 'EARN_PURCHASE',
      delta: '99.00',
      balance: '99.00',
      orderId: new mongoose.Types.ObjectId(),
      createdAt: new Date('2026-10-17T10:00:00.000Z'),
    });

    const first = await request(app)
      .get('/api/loyalty/me?page=1&limit=1')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(200);
    expect(first.body.data.balance).toBe('1.25');
    expect(first.body.data.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(first.body.data.transactions[0]).toEqual({
      id: expect.any(String),
      type: 'REFUND_REVERSAL',
      pointsDelta: '-1.25',
      balanceAfter: '1.25',
      orderId: newerOrder.toString(),
      createdAt: '2026-10-16T10:00:00.000Z',
    });
    expect(Object.keys(first.body.data.transactions[0])).toEqual([
      'id',
      'type',
      'pointsDelta',
      'balanceAfter',
      'orderId',
      'createdAt',
    ]);
    expect(JSON.stringify(first.body)).not.toMatch(
      /email|phone|address|password|token|providerTransactionId|sourceEventId|paymentId|private-/i
    );

    const second = await request(app)
      .get('/api/loyalty/me?page=2&limit=1')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(200);
    expect(second.body.data.transactions[0].orderId).toBe(olderOrder.toString());
    expect(JSON.stringify(second.body)).not.toContain('99.00');
  });

  it('uses the JWT Customer identity so Customer B receives no Customer A information', async () => {
    const first = await customer('First');
    const second = await customer('Second');
    await Customer.collection.updateOne(
      { _id: first._id },
      { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('80.00') } }
    );

    const response = await request(app)
      .get('/api/loyalty/me')
      .set('Authorization', `Bearer ${token(second._id)}`)
      .expect(200);
    expect(response.body.data.balance).toBe('0.00');
    expect(response.body.data.transactions).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(first._id.toString());
    expect(JSON.stringify(response.body)).not.toContain('80.00');
  });

  it('uses _id descending as the deterministic tie-breaker for equal timestamps', async () => {
    const owner = await customer('TieBreak');
    const createdAt = new Date('2026-10-16T12:00:00.000Z');
    const lowerId = new mongoose.Types.ObjectId('68f0a0000000000000000001');
    const higherId = new mongoose.Types.ObjectId('68f0a0000000000000000002');
    await Customer.collection.updateOne(
      { _id: owner._id },
      { $set: { loyaltyBalance: mongoose.Types.Decimal128.fromString('2.00') } }
    );
    await insertTransaction({
      owner,
      id: lowerId,
      type: 'EARN_PURCHASE',
      delta: '1.00',
      balance: '1.00',
      orderId: new mongoose.Types.ObjectId(),
      createdAt,
    });
    await insertTransaction({
      owner,
      id: higherId,
      type: 'EARN_PURCHASE',
      delta: '1.00',
      balance: '2.00',
      orderId: new mongoose.Types.ObjectId(),
      createdAt,
    });

    const firstPage = await request(app)
      .get('/api/loyalty/me?page=1&limit=1')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(200);
    const secondPage = await request(app)
      .get('/api/loyalty/me?page=2&limit=1')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(200);

    expect(firstPage.body.data.transactions[0].id).toBe(higherId.toString());
    expect(secondPage.body.data.transactions[0].id).toBe(lowerId.toString());
  });

  it('returns 401 anonymously and 403 for every non-Customer canonical role', async () => {
    await request(app).get('/api/loyalty/me').expect(401);
    const userId = new mongoose.Types.ObjectId();
    for (const role of [
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.BRANCH_ASSISTANT,
      ROLE_VALUES.OPTOMETRIST,
      ROLE_VALUES.SYSTEM_ADMIN,
    ]) {
      await request(app)
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${token(userId, role)}`)
        .expect(403);
    }
  });

  it('returns a safe 404 when the authenticated Customer no longer exists', async () => {
    const absentId = new mongoose.Types.ObjectId();
    const response = await request(app)
      .get('/api/loyalty/me')
      .set('Authorization', `Bearer ${token(absentId)}`)
      .expect(404);
    expect(response.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain(absentId.toString());
  });

  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?customerId=507f1f77bcf86cd799439011',
    '?sortBy=createdAt',
    '?page[$gt]=0',
    '?page=1&page=2',
  ])('rejects unsafe query %s without leaking ownership data', async (suffix) => {
    const owner = await customer(`Validation${new mongoose.Types.ObjectId()}`);
    const response = await request(app)
      .get(`/api/loyalty/me${suffix}`)
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .expect(422);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|Private address|@example\.com/);
  });

  it('rejects request body fields on the read-only endpoint', async () => {
    const owner = await customer('Body');
    await request(app)
      .get('/api/loyalty/me')
      .set('Authorization', `Bearer ${token(owner._id)}`)
      .send({ customerId: new mongoose.Types.ObjectId().toString() })
      .expect(422);
  });

  it.each([
    ['missing', { $unset: { loyaltyBalance: '' } }],
    ['null', { $set: { loyaltyBalance: null } }],
  ])(
    'returns an explicit conflict for a legacy Customer with a %s balance',
    async (_case, update) => {
      const owner = await customer(`Legacy${_case}`);
      await Customer.collection.updateOne({ _id: owner._id }, update);

      const response = await request(app)
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${token(owner._id)}`)
        .expect(409);
      expect(response.body.error.code).toBe('LOYALTY_BALANCE_UNINITIALIZED');
      const stored = (await Customer.findById(owner._id).select('+loyaltyBalance').lean())
        .loyaltyBalance;
      if (_case === 'missing') expect(stored).toBeUndefined();
      else expect(stored).toBeNull();
      expect(await LoyaltyTransaction.countDocuments({ customerId: owner._id })).toBe(0);
    }
  );

  describe('BRANCH_MANAGER monitoring', () => {
    async function managementFixture() {
      const first = await customer('ManagerFirst');
      const second = await customer('ManagerSecond');
      const commonTime = new Date('2026-10-16T12:00:00.000Z');
      const lowerId = new mongoose.Types.ObjectId('68f0b0000000000000000001');
      const higherId = new mongoose.Types.ObjectId('68f0b0000000000000000002');
      const earning = await insertTransaction({
        owner: first,
        id: lowerId,
        type: 'EARN_PURCHASE',
        delta: '10.00',
        balance: '10.00',
        orderId: new mongoose.Types.ObjectId(),
        createdAt: commonTime,
      });
      const reversal = await insertTransaction({
        owner: first,
        id: higherId,
        type: 'REFUND_REVERSAL',
        delta: '-2.50',
        balance: '7.50',
        orderId: new mongoose.Types.ObjectId(),
        createdAt: commonTime,
      });
      const other = await insertTransaction({
        owner: second,
        type: 'EARN_PURCHASE',
        delta: '3.25',
        balance: '3.25',
        orderId: new mongoose.Types.ObjectId(),
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
      });
      return { first, second, earning, reversal, other, lowerId, higherId };
    }

    it('returns an empty default page to BRANCH_MANAGER and rejects all other roles', async () => {
      const actor = new mongoose.Types.ObjectId();
      const managerResponse = await request(app)
        .get('/api/loyalty')
        .set('Authorization', `Bearer ${token(actor, ROLE_VALUES.BRANCH_MANAGER)}`)
        .expect(200);
      expect(managerResponse.body).toEqual({
        success: true,
        data: {
          transactions: [],
          pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
        },
      });
      await request(app).get('/api/loyalty').expect(401);
      for (const role of [
        ROLE_VALUES.CUSTOMER,
        ROLE_VALUES.SYSTEM_ADMIN,
        ROLE_VALUES.BRANCH_ASSISTANT,
        ROLE_VALUES.OPTOMETRIST,
      ]) {
        await request(app)
          .get('/api/loyalty')
          .set('Authorization', `Bearer ${token(actor, role)}`)
          .expect(403);
      }
    });

    it('supports each exact filter, combined filters and empty filtered results', async () => {
      const fixture = await managementFixture();
      const manager = token(new mongoose.Types.ObjectId(), ROLE_VALUES.BRANCH_MANAGER);
      for (const [field, value, expectedId] of [
        ['customerId', fixture.second._id, fixture.other.id],
        ['orderId', fixture.earning.orderId, fixture.earning.id],
        ['paymentId', fixture.reversal.paymentId, fixture.reversal.id],
        ['eventType', 'REFUND_REVERSAL', fixture.reversal.id],
      ]) {
        const response = await request(app)
          .get('/api/loyalty')
          .query({ [field]: value.toString() })
          .set('Authorization', `Bearer ${manager}`)
          .expect(200);
        expect(response.body.data.transactions.map((item) => item.id)).toEqual([
          expectedId.toString(),
        ]);
      }

      const combined = await request(app)
        .get('/api/loyalty')
        .query({
          customerId: fixture.first._id.toString(),
          orderId: fixture.earning.orderId.toString(),
          paymentId: fixture.earning.paymentId.toString(),
          eventType: 'EARN_PURCHASE',
        })
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(combined.body.data.pagination.total).toBe(1);
      expect(combined.body.data.transactions[0].id).toBe(fixture.earning.id.toString());

      const empty = await request(app)
        .get('/api/loyalty')
        .query({ customerId: new mongoose.Types.ObjectId().toString() })
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(empty.body.data.transactions).toEqual([]);
      expect(empty.body.data.pagination.total).toBe(0);
    });

    it('returns safe fixed-decimal DTOs without Customer PII or provider evidence', async () => {
      await managementFixture();
      const before = await LoyaltyTransaction.countDocuments();
      const response = await request(app)
        .get('/api/loyalty?limit=100')
        .set(
          'Authorization',
          `Bearer ${token(new mongoose.Types.ObjectId(), ROLE_VALUES.BRANCH_MANAGER)}`
        )
        .expect(200);
      expect(response.body.data.transactions).toHaveLength(3);
      expect(Object.keys(response.body.data.transactions[0])).toEqual([
        'id',
        'customerId',
        'orderId',
        'paymentId',
        'type',
        'pointsDelta',
        'balanceAfter',
        'createdAt',
      ]);
      for (const item of response.body.data.transactions) {
        expect(item.pointsDelta).toMatch(/^-?\d+\.\d{2}$/);
        expect(item.balanceAfter).toMatch(/^\d+\.\d{2}$/);
      }
      expect(JSON.stringify(response.body)).not.toMatch(
        /email|phone|address|password|token|providerTransactionId|sourceEventId|private-/i
      );
      expect(await LoyaltyTransaction.countDocuments()).toBe(before);
    });

    it('sorts both directions with stable _id tie-breaking across pages', async () => {
      const fixture = await managementFixture();
      const manager = token(new mongoose.Types.ObjectId(), ROLE_VALUES.BRANCH_MANAGER);
      const descendingFirst = await request(app)
        .get('/api/loyalty?page=1&limit=1&sortOrder=desc')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      const descendingSecond = await request(app)
        .get('/api/loyalty?page=2&limit=1&sortOrder=desc')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(descendingFirst.body.data.transactions[0].id).toBe(fixture.higherId.toString());
      expect(descendingSecond.body.data.transactions[0].id).toBe(fixture.lowerId.toString());

      const ascending = await request(app)
        .get('/api/loyalty?page=2&limit=2&sortOrder=asc')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(ascending.body.data.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(ascending.body.data.transactions[0].id).toBe(fixture.higherId.toString());

      const maximums = await request(app)
        .get('/api/loyalty?page=10000&limit=100')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(maximums.body.data.pagination).toMatchObject({ page: 10000, limit: 100, total: 3 });
    });

    it.each([
      '?page=0',
      '?page=-1',
      '?page=1.5',
      '?page=10001',
      '?limit=0',
      '?limit=101',
      '?limit[]=25',
      '?customerId=bad',
      '?orderId[$ne]=x',
      '?paymentId[]=507f1f77bcf86cd799439011',
      '?eventType=MANUAL_ADJUSTMENT',
      '?sortOrder=sideways',
      '?sortBy=createdAt',
      '?$where=true',
    ])('rejects unsafe monitoring query %s', async (suffix) => {
      await request(app)
        .get(`/api/loyalty${suffix}`)
        .set(
          'Authorization',
          `Bearer ${token(new mongoose.Types.ObjectId(), ROLE_VALUES.BRANCH_MANAGER)}`
        )
        .expect(422);
    });

    it('rejects request body fields without changing the Phase 1 Customer endpoint', async () => {
      const owner = await customer('Regression');
      const manager = token(new mongoose.Types.ObjectId(), ROLE_VALUES.BRANCH_MANAGER);
      await request(app)
        .get('/api/loyalty')
        .set('Authorization', `Bearer ${manager}`)
        .send({ eventType: 'EARN_PURCHASE' })
        .expect(422);
      const own = await request(app)
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${token(owner._id)}`)
        .expect(200);
      expect(own.body.data).toEqual({
        balance: '0.00',
        transactions: [],
        pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
      });
    });
  });
});
