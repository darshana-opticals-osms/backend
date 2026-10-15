const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const { ConflictError } = require('../errors/AppError');
const { LOYALTY_ELIGIBILITY } = require('../constants/itemClassification');
const { formatAmount } = require('./adapters/PayHerePaymentAdapter');
const { toMinor, fromMinor } = require('../utils/loyaltyDecimal');

async function assertEarningContract(order) {
  // ADR-005 section 14; ADR-011 section 13's earlier trigger is not used.
  if (order.status !== 'COMPLETED')
    throw new ConflictError(
      'Order must be COMPLETED before earning points.',
      null,
      'LOYALTY_ORDER_NOT_COMPLETED'
    );
}

// Only immutable checkout context is considered, never today's Inventory/category.
async function deriveEligibleSpendForOrder(orderId, session = null) {
  const order = await Order.findById(orderId).session(session).lean();
  const items = await OrderItem.find({ orderId }).session(session).lean();
  let eligible = 0n;
  let total = 0n;
  if (!order || !items.length)
    throw new ConflictError(
      'Authoritative Order items are required.',
      null,
      'LOYALTY_ITEM_CLASSIFICATION_REQUIRED'
    );
  for (const item of items) {
    const snapshot = item.classificationSnapshot;
    if (
      !snapshot ||
      snapshot.source !== 'Inventory' ||
      !snapshot.sourceInventoryId ||
      !item.inventoryId ||
      !snapshot.sourceInventoryId.equals(item.inventoryId) ||
      !['MERCHANDISE', 'CLINICAL'].includes(snapshot.itemClassification) ||
      snapshot.loyaltyEligibility !== LOYALTY_ELIGIBILITY[snapshot.itemClassification]
    )
      throw new ConflictError(
        'Order item classification is missing, UNKNOWN or unsupported.',
        null,
        'LOYALTY_ITEM_CLASSIFICATION_REQUIRED'
      );
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
      throw new ConflictError('Invalid stored item quantity.', null, 'LOYALTY_SOURCE_CONFLICT');
    const line = toMinor(formatAmount(item.price)) * BigInt(item.quantity);
    total += line;
    if (snapshot.itemClassification === 'MERCHANDISE') eligible += line;
  }
  if (total !== toMinor(formatAmount(order.orderAmount)))
    throw new ConflictError(
      'Item amounts do not match the authoritative Order total.',
      null,
      'LOYALTY_SOURCE_CONFLICT'
    );
  return fromMinor(eligible);
}

module.exports = { assertEarningContract, deriveEligibleSpendForOrder };
