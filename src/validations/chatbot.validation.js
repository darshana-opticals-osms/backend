const { validate } = require('../middleware/validate');
const { CHATBOT_DEFAULTS } = require('../constants/chatbot.constants');

/**
 * Validation schema for Chatbot Query API (POST /api/v1/chatbot/query)
 */
const chatbotQuerySchema = {
  body: {
    message: {
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH,
      custom: (val) => {
        if (!val || typeof val !== 'string' || !val.trim()) {
          return 'message cannot be empty or whitespace only';
        }
        return true;
      },
    },
  },
};

const validateChatbotQuery = validate(chatbotQuerySchema);

module.exports = {
  validateChatbotQuery,
};
