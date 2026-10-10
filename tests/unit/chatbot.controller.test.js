const { handleChatbotQuery } = require('../../src/controllers/chatbot.controller');
const ChatbotService = require('../../src/services/chatbot.service');
const { UnauthorizedError } = require('../../src/errors/AppError');

jest.mock('../../src/services/chatbot.service');

describe('ChatbotController (Unit tests)', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      auth: { userId: 'customer_id_123' },
      body: { message: 'What are store opening hours?' },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should call ChatbotService.processQuery with JWT customer ID and return normalized response', async () => {
    ChatbotService.processQuery.mockResolvedValue({
      chatId: 'chat_123',
      inquiryType: 'STORE_INFO',
      responseStatus: 'ANSWERED',
      responseText: 'Store is open Mon-Sat 9AM-7PM.',
    });

    await handleChatbotQuery(req, res, next);

    expect(ChatbotService.processQuery).toHaveBeenCalledWith({
      customerId: 'customer_id_123',
      message: 'What are store opening hours?',
      history: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        chatId: 'chat_123',
        inquiryType: 'STORE_INFO',
        responseStatus: 'ANSWERED',
        responseText: 'Store is open Mon-Sat 9AM-7PM.',
      },
    });
  });

  it('should pass error to next middleware if req.auth is missing', async () => {
    req.auth = null;
    req.user = null;

    await handleChatbotQuery(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
