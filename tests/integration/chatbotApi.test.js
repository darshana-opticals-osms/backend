const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const KnowledgeArea = require('../../src/models/knowledgeArea.model');
const Chatbot = require('../../src/models/chatbot.model');
const Customer = require('../../src/models/customer.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  INQUIRY_TYPES,
  RESPONSE_STATUSES,
  CHATBOT_DEFAULTS,
} = require('../../src/constants/chatbot.constants');

const JWT_SECRET = 'chatbot-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({ userId, role = ROLE_VALUES.CUSTOMER } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('AI Chatbot REST API Endpoints (Integration tests)', () => {
  let app;
  let originalEnv;
  let testCustomer;
  let customerToken;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await Promise.all([
      KnowledgeArea.deleteMany({}),
      Chatbot.deleteMany({}),
      Customer.deleteMany({}),
    ]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    await Promise.all([
      KnowledgeArea.deleteMany({}),
      Chatbot.deleteMany({}),
      Customer.deleteMany({}),
    ]);

    testCustomer = await Customer.create({
      name: 'Chatbot Customer',
      email: 'chatbot.customer@example.com',
      phone: '+94771234567',
      address: '123 Main Street',
      passwordHash: '$2b$12$eImiTXuWVxfM37uY4JANjO5E.pE1J1e1.1e1e1e1e1e1e1e1e1e1e',
    });

    customerToken = createToken({ userId: testCustomer._id.toString() });

    // Seed baseline Knowledge Area articles
    await KnowledgeArea.create([
      {
        articleId: 'KA-STORE-001',
        category: 'STORE_INFO',
        contentTitle: 'Store Opening Hours',
        contentBody: 'Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.',
        keywords: ['hours', 'opening', 'time', 'colombo'],
        isActive: true,
      },
      {
        articleId: 'KA-SERV-001',
        category: 'SERVICES',
        contentTitle: 'Eye Examination Services',
        contentBody: 'We provide comprehensive eye health examinations by qualified optometrists.',
        keywords: ['eye test', 'optometrist', 'appointment'],
        isActive: true,
      },
    ]);
  });

  it('should answer a supported store hours inquiry statelessly and return HTTP 200 (AC2, AC20)', async () => {
    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        message: 'What are your store opening hours in Colombo?',
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data).toBeDefined();
    expect(response.body.data.chatId).toBeDefined();
    expect(response.body.data.inquiryType).toBe(INQUIRY_TYPES.STORE_INFO);
    expect(response.body.data.responseStatus).toBe(RESPONSE_STATUSES.ANSWERED);
    expect(response.body.data.responseText).toContain('Monday to Saturday');

    // Verify metadata record saved in Chatbot collection
    const metadata = await Chatbot.findOne({ chatId: response.body.data.chatId });
    expect(metadata).not.toBeNull();
    expect(metadata.customerId.toString()).toBe(testCustomer._id.toString());
  });

  it('should return store contact fallback for out-of-scope unsupported inquiries (AC21, AC22)', async () => {
    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        message: 'Who won the 1996 Cricket World Cup?',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.inquiryType).toBe(INQUIRY_TYPES.UNSUPPORTED_OTHER);
    expect(response.body.data.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(response.body.data.responseText).toBe(CHATBOT_DEFAULTS.UNSUPPORTED_FALLBACK_TEXT);
  });

  it('should enforce clinical prescription boundary and direct customer to optometrist (AC27)', async () => {
    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        message: 'What is my SPH and CYL prescription result?',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(response.body.data.responseText).toContain('qualified optometrist');
  });

  it('should enforce payment credential boundary and reject CVV/card numbers (AC28)', async () => {
    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        message: 'My credit card number is 4111111111111111 and CVV 123',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(response.body.data.responseText).toContain('Payment credentials');
  });

  it('should reject unauthenticated requests with HTTP 401 (AC12)', async () => {
    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .send({ message: 'Store hours?' });

    expect(response.status).toBe(401);
  });

  it('should reject non-CUSTOMER roles with HTTP 403 (ADR-002, AC12)', async () => {
    const staffToken = createToken({
      userId: testCustomer._id.toString(),
      role: ROLE_VALUES.OPTOMETRIST,
    });

    const response = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ message: 'Store hours?' });

    expect(response.status).toBe(403);
  });

  it('should reject empty or invalid message payloads with HTTP 422 or 400 (AC15)', async () => {
    const emptyResponse = await request(app)
      .post('/api/v1/chatbot/query')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ message: '   ' });

    expect([400, 422]).toContain(emptyResponse.status);
  });
});
