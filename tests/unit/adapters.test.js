const IChatbotAdapter = require('../../src/services/adapters/IChatbotAdapter');
const MockChatbotAdapter = require('../../src/services/adapters/MockChatbotAdapter');
const GeminiChatbotAdapter = require('../../src/services/adapters/GeminiChatbotAdapter');

describe('AI Chatbot Adapters (Unit tests)', () => {
  describe('IChatbotAdapter Base Interface', () => {
    it('should throw error when calling generateResponse directly on base class', async () => {
      const adapter = new IChatbotAdapter();
      await expect(adapter.generateResponse({ prompt: 'test' })).rejects.toThrow(
        'IChatbotAdapter.generateResponse must be implemented by subclass.'
      );
    });
  });

  describe('MockChatbotAdapter', () => {
    it('should return default response when provided', async () => {
      const mockAdapter = new MockChatbotAdapter({
        defaultResponse: 'Custom mock answer',
      });
      const result = await mockAdapter.generateResponse({
        prompt: 'What are store hours?',
        systemInstruction: 'System instruction text',
      });

      expect(result.text).toBe('Custom mock answer');
      expect(result.rawProviderStatus).toBe('MOCK_OK');
      expect(mockAdapter.lastCalledParams.prompt).toBe('What are store hours?');
    });

    it('should simulate failure when shouldFail is true', async () => {
      const mockAdapter = new MockChatbotAdapter({
        shouldFail: true,
        failError: new Error('Simulated Timeout'),
      });

      await expect(mockAdapter.generateResponse({ prompt: 'Hello' })).rejects.toThrow(
        'Simulated Timeout'
      );
    });
  });

  describe('GeminiChatbotAdapter', () => {
    it('should throw error when GEMINI_API_KEY is missing', async () => {
      const adapter = new GeminiChatbotAdapter({ apiKey: '' });
      await expect(
        adapter.generateResponse({ prompt: 'Hello', systemInstruction: 'Instruction' })
      ).rejects.toThrow('GEMINI_API_KEY is not configured on backend.');
    });

    it('should format contents correctly for API payload', () => {
      const adapter = new GeminiChatbotAdapter({ apiKey: 'fake-key' });
      const history = [
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello! How can I help?' },
      ];
      const contents = adapter._formatContents('Store hours?', history);

      expect(contents).toHaveLength(3);
      expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'Hi' }] });
      expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'Hello! How can I help?' }] });
      expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'Store hours?' }] });
    });
  });
});
