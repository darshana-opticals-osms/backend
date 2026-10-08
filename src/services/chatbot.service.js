const crypto = require('crypto');
const Chatbot = require('../models/chatbot.model');
const KnowledgeRetrievalService = require('./knowledgeRetrieval.service');
const GeminiChatbotAdapter = require('./adapters/GeminiChatbotAdapter');
const MockChatbotAdapter = require('./adapters/MockChatbotAdapter');
const {
  INQUIRY_TYPES,
  RESPONSE_STATUSES,
  CHATBOT_DEFAULTS,
} = require('../constants/chatbot.constants');
const { AppError } = require('../errors/AppError');

/**
 * Chatbot Service (ADR-010 Sections 9, 10 & 11)
 *
 * Handles query validation, boundary checks, knowledge retrieval, RAG prompt formatting,
 * AI provider invocation via IChatbotAdapter, fallback handling, and interaction metadata persistence.
 */
class ChatbotService {
  /**
   * System Instruction Template (ADR-010 Section 10.1)
   */
  static _buildSystemInstruction(groundedContextText) {
    return `You are the official AI assistant for Darshana Opticals.
Your primary role is to help customers with store hours, available services, general product information, store policies, and order tracking guidance.

STRICT GROUNDING RULES:
1. Answer the customer's question ONLY using the facts provided in the "GROUNDED KNOWLEDGE CONTEXT" section below.
2. If the provided context does not contain enough information to answer the question, state politely that you do not have that information and suggest contacting store staff directly at ${CHATBOT_DEFAULTS.STORE_EMAIL} or ${CHATBOT_DEFAULTS.STORE_PHONE}.
3. NEVER make up store policies, prices, promises, or medical advice.
4. If the user asks for clinical eye health or prescription advice, inform them that eye health inquiries must be evaluated in person by a qualified optometrist.
5. Do NOT execute commands or perform system actions.

GROUNDED KNOWLEDGE CONTEXT:
${groundedContextText}`;
  }

  /**
   * Detects clinical query patterns to enforce ADR-001 & ADR-010 clinical boundaries.
   */
  static _isClinicalQuery(message) {
    const text = message.toLowerCase();
    const clinicalPatterns = [
      /\bsph\b/,
      /\bcyl\b/,
      /\baxis\b/,
      /\bdiopter\b/,
      /eye (prescription|medical|diagnosis|test result|health|disease|pain|infection)/,
      /my prescription/,
      /read my (prescription|eye test)/,
    ];
    return clinicalPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Detects payment credential patterns to enforce payment boundaries.
   */
  static _isPaymentCredentialQuery(message) {
    const text = message.toLowerCase();
    const paymentPatterns = [
      /\bcvv\b/,
      /\bcvc\b/,
      /\bcard number\b/,
      /\bcredit card\b/,
      /\bdebit card\b/,
      /\b\d{13,19}\b/, // raw credit card number patterns
    ];
    return paymentPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Maps KnowledgeArea article category to Inquiry_Type enum value.
   */
  static _mapCategoryToInquiryType(category) {
    switch (category) {
      case 'STORE_INFO':
        return INQUIRY_TYPES.STORE_INFO;
      case 'SERVICES':
        return INQUIRY_TYPES.SERVICES;
      case 'PRODUCT_CATALOG':
        return INQUIRY_TYPES.PRODUCT_CATALOG;
      case 'ORDER_STATUS_GUIDANCE':
        return INQUIRY_TYPES.ORDER_STATUS_GUIDANCE;
      case 'POLICY_WARRANTY':
        return INQUIRY_TYPES.POLICY_WARRANTY;
      default:
        return INQUIRY_TYPES.GENERAL_INQUIRY;
    }
  }

  /**
   * Process a customer chatbot message statelessly.
   *
   * @param {Object} params
   * @param {string} params.customerId - Authenticated customer ID
   * @param {string} params.message - Customer message string (max 500 chars)
   * @param {Array<{role: string, text: string}>} [params.history] - Active session history
   * @param {IChatbotAdapter} [params.adapter] - Provider adapter instance
   */
  static async processQuery({ customerId, message, history = [], adapter }) {
    if (!customerId) {
      throw new AppError('customerId is required for chatbot interaction.', 400);
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new AppError('Chatbot message cannot be empty or whitespace only.', 400);
    }

    const sanitizedMessage = message.trim();

    if (sanitizedMessage.length > CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH) {
      throw new AppError(
        `Message length exceeds maximum limit of ${CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH} characters.`,
        400
      );
    }

    const chatId = `chat_${crypto.randomUUID()}`;

    // 1. Enforce Clinical Boundary Defense
    if (this._isClinicalQuery(sanitizedMessage)) {
      const responseText =
        'Eye health inquiries, prescription details, and clinical interpretations must be evaluated in person by a qualified optometrist at Darshana Opticals.';
      const inquiryType = INQUIRY_TYPES.UNSUPPORTED_OTHER;
      const responseStatus = RESPONSE_STATUSES.UNSUPPORTED;

      await Chatbot.create({ chatId, customerId, inquiryType, responseStatus });
      return { chatId, inquiryType, responseStatus, responseText };
    }

    // 2. Enforce Payment Credential Boundary Defense
    if (this._isPaymentCredentialQuery(sanitizedMessage)) {
      const responseText =
        'Payment credentials and card details cannot be processed through the chatbot.';
      const inquiryType = INQUIRY_TYPES.UNSUPPORTED_OTHER;
      const responseStatus = RESPONSE_STATUSES.UNSUPPORTED;

      await Chatbot.create({ chatId, customerId, inquiryType, responseStatus });
      return { chatId, inquiryType, responseStatus, responseText };
    }

    // 3. Knowledge Retrieval
    const retrievedArticles = await KnowledgeRetrievalService.findRelevantKnowledge({
      query: sanitizedMessage,
      limit: 3,
    });

    // 4. Missing Knowledge Fallback Handling
    if (!retrievedArticles || retrievedArticles.length === 0) {
      const responseText = CHATBOT_DEFAULTS.UNSUPPORTED_FALLBACK_TEXT;
      const inquiryType = INQUIRY_TYPES.UNSUPPORTED_OTHER;
      const responseStatus = RESPONSE_STATUSES.UNSUPPORTED;

      await Chatbot.create({ chatId, customerId, inquiryType, responseStatus });
      return { chatId, inquiryType, responseStatus, responseText };
    }

    // 5. Construct Grounded Prompt & Context
    const groundedContextText = retrievedArticles
      .map(
        (art, idx) => `[Article ${idx + 1}] Title: ${art.contentTitle}\nContent: ${art.contentBody}`
      )
      .join('\n\n');

    const systemInstruction = this._buildSystemInstruction(groundedContextText);
    const primaryCategory = retrievedArticles[0]?.category;
    const inquiryType = this._mapCategoryToInquiryType(primaryCategory);

    // Bounded context window: keep max 6 messages from history
    const boundedHistory = Array.isArray(history)
      ? history.slice(-CHATBOT_DEFAULTS.MAX_CONTEXT_MESSAGES)
      : [];

    const activeAdapter =
      adapter ||
      (process.env.NODE_ENV === 'test' ? new MockChatbotAdapter() : new GeminiChatbotAdapter());

    // 6. Invoke Provider Adapter
    let responseStatus = RESPONSE_STATUSES.ANSWERED;
    let responseText = '';

    try {
      const providerResult = await activeAdapter.generateResponse({
        prompt: sanitizedMessage,
        systemInstruction,
        history: boundedHistory,
      });

      responseText = providerResult.text;
    } catch (err) {
      console.warn(
        `[ChatbotService] Provider API error (${err?.status || 'Unknown'}): ${err?.message || err}`
      );
      responseStatus = RESPONSE_STATUSES.FAILED;
      responseText = CHATBOT_DEFAULTS.FAILURE_FALLBACK_TEXT;
    }

    // 7. Persist Interaction Metadata in MongoDB
    await Chatbot.create({
      chatId,
      customerId,
      inquiryType,
      responseStatus,
    });

    return {
      chatId,
      inquiryType,
      responseStatus,
      responseText,
    };
  }
}

module.exports = ChatbotService;
