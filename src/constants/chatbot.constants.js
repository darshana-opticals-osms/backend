/**
 * Canonical Chatbot Constants (ADR-010 Section 9.4)
 */

const INQUIRY_TYPES = Object.freeze({
  STORE_INFO: 'STORE_INFO',
  SERVICES: 'SERVICES',
  PRODUCT_CATALOG: 'PRODUCT_CATALOG',
  ORDER_STATUS_GUIDANCE: 'ORDER_STATUS_GUIDANCE',
  POLICY_WARRANTY: 'POLICY_WARRANTY',
  GENERAL_INQUIRY: 'GENERAL_INQUIRY',
  UNSUPPORTED_OTHER: 'UNSUPPORTED_OTHER',
});

const INQUIRY_TYPE_VALUES = Object.freeze(Object.values(INQUIRY_TYPES));

const RESPONSE_STATUSES = Object.freeze({
  ANSWERED: 'ANSWERED',
  UNSUPPORTED: 'UNSUPPORTED',
  FAILED: 'FAILED',
  ESCALATED_CONTACT_PROVIDED: 'ESCALATED_CONTACT_PROVIDED',
});

const RESPONSE_STATUS_VALUES = Object.freeze(Object.values(RESPONSE_STATUSES));

const CHATBOT_DEFAULTS = Object.freeze({
  MAX_MESSAGE_LENGTH: 500,
  MAX_CONTEXT_MESSAGES: 6,
  TIMEOUT_MS: 6000,
  MAX_RETRIES: 1,
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
  RATE_LIMIT_MAX: 10, // 10 requests per minute per customer
  STORE_EMAIL: 'darshanaoptic@gmail.com',
  STORE_PHONE: '077 776 2494',
  UNSUPPORTED_FALLBACK_TEXT:
    "I'm sorry, I don't have information on that topic. Please visit our store or contact Darshana Opticals customer support at darshanaoptic@gmail.com or 077 776 2494 for assistance.",
  FAILURE_FALLBACK_TEXT:
    'Our AI assistant is temporarily unavailable. Please try again later or contact store support at darshanaoptic@gmail.com or 077 776 2494.',
});

module.exports = {
  INQUIRY_TYPES,
  INQUIRY_TYPE_VALUES,
  RESPONSE_STATUSES,
  RESPONSE_STATUS_VALUES,
  CHATBOT_DEFAULTS,
};
