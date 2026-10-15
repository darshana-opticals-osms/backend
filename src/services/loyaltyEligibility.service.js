const OrderItem = require('../models/orderItem.model');
const Inventory = require('../models/inventory.model');
const { ConflictError } = require('../errors/AppError');

async function assertEarningContract() {
  throw new ConflictError(
    'ADR-005 section 14 and ADR-011 section 13 conflict on the earning trigger.',
    null,
    'LOYALTY_EARNING_TRIGGER_UNRESOLVED'
  );
}

// Reads backend records only. A display name/category is NOT clinical eligibility proof.
// No Product entity exists: the catalog is backed by mutable Inventory records.
async function deriveEligibleSpendForOrder(orderId, session = null) {
  const items = await OrderItem.find({ orderId }).session(session).lean();
  if (items.length && items.every((item) => item.inventoryId)) {
    await Inventory.find({ _id: { $in: items.map((item) => item.inventoryId) } })
      .select('_id category')
      .session(session)
      .lean();
  }
  throw new ConflictError(
    'OrderItems lack authoritative merchandise/clinical eligibility classification; totals and names are not substitutes.',
    null,
    'LOYALTY_ITEM_CLASSIFICATION_REQUIRED'
  );
}

module.exports = { assertEarningContract, deriveEligibleSpendForOrder };
