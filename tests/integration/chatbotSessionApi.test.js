const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Usage = require('../../src/models/chatbotUsage.model');
const Chatbot = require('../../src/models/chatbot.model');
const Knowledge = require('../../src/models/knowledgeArea.model');
const Retrieval = require('../../src/services/knowledgeRetrieval.service');
const MockAdapter = require('../../src/services/adapters/MockChatbotAdapter');
const UsageService = require('../../src/services/chatbotUsage.service');
const ChatbotService = require('../../src/services/chatbot.service');
const { chatbotLimiter } = require('../../src/middleware/rateLimiter');

describe('Approved chatbot session budget: real endpoints and MongoDB', () => {
  let app, customer, token, originalEnv;
  const secret = 'chatbot-session-test-secret';
  const sign = (id) =>
    jwt.sign({ userId: id.toString(), role: 'CUSTOMER' }, secret, { expiresIn: '1h' });
  const post = (body = { message: 'Store hours?' }, path = '/api/v1/chatbot/query', auth) =>
    request(app)
      .post(path)
      .set('Authorization', `Bearer ${auth || token}`)
      .send(body);
  const seedUsage = (count, expiresAt = new Date(Date.now() + 1800000)) =>
    Usage.create({
      _id: customer._id,
      windowStart: new Date(),
      expiresAt,
      messageCount: count,
    });

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = secret;
    delete process.env.MONGODB_URI;
    await connectDatabase();
    await Usage.init();
    app = createApp();
  });
  afterAll(async () => {
    await disconnectDatabase();
    process.env = originalEnv;
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      Customer.deleteMany({}),
      Usage.deleteMany({}),
      Chatbot.deleteMany({}),
      Knowledge.deleteMany({}),
    ]);
    customer = await Customer.create({
      name: 'Session Customer',
      email: 'session@example.com',
      phone: '+94771234567',
      passwordHash: '$2b$12$' + 'a'.repeat(53),
    });
    token = sign(customer._id);
    await Knowledge.create({
      articleId: 'KA-HOURS',
      category: 'STORE_INFO',
      contentTitle: 'Store hours',
      contentBody: 'Open Monday to Saturday.',
      keywords: ['hours', 'store'],
      isActive: true,
    });
  });

  it('admits exactly ten exchanges, then rejects omitted/empty history before retrieval or provider work', async () => {
    const retrieve = jest.spyOn(Retrieval, 'findRelevantKnowledge');
    const provider = jest.spyOn(MockAdapter.prototype, 'generateResponse');
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await post(i % 2 ? { message: 'Store hours?', history: [] } : undefined)).status
      ).toBe(200);
    }
    expect((await Usage.findById(customer._id)).messageCount).toBe(20);
    // Advance the independent per-minute control without changing usage state.
    chatbotLimiter.resetKey(customer._id.toString());
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('CHATBOT_SESSION_EXHAUSTED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(1700);
    expect(retrieve).toHaveBeenCalledTimes(10);
    expect(provider).toHaveBeenCalledTimes(10);
    expect(Object.keys(await Usage.findById(customer._id).lean()).sort()).toEqual([
      '_id',
      'expiresAt',
      'messageCount',
      'windowStart',
    ]);
  });

  it('atomically admits only one concurrent final exchange across aliases', async () => {
    await seedUsage(18);
    const provider = jest.spyOn(MockAdapter.prototype, 'generateResponse');
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => post(undefined, i % 2 ? '/api/chatbot/query' : undefined))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CHATBOT_SESSION_EXHAUSTED')).toHaveLength(
      7
    );
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await Usage.findById(customer._id)).messageCount).toBe(20);
  });

  it('handles concurrent first creation and expired rollover without duplicate windows', async () => {
    await Promise.all(Array.from({ length: 10 }, () => UsageService.reserve(customer._id)));
    expect(await Usage.countDocuments()).toBe(1);
    expect((await Usage.findById(customer._id)).messageCount).toBe(20);
    await Usage.updateOne({ _id: customer._id }, { $set: { expiresAt: new Date(0) } });
    await Promise.all(Array.from({ length: 10 }, () => UsageService.reserve(customer._id)));
    const usage = await Usage.findById(customer._id);
    expect(usage.messageCount).toBe(20);
    expect(usage.expiresAt - usage.windowStart).toBe(1800000);
    expect(await Usage.countDocuments()).toBe(1);
  });

  it('rejects tampering and invalid input without charging and isolates authenticated Customers', async () => {
    for (const body of [
      { message: 'Store hours?', sessionId: 'foreign' },
      { message: 'Store hours?', customerId: customer._id.toString(), count: 0 },
      { message: 'a'.repeat(501) },
      { message: 'Store hours?', history: Array(7).fill({ role: 'user', text: 'hi' }) },
    ])
      expect((await post(body)).status).toBe(422);
    expect(await Usage.countDocuments()).toBe(0);
    expect((await post(undefined, undefined, token + 'tampered')).status).toBe(401);
    await seedUsage(20);
    expect((await post(undefined, undefined, sign(customer._id))).body.error.code).toBe(
      'CHATBOT_SESSION_EXHAUSTED'
    );
    const other = await Customer.create({
      name: 'Other',
      email: 'other@example.com',
      phone: '+94771234568',
      passwordHash: '$2b$12$' + 'b'.repeat(53),
    });
    expect((await post(undefined, undefined, sign(other._id))).status).toBe(200);
    expect((await Usage.findById(other._id)).messageCount).toBe(2);
    expect((await Usage.findById(customer._id)).messageCount).toBe(20);
  });

  it('counts failed fallback/manual replay, unsupported replies and does not refund retrieval errors', async () => {
    // Use the approved mock adapter failure path, without calling any live provider.
    const failure = new MockAdapter({ shouldFail: true });
    jest.spyOn(MockAdapter.prototype, 'generateResponse').mockRejectedValue(failure.failError);
    expect((await post()).body.data.responseStatus).toBe('FAILED');
    expect((await post()).body.data.responseStatus).toBe('FAILED');
    expect((await post({ message: 'My SPH prescription' })).body.data.responseStatus).toBe(
      'UNSUPPORTED'
    );
    jest
      .spyOn(Retrieval, 'findRelevantKnowledge')
      .mockRejectedValue(new Error('Retrieval unavailable'));
    expect((await post()).status).toBe(500);
    expect((await Usage.findById(customer._id)).messageCount).toBe(8);
  });

  it('fails closed when admission storage fails', async () => {
    jest.spyOn(Usage, 'findOneAndUpdate').mockRejectedValue(new Error('private database details'));
    const retrieve = jest.spyOn(Retrieval, 'findRelevantKnowledge');
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CHATBOT_USAGE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('private');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('charges one exchange for internal adapter retries and keeps reservations on persistence failure', async () => {
    const adapter = new MockAdapter();
    const internalAttempt = jest
      .fn()
      .mockRejectedValueOnce(new Error('Transient mock failure'))
      .mockResolvedValueOnce({ text: 'Open Monday.' });
    jest.spyOn(adapter, 'generateResponse').mockImplementation(async () => {
      try {
        return await internalAttempt();
      } catch {
        return internalAttempt();
      }
    });
    await ChatbotService.processQuery({
      customerId: customer._id,
      message: 'Store hours?',
      adapter,
    });
    expect(internalAttempt).toHaveBeenCalledTimes(2);
    expect((await Usage.findById(customer._id)).messageCount).toBe(2);
    jest.spyOn(Chatbot, 'create').mockRejectedValueOnce(new Error('Persistence failed'));
    expect((await post()).status).toBe(500);
    expect((await Usage.findById(customer._id)).messageCount).toBe(4);
  });

  it('preserves a new window when an old admitted provider call completes after rollover', async () => {
    let release, entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const adapter = new MockAdapter();
    jest.spyOn(adapter, 'generateResponse').mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        release = () => resolve({ text: 'Open Monday.' });
      });
    });
    const pending = ChatbotService.processQuery({
      customerId: customer._id,
      message: 'Store hours?',
      adapter,
    });
    await ready;
    await Usage.updateOne({ _id: customer._id }, { $set: { expiresAt: new Date(0) } });
    expect((await post()).status).toBe(200);
    release();
    await pending;
    expect((await Usage.findById(customer._id)).messageCount).toBe(2);
  });

  it.each(['deleteOne', 'deleteMany', 'document'])(
    'removes usage through Customer %s deletion',
    async (method) => {
      await seedUsage(2);
      if (method === 'document') await customer.deleteOne();
      else await Customer[method]({ _id: customer._id });
      expect(await Usage.findById(customer._id)).toBeNull();
    }
  );

  it('configures expiry cleanup and removes usage on Customer deletion', async () => {
    const indexes = await Usage.collection.indexes();
    expect(
      indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)
    ).toBe(true);
    await seedUsage(2);
    await Customer.findByIdAndDelete(customer._id);
    expect(await Usage.findById(customer._id)).toBeNull();
  });
});
