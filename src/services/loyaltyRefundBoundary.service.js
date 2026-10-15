const { ConflictError } = require('../errors/AppError');

// Activation hold, not a loyalty implementation or a configurable no-op.
// ADR-011 section 15 requires reversal; ADR-005 requires auditable balance/history writes.
// Replace only with the implemented, idempotent, session-bound loyalty contract.
async function applyFullRefundReversal() {
  throw new ConflictError(
    'Manual refund recording is inactive until transactional loyalty reversal is available.',
    null,
    'REFUND_LOYALTY_REVERSAL_UNAVAILABLE'
  );
}

// Future contract: return exactly true only after reading authoritative, durable
// reversal completion for this Payment/refund evidence in the supplied session.
// Refund evidence or Payment.status alone is never proof of loyalty completion.
async function verifyFullRefundReversal() {
  throw new ConflictError(
    'Refund replay is inactive until durable loyalty reversal verification is available.',
    null,
    'REFUND_LOYALTY_REVERSAL_UNAVAILABLE'
  );
}

module.exports = { applyFullRefundReversal, verifyFullRefundReversal };
