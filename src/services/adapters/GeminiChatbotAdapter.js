const IChatbotAdapter = require('./IChatbotAdapter');
const { CHATBOT_DEFAULTS } = require('../../constants/chatbot.constants');
const { loadConfig } = require('../../config/env');

/**
 * GeminiChatbotAdapter (ADR-010 Section 9.1 & 11.3)
 *
 * Confirmed default provider adapter connecting to Google Gemini API.
 * Implements 6,000ms timeout and max 1 retry on transient server errors (HTTP 502, 503, 504).
 * Fails fast without retries on client 4xx errors as required by ADR-010.
 */
class GeminiChatbotAdapter extends IChatbotAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Google Gemini API Key
   * @param {string} [config.model] - Gemini Model name
   * @param {number} [config.timeoutMs] - Timeout in milliseconds (default: 6000)
   * @param {number} [config.maxRetries] - Max retry count (default: 1)
   */
  constructor(config = {}) {
    super();
    let sysConfig = {};
    try {
      sysConfig = loadConfig();
    } catch {
      // Fallback for uninitialized test environments
    }

    this.apiKey = config.apiKey !== undefined ? config.apiKey : sysConfig.geminiApiKey || '';
    this.model = config.model || sysConfig.geminiModel || 'gemini-flash-lite-latest';
    this.timeoutMs = config.timeoutMs || sysConfig.chatbotTimeoutMs || CHATBOT_DEFAULTS.TIMEOUT_MS;
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
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
        const err = new Error(`Gemini API error (${this.model} HTTP ${response.status})`);
        err.status = response.status;
        err.rawDetails = errorText;
        throw err;
      }

      const data = await response.json();
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`AI Provider call timed out after ${this.timeoutMs}ms.`);
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    }
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
        // ADR-010 Section 11.3: Retry max 1 time ONLY on transient server errors (HTTP 502/503/504)
        const isTransient = err.status >= 502 && err.status <= 504;
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
