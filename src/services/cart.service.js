const mongoose = require('mongoose');
const Cart = require('../models/cart.model');
const Customer = require('../models/customer.model');
const Inventory = require('../models/inventory.model');
const { ConflictError, NotFoundError, ValidationError } = require('../errors/AppError');

const INVALID_INVENTORY_REFERENCE = 'INVALID_INVENTORY_REFERENCE';
const INVALID_CART_QUANTITY = 'INVALID_CART_QUANTITY';
const CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';
const INVENTORY_NOT_FOUND = 'INVENTORY_NOT_FOUND';
const CART_ITEM_NOT_FOUND = 'CART_ITEM_NOT_FOUND';
const CART_QUANTITY_OVERFLOW = 'CART_QUANTITY_OVERFLOW';
const MAX_ADD_ATTEMPTS = 3;

function validateInventoryId(inventoryId) {
  if (!mongoose.isValidObjectId(inventoryId)) {
    throw new ValidationError(
      'Inventory reference is invalid.',
      { field: 'inventoryId' },
      INVALID_INVENTORY_REFERENCE
    );
  }
}

function validateQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError(
      'quantity must be a positive integer.',
      { field: 'quantity' },
      INVALID_CART_QUANTITY
    );
  }
}

async function assertCustomerExists(customerId) {
  const customerExists = await Customer.exists({ _id: customerId });

  if (!customerExists) {
    throw new NotFoundError('Customer not found.', null, CUSTOMER_NOT_FOUND);
  }
}

function toCartResponse(cart) {
  return {
    items: (cart?.items || []).map((item) => ({
      inventoryId: item.inventoryId.toString(),
      quantity: item.quantity,
    })),
  };
}

function buildAddItemPipeline(inventoryObjectId, quantity) {
  const currentItems = { $ifNull: ['$items', []] };
  const containsInventory = {
    $in: [
      inventoryObjectId,
      {
        $map: {
          input: currentItems,
          as: 'item',
          in: '$$item.inventoryId',
        },
      },
    ],
  };
  const updatedItems = {
    $map: {
      input: currentItems,
      as: 'item',
      in: {
        $cond: [
          { $eq: ['$$item.inventoryId', inventoryObjectId] },
          {
            $mergeObjects: ['$$item', { quantity: { $add: ['$$item.quantity', quantity] } }],
          },
          '$$item',
        ],
      },
    },
  };
  const now = new Date();

  return [
    {
      $set: {
        items: {
          $cond: [
            containsInventory,
            updatedItems,
            {
              $concatArrays: [currentItems, [{ inventoryId: inventoryObjectId, quantity }]],
            },
          ],
        },
        createdAt: { $ifNull: ['$createdAt', now] },
        updatedAt: now,
      },
    },
  ];
}

function buildAddItemFilter(customerId, inventoryObjectId, quantity) {
  const matchingQuantities = {
    $map: {
      input: {
        $filter: {
          input: { $ifNull: ['$items', []] },
          as: 'item',
          cond: { $eq: ['$$item.inventoryId', inventoryObjectId] },
        },
      },
      as: 'item',
      in: '$$item.quantity',
    },
  };

  return {
    customerId,
    $expr: {
      $let: {
        vars: { matchingQuantities },
        in: {
          $or: [
            { $eq: [{ $size: '$$matchingQuantities' }, 0] },
            {
              $lte: [
                { $add: [{ $arrayElemAt: ['$$matchingQuantities', 0] }, quantity] },
                Number.MAX_SAFE_INTEGER,
              ],
            },
          ],
        },
      },
    },
  };
}

async function findCustomerCart(customerId) {
  return Cart.findOne({ customerId }).select('items').lean();
}

function throwQuantityOverflow() {
  throw new ValidationError(
    'Adding this quantity would exceed the maximum safe integer.',
    { field: 'quantity' },
    CART_QUANTITY_OVERFLOW
  );
}

async function addCartItem(customerId, inventoryId, quantity) {
  validateInventoryId(inventoryId);
  validateQuantity(quantity);
  await assertCustomerExists(customerId);

  const inventoryExists = await Inventory.exists({ _id: inventoryId });
  if (!inventoryExists) {
    throw new NotFoundError('Inventory item not found.', null, INVENTORY_NOT_FOUND);
  }

  const inventoryObjectId = new mongoose.Types.ObjectId(inventoryId);
  const pipeline = buildAddItemPipeline(inventoryObjectId, quantity);
  const filter = buildAddItemFilter(customerId, inventoryObjectId, quantity);

  for (let attempt = 0; attempt < MAX_ADD_ATTEMPTS; attempt += 1) {
    const cart = await Cart.findOneAndUpdate(filter, pipeline, {
      new: true,
      timestamps: false,
    });
    if (cart) return toCartResponse(cart);

    const currentCart = await findCustomerCart(customerId);
    if (currentCart) {
      const currentItem = currentCart.items.find(
        (item) => item.inventoryId.toString() === inventoryObjectId.toString()
      );

      if (currentItem && currentItem.quantity > Number.MAX_SAFE_INTEGER - quantity) {
        throwQuantityOverflow();
      }

      continue;
    }

    try {
      const createdCart = await Cart.create({
        customerId,
        items: [{ inventoryId: inventoryObjectId, quantity }],
      });
      if (createdCart) return toCartResponse(createdCart);
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }

  throw new ConflictError('Cart changed concurrently. Please retry.');
}

async function getCustomerCart(customerId) {
  await assertCustomerExists(customerId);
  const cart = await Cart.findOne({ customerId }).select('items').lean();
  return toCartResponse(cart);
}

async function updateCartItemQuantity(customerId, inventoryId, quantity) {
  validateInventoryId(inventoryId);
  validateQuantity(quantity);
  await assertCustomerExists(customerId);

  const inventoryObjectId = new mongoose.Types.ObjectId(inventoryId);
  const cart = await Cart.findOneAndUpdate(
    { customerId, 'items.inventoryId': inventoryObjectId },
    [
      {
        $set: {
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $cond: [
                  { $eq: ['$$item.inventoryId', inventoryObjectId] },
                  { $mergeObjects: ['$$item', { quantity }] },
                  '$$item',
                ],
              },
            },
          },
          updatedAt: new Date(),
        },
      },
    ],
    { new: true, timestamps: false }
  );

  if (!cart) {
    throw new NotFoundError('Cart item not found.', null, CART_ITEM_NOT_FOUND);
  }

  return toCartResponse(cart);
}

async function removeCartItem(customerId, inventoryId) {
  validateInventoryId(inventoryId);
  await assertCustomerExists(customerId);

  const inventoryObjectId = new mongoose.Types.ObjectId(inventoryId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const deletedCart = await Cart.findOneAndDelete({
      customerId,
      items: { $size: 1 },
      'items.inventoryId': inventoryObjectId,
    });

    if (deletedCart) return { items: [] };

    const cart = await Cart.findOneAndUpdate(
      {
        customerId,
        'items.inventoryId': inventoryObjectId,
        $expr: { $gt: [{ $size: '$items' }, 1] },
      },
      { $pull: { items: { inventoryId: inventoryObjectId } }, $currentDate: { updatedAt: true } },
      { new: true, timestamps: false }
    );

    if (cart) return toCartResponse(cart);

    const currentCart = await Cart.findOne({ customerId }).select('items').lean();
    if (
      !currentCart?.items?.some(
        (item) => item.inventoryId.toString() === inventoryObjectId.toString()
      )
    ) {
      throw new NotFoundError('Cart item not found.', null, CART_ITEM_NOT_FOUND);
    }
  }

  throw new ConflictError('Cart changed repeatedly while removing the item. Please retry.');
}

module.exports = {
  addCartItem,
  getCustomerCart,
  updateCartItemQuantity,
  removeCartItem,
  toCartResponse,
};
