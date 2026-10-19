const mongoose = require('mongoose');
const Cart = require('../models/cart.model');
const Customer = require('../models/customer.model');
const Inventory = require('../models/inventory.model');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const { ORDER_STATUS_VALUES } = require('../constants/orderStatuses');
const { ConflictError, NotFoundError, ValidationError } = require('../errors/AppError');
const { deductInventoryStock } = require('./inventory.service');
const { ITEM_CLASSIFICATIONS, LOYALTY_ELIGIBILITY } = require('../constants/itemClassification');
const { getOnlineFulfillmentBranch } = require('./fulfillmentBranch.service');

const CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';
const CART_NOT_FOUND = 'CART_NOT_FOUND';
const INVALID_CART = 'INVALID_CHECKOUT_CART';
const INVENTORY_NOT_FOUND = 'INVENTORY_NOT_FOUND';
const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK';
const INVALID_INVENTORY_PRICE = 'INVALID_INVENTORY_PRICE';
const INVALID_INVENTORY_STOCK = 'INVALID_INVENTORY_STOCK';
const CHECKOUT_CONFLICT = 'CHECKOUT_CONFLICT';
const FULFILLMENT_BRANCH_UNAVAILABLE = 'FULFILLMENT_BRANCH_UNAVAILABLE';
const CROSS_BRANCH_CHECKOUT_CONFLICT = 'CROSS_BRANCH_CHECKOUT_CONFLICT';
const RESERVATION_WINDOW_MS = 30 * 60 * 1000;

function validateCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ConflictError('Cart is empty.', null, CART_NOT_FOUND);
  }

  const seenInventoryIds = new Set();

  for (const item of items) {
    if (
      !item ||
      !mongoose.isValidObjectId(item.inventoryId) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1
    ) {
      throw new ValidationError('Persisted Cart contains an invalid item.', null, INVALID_CART);
    }

    const inventoryId = item.inventoryId.toString();
    if (seenInventoryIds.has(inventoryId)) {
      throw new ValidationError(
        'Persisted Cart contains duplicate Inventory items.',
        null,
        INVALID_CART
      );
    }
    seenInventoryIds.add(inventoryId);
  }
}

function toCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError('Inventory price is invalid.', null, INVALID_INVENTORY_PRICE);
  }

  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-7) {
    throw new ValidationError(
      'Inventory price must use no more than two decimal places.',
      null,
      INVALID_INVENTORY_PRICE
    );
  }

  return cents;
}

function buildOrderItems(cartItems, inventoryById) {
  let orderTotalCents = 0;

  const orderItems = cartItems.map((cartItem) => {
    const inventory = inventoryById.get(cartItem.inventoryId.toString());

    if (!inventory) {
      throw new NotFoundError('Inventory item not found.', null, INVENTORY_NOT_FOUND);
    }

    if (!Number.isSafeInteger(inventory.quantity) || inventory.quantity < 0) {
      throw new ValidationError('Inventory stock is invalid.', null, INVALID_INVENTORY_STOCK);
    }

    if (inventory.quantity < cartItem.quantity) {
      throw new ConflictError('Insufficient Inventory stock.', null, INSUFFICIENT_STOCK);
    }

    const unitPriceCents = toCents(inventory.price);
    const lineTotalCents = unitPriceCents * cartItem.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) {
      throw new ValidationError('Order amount exceeds the supported monetary range.');
    }

    orderTotalCents += lineTotalCents;
    if (!Number.isSafeInteger(orderTotalCents)) {
      throw new ValidationError('Order amount exceeds the supported monetary range.');
    }

    const itemClassification = ITEM_CLASSIFICATIONS.includes(inventory.itemClassification)
      ? inventory.itemClassification
      : 'UNKNOWN';
    return {
      inventoryId: inventory._id,
      classificationSnapshot: {
        source: 'Inventory',
        sourceInventoryId: inventory._id,
        category: typeof inventory.category === 'string' ? inventory.category : null,
        itemClassification,
        loyaltyEligibility: LOYALTY_ELIGIBILITY[itemClassification],
      },
      itemName: inventory.itemName,
      price: unitPriceCents / 100,
      quantity: cartItem.quantity,
    };
  });

  return { orderItems, orderAmount: orderTotalCents / 100 };
}

function toCheckoutResponse(order, orderItems) {
  return {
    order: {
      id: order._id.toString(),
      customerId: order.customerId.toString(),
      orderDate: order.orderDate,
      orderAmount: order.orderAmount,
      status: order.status,
      statusUpdatedAt: order.statusUpdatedAt,
      statusHistory: order.statusHistory.map((entry) => ({
        status: entry.status,
        changedAt: entry.changedAt,
        changedBy: entry.changedBy.toString(),
      })),
    },
    items: orderItems.map((item) => ({
      id: item._id.toString(),
      itemName: item.itemName,
      price: item.price,
      quantity: item.quantity,
    })),
  };
}

async function decrementInventoryStock(items, session = null, auditContext = null) {
  return deductInventoryStock(items, session, auditContext);
}

async function checkoutCustomer(customerId) {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new ValidationError('Customer identity is invalid.');
  }

  const session = await mongoose.startSession();
  let checkoutResult;

  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findById(customerId).select('_id').session(session).lean();

      if (!customer) {
        throw new NotFoundError('Customer not found.', null, CUSTOMER_NOT_FOUND);
      }

      const cart = await Cart.findOne({ customerId }).session(session).lean();
      if (!cart) {
        throw new ConflictError('Cart is empty.', null, CART_NOT_FOUND);
      }

      validateCartItems(cart.items);

      const fulfillmentBranch = await getOnlineFulfillmentBranch(session);
      if (!fulfillmentBranch) {
        throw new ConflictError(
          'Online fulfillment branch is currently unavailable.',
          null,
          FULFILLMENT_BRANCH_UNAVAILABLE
        );
      }

      const inventoryIds = cart.items.map((item) => new mongoose.Types.ObjectId(item.inventoryId));
      const inventories = await Inventory.find({ _id: { $in: inventoryIds } })
        .session(session)
        .lean();

      const hasCrossBranch = inventories.some(
        (inv) => !inv.branchId || !inv.branchId.equals(fulfillmentBranch._id)
      );
      if (hasCrossBranch) {
        throw new ConflictError(
          'Cart contains items that do not belong to the online fulfillment branch.',
          null,
          CROSS_BRANCH_CHECKOUT_CONFLICT
        );
      }

      const inventoryById = new Map(inventories.map((item) => [item._id.toString(), item]));
      const { orderItems, orderAmount } = buildOrderItems(cart.items, inventoryById);
      const now = new Date();
      const reservationExpiresAt = new Date(now.getTime() + RESERVATION_WINDOW_MS);
      const status = ORDER_STATUS_VALUES.ORDER_CREATED;

      const [order] = await Order.create(
        [
          {
            customerId: customer._id,
            branchId: fulfillmentBranch._id,
            orderDate: now,
            orderAmount,
            status,
            statusUpdatedAt: now,
            statusHistory: [{ status, changedAt: now, changedBy: customer._id }],
            reservationExpiresAt,
          },
        ],
        { session }
      );

      const createdOrderItems = await OrderItem.insertMany(
        orderItems.map((item) => ({ ...item, orderId: order._id })),
        { session, ordered: true }
      );

      await deductInventoryStock(cart.items, session, {
        system: true,
        orderId: order._id.toString(),
      });

      const deletion = await Cart.deleteOne({ _id: cart._id, customerId }).session(session);
      if (deletion.deletedCount !== 1) {
        throw new ConflictError(
          'Cart changed during checkout. Please retry.',
          null,
          CHECKOUT_CONFLICT
        );
      }

      checkoutResult = toCheckoutResponse(order, createdOrderItems);
    });

    return checkoutResult;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  checkoutCustomer,
  validateCartItems,
  toCents,
  buildOrderItems,
  decrementInventoryStock,
  RESERVATION_WINDOW_MS,
  FULFILLMENT_BRANCH_UNAVAILABLE,
  CROSS_BRANCH_CHECKOUT_CONFLICT,
};
