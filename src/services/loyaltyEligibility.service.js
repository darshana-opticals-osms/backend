const OrderItem = require('../models/orderItem.model');
const { ConflictError } = require('../errors/AppError');

async function assertEarningContract() {
  throw new ConflictError(
    'ADR-005 section 14 and ADR-011 section 13 conflict on the earning trigger.',
    null,
    'LOYALTY_EARNING_TRIGGER_UNRESOLVED'
  );
}

// Only checkout-time context is considered, never today's mutable Inventory category.
// A snapshotted free-text category still is NOT clinical/merchandise eligibility proof.
async function deriveEligibleSpendForOrder(orderId, session = null) {
  const items = await OrderItem.find({ orderId })
    .select('classificationSnapshot')
    .session(session)
    .lean();
  const unresolved =
    !items.length ||
    items.some(
      (item) =>
        !item.classificationSnapshot || item.classificationSnapshot.loyaltyEligibility === 'UNKNOWN'
    );
  throw new ConflictError(
    unresolved
      ? 'OrderItem classification context is missing or UNKNOWN; eligibility remains unresolved.'
      : 'OrderItem classification is unsupported; no approved eligibility mapping exists.',
    null,
    'LOYALTY_ITEM_CLASSIFICATION_REQUIRED'
  );
}

module.exports = { assertEarningContract, deriveEligibleSpendForOrder };
