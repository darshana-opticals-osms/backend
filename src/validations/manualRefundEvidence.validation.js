const { MANUAL_REFUND_CHANNELS } = require('../constants/manualRefund');
const { PAYMENT_CURRENCY } = require('../constants/payment');
const { ValidationError } = require('../errors/AppError');
const { formatAmount } = require('../services/adapters/PayHerePaymentAdapter');

function validReference(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  );
}

function validAmount(value) {
  try {
    formatAmount(value);
    return true;
  } catch {
    return false;
  }
}

// Internal evidence contract, not an HTTP request validator or external verification.
// Receipt formats and mandatory supporting documents are not defined by ADR-011.
function validateManualRefundEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new ValidationError('Manual refund evidence must be an object.');
  }
  const errors = [];
  const allowed = ['amount', 'currency', 'refundChannel', 'refundReference'];
  for (const field of Object.keys(evidence)) {
    if (!allowed.includes(field))
      errors.push({ field, message: 'Unsupported refund evidence field.' });
  }
  if (!validAmount(evidence.amount))
    errors.push({
      field: 'amount',
      message: 'Amount must follow the existing Payment monetary precision contract.',
    });
  if (evidence.currency !== PAYMENT_CURRENCY.LKR)
    errors.push({ field: 'currency', message: 'Refund evidence currency must be LKR.' });
  if (
    evidence.refundChannel !== undefined &&
    !MANUAL_REFUND_CHANNELS.includes(evidence.refundChannel)
  )
    errors.push({
      field: 'refundChannel',
      message: 'Only the execution channels permitted by ADR-011 are supported.',
    });
  if (evidence.refundReference !== undefined && !validReference(evidence.refundReference))
    errors.push({
      field: 'refundReference',
      message:
        'Reference must be a non-empty scalar string of at most 120 characters without control characters.',
    });
  if (errors.length) throw new ValidationError('Invalid manual refund evidence.', errors);
  return {
    amount: evidence.amount,
    currency: evidence.currency,
    refundChannel: evidence.refundChannel ?? null,
    refundReference: evidence.refundReference?.trim() ?? null,
  };
}

function assertFullRefundAmount(evidence, payment) {
  if (
    !validAmount(payment.amount) ||
    formatAmount(evidence.amount) !== formatAmount(payment.amount) ||
    evidence.currency !== payment.currency
  ) {
    throw new ValidationError(
      'Only evidence matching the full original Payment amount and currency is supported.',
      null,
      'REFUND_EVIDENCE_MISMATCH'
    );
  }
}

module.exports = {
  validateManualRefundEvidence,
  assertFullRefundAmount,
  validReference,
  validAmount,
};
