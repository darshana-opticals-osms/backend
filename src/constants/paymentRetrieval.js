// Provider observations, not additional OSMS Payment statuses or IPN status codes.
const RETRIEVAL_STATUSES = Object.freeze([
  'RECEIVED',
  'REFUND REQUESTED',
  'REFUND PROCESSING',
  'REFUNDED',
  'CHARGEBACKED',
]);
const RETRIEVAL_OUTCOMES = Object.freeze(['records', 'pending', 'not_found', 'declined_or_error']);
const RETRIEVAL_REASONS = Object.freeze([
  'RETRIEVAL_CONTEXT_MISMATCH',
  'RETRIEVAL_MULTIPLE_PROVIDER_PAYMENTS',
  'RETRIEVAL_LATE_SUCCESS',
  'RETRIEVAL_SUCCESS_REQUIRES_IPN',
  'RETRIEVAL_REFUND_REVIEW',
  'RETRIEVAL_CHARGEBACK_REVIEW',
]);
module.exports = { RETRIEVAL_STATUSES, RETRIEVAL_OUTCOMES, RETRIEVAL_REASONS };
