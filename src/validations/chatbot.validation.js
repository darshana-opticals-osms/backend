const { validate } = require('../middleware/validate');
const { CHATBOT_DEFAULTS } = require('../constants/chatbot.constants');

const ALLOWED_ROLES = ['user', 'assistant', 'model'];

/**
 * Validation schema function for Chatbot Query API (POST /api/v1/chatbot/query)
 */
const chatbotQuerySchema = (req) => {
  const errors = [];
  const body = req.body || {};

  // Reject unsupported top-level fields
  const allowedKeys = ['message', 'history'];
  const bodyKeys = Object.keys(body);
  const unknownKeys = bodyKeys.filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    errors.push({
      field: unknownKeys.join(', '),
      message: `Unsupported field(s) provided: ${unknownKeys.join(', ')}`,
    });
  }

  // Validate message
  if (body.message === undefined || body.message === null || body.message === '') {
    errors.push({ field: 'message', message: 'message is required' });
  } else if (typeof body.message !== 'string') {
    errors.push({ field: 'message', message: 'message must be of type string' });
  } else if (!body.message.trim()) {
    errors.push({ field: 'message', message: 'message cannot be empty or whitespace only' });
  } else if (body.message.length > CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH) {
    errors.push({
      field: 'message',
      message: `message must not exceed ${CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH} characters`,
    });
  }

  // Validate optional history array
  if (body.history !== undefined && body.history !== null) {
    if (!Array.isArray(body.history)) {
      errors.push({ field: 'history', message: 'history must be an array' });
    } else if (body.history.length > CHATBOT_DEFAULTS.MAX_CONTEXT_MESSAGES) {
      errors.push({
        field: 'history',
        message: `history cannot exceed ${CHATBOT_DEFAULTS.MAX_CONTEXT_MESSAGES} messages`,
      });
    } else {
      body.history.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push({ field: `history[${index}]`, message: 'history item must be an object' });
          return;
        }

        const itemKeys = Object.keys(item);
        const allowedItemKeys = ['role', 'text'];
        const unknownItemKeys = itemKeys.filter((k) => !allowedItemKeys.includes(k));
        if (unknownItemKeys.length > 0) {
          errors.push({
            field: `history[${index}]`,
            message: `Unsupported field(s) in history item: ${unknownItemKeys.join(', ')}`,
          });
        }

        if (
          !item.role ||
          typeof item.role !== 'string' ||
          !ALLOWED_ROLES.includes(item.role.toLowerCase())
        ) {
          errors.push({
            field: `history[${index}].role`,
            message: `history item role must be one of: ${ALLOWED_ROLES.join(', ')}`,
          });
        }

        if (item.text === undefined || item.text === null) {
          errors.push({
            field: `history[${index}].text`,
            message: 'history item text is required',
          });
        } else if (typeof item.text !== 'string') {
          errors.push({
            field: `history[${index}].text`,
            message: 'history item text must be of type string',
          });
        } else if (item.text.length > CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH) {
          errors.push({
            field: `history[${index}].text`,
            message: `history item text must not exceed ${CHATBOT_DEFAULTS.MAX_MESSAGE_LENGTH} characters`,
          });
        }
      });
    }
  }

  return errors;
};

const validateChatbotQuery = validate(chatbotQuerySchema);

module.exports = {
  validateChatbotQuery,
};
