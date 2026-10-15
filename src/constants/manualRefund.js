// Execution channels permitted by ADR-011 §15; these are not Payment providers/statuses.
const MANUAL_REFUND_CHANNELS = Object.freeze(['payhere_portal', 'bank_transfer']);

module.exports = { MANUAL_REFUND_CHANNELS };
