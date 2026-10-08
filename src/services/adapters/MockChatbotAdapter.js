const IChatbotAdapter = require('./IChatbotAdapter');

/**
 * MockChatbotAdapter (ADR-010 Section 9.1 & 12)
 *
 * Deterministic mock provider adapter for automated unit & integration testing.
 * Prevents automated tests from consuming external API calls or requiring live keys.
 */
class MockChatbotAdapter extends IChatbotAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.defaultResponse] - Fixed text to return
   * @param {boolean} [config.shouldFail] - If true, simulates provider failure
   * @param {Error} [config.failError] - Custom error to throw on failure
   */
  constructor(config = {}) {
    super();
    this.defaultResponse = config.defaultResponse || null;
    this.shouldFail = config.shouldFail || false;
    this.failError = config.failError || new Error('Mock AI Provider Failure');
    this.lastCalledParams = null;
  }

  async generateResponse({ prompt, systemInstruction, history = [] }) {
    this.lastCalledParams = { prompt, systemInstruction, history };

    if (this.shouldFail) {
      throw this.failError;
    }

    if (this.defaultResponse) {
      return { text: this.defaultResponse, rawProviderStatus: 'MOCK_OK' };
    }

    // Dynamic mock response from grounded context if available
    if (systemInstruction && systemInstruction.includes('Content: ')) {
      const match = systemInstruction.match(/Content:\s*([^\n]+)/);
      if (match && match[1]) {
        return { text: match[1].trim(), rawProviderStatus: 'MOCK_OK' };
      }
    }

    return {
      text: 'Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.',
      rawProviderStatus: 'MOCK_OK',
    };
  }
}


module.exports = MockChatbotAdapter;
