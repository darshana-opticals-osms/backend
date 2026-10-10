const mongoose = require('mongoose');
const Chatbot = require('../../src/models/chatbot.model');
const {
  INQUIRY_TYPES,
  INQUIRY_TYPE_VALUES,
  RESPONSE_STATUSES,
  RESPONSE_STATUS_VALUES,
} = require('../../src/constants/chatbot.constants');

describe('Chatbot model (Unit tests)', () => {
  const validCustomerId = new mongoose.Types.ObjectId();

  it('should validate a valid Chatbot metadata record', async () => {
    const chatbot = new Chatbot({
      chatId: 'chat-uuid-12345',
      customerId: validCustomerId,
      inquiryType: INQUIRY_TYPES.STORE_INFO,
      responseStatus: RESPONSE_STATUSES.ANSWERED,
    });

    await expect(chatbot.validate()).resolves.toBeUndefined();
    expect(chatbot.chatId).toBe('chat-uuid-12345');
    expect(chatbot.customerId).toEqual(validCustomerId);
    expect(chatbot.inquiryType).toBe(INQUIRY_TYPES.STORE_INFO);
    expect(chatbot.responseStatus).toBe(RESPONSE_STATUSES.ANSWERED);
  });

  it('should set default inquiryType and responseStatus when not provided', () => {
    const chatbot = new Chatbot({
      chatId: 'chat-uuid-67890',
      customerId: validCustomerId,
    });

    expect(chatbot.inquiryType).toBe(INQUIRY_TYPES.GENERAL_INQUIRY);
    expect(chatbot.responseStatus).toBe(RESPONSE_STATUSES.ANSWERED);
  });

  it('should fail validation when chatId is missing', async () => {
    const chatbot = new Chatbot({
      customerId: validCustomerId,
    });

    await expect(chatbot.validate()).rejects.toThrow();
  });

  it('should fail validation when customerId is missing', async () => {
    const chatbot = new Chatbot({
      chatId: 'chat-uuid-123',
    });

    await expect(chatbot.validate()).rejects.toThrow();
  });

  it('should fail validation when inquiryType is invalid', async () => {
    const chatbot = new Chatbot({
      chatId: 'chat-uuid-123',
      customerId: validCustomerId,
      inquiryType: 'INVALID_TYPE',
    });

    await expect(chatbot.validate()).rejects.toThrow();
  });

  it('should fail validation when responseStatus is invalid', async () => {
    const chatbot = new Chatbot({
      chatId: 'chat-uuid-123',
      customerId: validCustomerId,
      responseStatus: 'INVALID_STATUS',
    });

    await expect(chatbot.validate()).rejects.toThrow();
  });

  it('should accept all valid inquiryType values', async () => {
    for (const type of INQUIRY_TYPE_VALUES) {
      const chatbot = new Chatbot({
        chatId: `chat-${type}`,
        customerId: validCustomerId,
        inquiryType: type,
      });
      await expect(chatbot.validate()).resolves.toBeUndefined();
    }
  });

  it('should accept all valid responseStatus values', async () => {
    for (const status of RESPONSE_STATUS_VALUES) {
      const chatbot = new Chatbot({
        chatId: `chat-${status}`,
        customerId: validCustomerId,
        responseStatus: status,
      });
      await expect(chatbot.validate()).resolves.toBeUndefined();
    }
  });
});
