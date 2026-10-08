const IChatbotAdapter = require('./IChatbotAdapter');
const { CHATBOT_DEFAULTS } = require('../../constants/chatbot.constants');

/**
 * GeminiChatbotAdapter (ADR-010 Section 9.1 & 11.3)
 *
 * Confirmed default provider adapter connecting to Google Gemini API (gemini-1.5-flash).
 * Implements 6,000ms timeout and max 1 retry on transient network errors.
 */
class GeminiChatbotAdapter extends IChatbotAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Google Gemini API Key
   * @param {number} [config.timeoutMs] - Timeout in milliseconds (default: 6000)
   * @param {number} [config.maxRetries] - Max retry count (default: 1)
   */
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    this.timeoutMs = config.timeoutMs || CHATBOT_DEFAULTS.TIMEOUT_MS;
    this.maxRetries =
      config.maxRetries !== undefined ? config.maxRetries : CHATBOT_DEFAULTS.MAX_RETRIES;
  }

  /**
   * Formats chat history into Gemini contents payload array.
   */
  _formatContents(prompt, history = []) {
    const contents = [];

    // Add bounded context history (up to last 6 messages)
    for (const msg of history) {
      const role = msg.role === 'user' ? 'user' : 'model';
      contents.push({
        role,
        parts: [{ text: msg.text }],
      });
    }

    // Add current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    return contents;
  }

  /**
   * Executes Gemini HTTP API request with timeout.
   */
  async _executeApiCall(payload) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured on backend.');
    }

    const modelsToTry = [
      process.env.GEMINI_MODEL || 'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-pro-latest',
    ];

    let lastError = null;

    for (const model of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(`Gemini API error (${model} HTTP ${response.status})`);
          err.status = response.status;
          err.rawDetails = errorText;
          throw err;
        }

        const data = await response.json();
        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        // If 503/502 server high-demand error, attempt fallback model
        if (err.status === 503 || err.status === 502) {
          continue;
        }
        if (err.name === 'AbortError') {
          const timeoutErr = new Error(`AI Provider call timed out after ${this.timeoutMs}ms.`);
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }
        throw err;
      }
    }

    throw lastError;
  }

  async generateResponse({ prompt, systemInstruction, history = [] }) {
    const contents = this._formatContents(prompt, history);

    const payload = {
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents,
      generationConfig: {
        temperature: 0.2, // Low temperature for factual grounding
        maxOutputTokens: 500,
      },
    };

    let attempt = 0;
    let lastError = null;

    while (attempt <= this.maxRetries) {
      try {
        const data = await this._executeApiCall(payload);
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!candidateText) {
          throw new Error('Empty response payload from Gemini API.');
        }

        return {
          text: candidateText.trim(),
          rawProviderStatus: 'GEMINI_OK',
        };
      } catch (err) {
        lastError = err;
        // Retry only on transient errors (timeout or HTTP 5xx) if retries left
        const isTransient = err.isTimeout || (err.status >= 500 && err.status <= 599);
        if (attempt < this.maxRetries && isTransient) {
          attempt++;
          continue;
        }
        break;
      }
    }

    throw lastError;
  }
}

module.exports = GeminiChatbotAdapter;
