const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const KnowledgeArea = require('../../src/models/knowledgeArea.model');
const Chatbot = require('../../src/models/chatbot.model');
const ChatbotService = require('../../src/services/chatbot.service');
const MockChatbotAdapter = require('../../src/services/adapters/MockChatbotAdapter');
const {
  INQUIRY_TYPES,
  RESPONSE_STATUSES,
  CHATBOT_DEFAULTS,
} = require('../../src/constants/chatbot.constants');
const { AppError } = require('../../src/errors/AppError');

describe('ChatbotService (Unit tests)', () => {
  let mongoServer;
  const mockCustomerId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await KnowledgeArea.deleteMany({});
    await Chatbot.deleteMany({});

    // Seed baseline test knowledge
    await KnowledgeArea.create([
      {
        articleId: 'KA-STORE-001',
        category: 'STORE_INFO',
        contentTitle: 'Store Opening Hours',
        contentBody: 'Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.',
        keywords: ['hours', 'opening', 'time'],
        isActive: true,
      },
      {
        articleId: 'KA-SERV-001',
        category: 'SERVICES',
        contentTitle: 'Eye Examination Services',
        contentBody: 'Comprehensive eye testing by qualified optometrists.',
        keywords: ['eye test', 'examination', 'optometrist'],
        isActive: true,
      },
    ]);
  });

  it('should process supported query and return grounded response (AC20)', async () => {
    const mockAdapter = new MockChatbotAdapter({
      defaultResponse: 'Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.',
    });

    const result = await ChatbotService.processQuery({
      customerId: mockCustomerId.toString(),
      message: 'What are your store opening hours?',
      adapter: mockAdapter,
    });

    expect(result.chatId).toBeDefined();
    expect(result.inquiryType).toBe(INQUIRY_TYPES.STORE_INFO);
    expect(result.responseStatus).toBe(RESPONSE_STATUSES.ANSWERED);
    expect(result.responseText).toContain('Monday to Saturday');

    // Verify Chatbot metadata saved in DB
    const savedMetadata = await Chatbot.findOne({ chatId: result.chatId });
    expect(savedMetadata).not.toBeNull();
    expect(savedMetadata.inquiryType).toBe(INQUIRY_TYPES.STORE_INFO);
    expect(savedMetadata.responseStatus).toBe(RESPONSE_STATUSES.ANSWERED);
  });

  it('should reject empty or whitespace-only messages (AC15)', async () => {
    await expect(
      ChatbotService.processQuery({
        customerId: mockCustomerId.toString(),
        message: '   ',
        adapter: new MockChatbotAdapter(),
      })
    ).rejects.toThrow(AppError);
  });

  it('should reject messages exceeding max length limit (AC15)', async () => {
    const longMessage = 'a'.repeat(501);
    await expect(
      ChatbotService.processQuery({
        customerId: mockCustomerId.toString(),
        message: longMessage,
        adapter: new MockChatbotAdapter(),
      })
    ).rejects.toThrow(AppError);
  });

  it('should enforce clinical data boundary defense (AC27)', async () => {
    const result = await ChatbotService.processQuery({
      customerId: mockCustomerId.toString(),
      message: 'What is my SPH and CYL prescription result?',
      adapter: new MockChatbotAdapter(),
    });

    expect(result.inquiryType).toBe(INQUIRY_TYPES.UNSUPPORTED_OTHER);
    expect(result.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(result.responseText).toContain('qualified optometrist');
  });

  it('should enforce payment credential boundary defense (AC28)', async () => {
    const result = await ChatbotService.processQuery({
      customerId: mockCustomerId.toString(),
      message: 'Here is my credit card CVV 123',
      adapter: new MockChatbotAdapter(),
    });

    expect(result.inquiryType).toBe(INQUIRY_TYPES.UNSUPPORTED_OTHER);
    expect(result.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(result.responseText).toContain('Payment credentials');
  });

  it('should trigger store contact fallback when zero matching knowledge is found (AC21)', async () => {
    const result = await ChatbotService.processQuery({
      customerId: mockCustomerId.toString(),
      message: 'Do you sell space telescopes and rocket parts?',
      adapter: new MockChatbotAdapter(),
    });

    expect(result.inquiryType).toBe(INQUIRY_TYPES.UNSUPPORTED_OTHER);
    expect(result.responseStatus).toBe(RESPONSE_STATUSES.UNSUPPORTED);
    expect(result.responseText).toBe(CHATBOT_DEFAULTS.UNSUPPORTED_FALLBACK_TEXT);
  });

  it('should handle provider failure gracefully and return failure fallback (AC36)', async () => {
    const failingAdapter = new MockChatbotAdapter({
      shouldFail: true,
      failError: new Error('Gemini API Timeout 6000ms'),
    });

    const result = await ChatbotService.processQuery({
      customerId: mockCustomerId.toString(),
      message: 'What are store opening hours?',
      adapter: failingAdapter,
    });

    expect(result.responseStatus).toBe(RESPONSE_STATUSES.FAILED);
    expect(result.responseText).toBe(CHATBOT_DEFAULTS.FAILURE_FALLBACK_TEXT);

    const savedMetadata = await Chatbot.findOne({ chatId: result.chatId });
    expect(savedMetadata.responseStatus).toBe(RESPONSE_STATUSES.FAILED);
  });
});
