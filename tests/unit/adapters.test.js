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

    describe('API Call Execution & Retry Behavior (Mocked Fetch)', () => {
      let originalFetch;

      beforeEach(() => {
        originalFetch = global.fetch;
      });

      afterEach(() => {
        global.fetch = originalFetch;
      });

      it('should consume parameters passed or loaded from central config', () => {
        const adapter = new GeminiChatbotAdapter({
          apiKey: 'test-api-key',
          model: 'gemini-3.5-flash-lite',
          timeoutMs: 4000,
          maxRetries: 1,
        });

        expect(adapter.apiKey).toBe('test-api-key');
        expect(adapter.model).toBe('gemini-3.5-flash-lite');
        expect(adapter.timeoutMs).toBe(4000);
        expect(adapter.maxRetries).toBe(1);
      });

      it('should return parsed response text on successful API call', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Darshana Opticals is open Mon-Sat 9AM-7PM.' }],
                },
              },
            ],
          }),
        });

        const adapter = new GeminiChatbotAdapter({ apiKey: 'test-key' });
        const result = await adapter.generateResponse({
          prompt: 'Store hours?',
          systemInstruction: 'Grounded Context',
        });

        expect(result.text).toBe('Darshana Opticals is open Mon-Sat 9AM-7PM.');
        expect(result.rawProviderStatus).toBe('GEMINI_OK');
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      it('should retry max 1 time on transient HTTP 503 error and succeed', async () => {
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: 'Dynamic answer after retry' }] } }],
            }),
          });

        const adapter = new GeminiChatbotAdapter({ apiKey: 'test-key', maxRetries: 1 });
        const result = await adapter.generateResponse({
          prompt: 'Store location?',
          systemInstruction: 'Context',
        });

        expect(result.text).toBe('Dynamic answer after retry');
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      it('should fail fast without retrying on HTTP 4xx client errors (429, 404)', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 429,
          text: async () => 'Quota Exceeded',
        });

        const adapter = new GeminiChatbotAdapter({ apiKey: 'test-key', maxRetries: 1 });
        await expect(
          adapter.generateResponse({ prompt: 'Hello', systemInstruction: 'Context' })
        ).rejects.toThrow('Gemini API error (gemini-flash-lite-latest HTTP 429)');

        // Must NOT retry 4xx errors — exactly 1 fetch call made as required by ADR-010
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      it('should handle request timeout gracefully', async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';

        global.fetch = jest.fn().mockRejectedValue(abortError);

        const adapter = new GeminiChatbotAdapter({ apiKey: 'test-key', maxRetries: 1 });
        await expect(
          adapter.generateResponse({ prompt: 'Timeout test', systemInstruction: 'Context' })
        ).rejects.toThrow('AI Provider call timed out after 6000ms.');

        // Timeout is transient, so it retries up to maxRetries (total 2 attempts)
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });
  });
});
