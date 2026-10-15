const loyalty = require('./loyalty.service');

// Internal full-refund integration only; no financial endpoint is activated.
// Re-read authoritative records; the caller's DTOs are identifiers, never ledger proof.
async function applyFullRefundReversal({ payment, refundEvidence, session } = {}) {
  return loyalty.reverseFullRefundPoints({
    paymentId: payment?._id?.toString(),
    refundEvidenceId: refundEvidence?.evidenceId,
    session,
  });
}

// True only for persisted matching earning + compensating reversal and consistent balance.
async function verifyFullRefundReversal({ payment, refundEvidence, session } = {}) {
  return loyalty.verifyFullRefundPoints({
    paymentId: payment?._id?.toString(),
    refundEvidenceId: refundEvidence?.evidenceId,
    session,
  });
}

module.exports = { applyFullRefundReversal, verifyFullRefundReversal };
