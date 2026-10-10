/**
 * IChatbotAdapter Interface (ADR-010 Section 9.1)
 *
 * Abstract provider adapter interface that standardizes all AI provider interactions.
 */
class IChatbotAdapter {
  /**
   * Generates a normalized response from the AI provider.
   *
   * @param {Object} options
   * @param {string} options.prompt - Grounded user message/prompt
   * @param {string} options.systemInstruction - Centralized system grounding instructions
   * @param {Array<{role: string, text: string}>} [options.history] - Bounded conversation history
   * @returns {Promise<{text: string, rawProviderStatus?: string}>}
   */
  async generateResponse(_options) {
    throw new Error('IChatbotAdapter.generateResponse must be implemented by subclass.');
  }
}

module.exports = IChatbotAdapter;
