const mongoose = require('mongoose');
const Cart = require('../../src/models/cart.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const {
  checkoutCustomer,
  validateCartItems,
  toCents,
  buildOrderItems,
  decrementInventoryStock,
} = require('../../src/services/checkout.service');

jest.mock('../../src/services/reorderAlert.service', () => ({
  evaluateReorderAlert: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/models/cart.model', () => ({
  findOne: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock('../../src/models/customer.model', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/inventory.model', () => ({
  find: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
}));
jest.mock('../../src/models/order.model', () => ({ create: jest.fn() }));
jest.mock('../../src/models/orderItem.model', () => ({ insertMany: jest.fn() }));

const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const INVENTORY_ID = '507f1f77bcf86cd799439012';
const ORDER_ID = '507f1f77bcf86cd799439013';
const ITEM_ID = '507f1f77bcf86cd799439014';

const makeQuery = (result) => ({
  select: jest.fn().mockReturnThis(),
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
  exec: jest.fn().mockResolvedValue(result),
});

describe('checkout service', () => {
  let session;

  beforeEach(() => {
    jest.clearAllMocks();
    session = {
      withTransaction: jest.fn(async (operation) => operation()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);

    Customer.findById.mockReturnValue(makeQuery({ _id: new mongoose.Types.ObjectId(CUSTOMER_ID) }));
    Cart.findOne.mockReturnValue(
      makeQuery({
        _id: new mongoose.Types.ObjectId(ITEM_ID),
        items: [{ inventoryId: new mongoose.Types.ObjectId(INVENTORY_ID), quantity: 2 }],
      })
    );
    Inventory.find.mockReturnValue(
      makeQuery([
        {
          _id: new mongoose.Types.ObjectId(INVENTORY_ID),
          itemName: 'Optical Frame',
          price: 12.25,
          quantity: 5,
        },
      ])
    );
    Order.create.mockImplementation(async ([payload]) => [
      { ...payload, _id: new mongoose.Types.ObjectId(ORDER_ID) },
    ]);
    OrderItem.insertMany.mockImplementation(async (items) =>
      items.map((item) => ({ ...item, _id: new mongoose.Types.ObjectId(ITEM_ID) }))
    );
    Inventory.findOneAndUpdate.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(INVENTORY_ID),
      quantity: 3,
    });
    Inventory.findById.mockReturnValue({
      session: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        quantity: 3,
      }),
    });
    Cart.deleteOne.mockReturnValue({
      session: jest.fn().mockReturnValue({ deletedCount: 1 }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create an authoritative Order and deduct stock in one transaction', async () => {
    const result = await checkoutCustomer(CUSTOMER_ID);

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(Order.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          customerId: expect.any(mongoose.Types.ObjectId),
          orderAmount: 24.5,
          status: 'ORDER_CREATED',
          statusHistory: [expect.objectContaining({ status: 'ORDER_CREATED' })],
        }),
      ],
      { session }
    );
    expect(OrderItem.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ itemName: 'Optical Frame', price: 12.25, quantity: 2 })],
      { session, ordered: true }
    );
    expect(Inventory.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new mongoose.Types.ObjectId(INVENTORY_ID), quantity: { $gte: 2 } },
      { $inc: { quantity: -2 } },
      { new: true, session }
    );
    expect(result.order.orderAmount).toBe(24.5);
    expect(result.items[0]).toMatchObject({ itemName: 'Optical Frame', price: 12.25, quantity: 2 });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('should reject an absent Customer before loading Cart data', async () => {
    Customer.findById.mockReturnValue(makeQuery(null));

    await expect(checkoutCustomer(CUSTOMER_ID)).rejects.toMatchObject({
      errorCode: 'CUSTOMER_NOT_FOUND',
    });
    expect(Cart.findOne).not.toHaveBeenCalled();
  });

  it('should reject empty, malformed, duplicate, and non-positive Cart lines', () => {
    expect(() => validateCartItems([])).toThrow('Cart is empty.');
    expect(() => validateCartItems([{ inventoryId: 'bad-id', quantity: 1 }])).toThrow(
      'Persisted Cart contains an invalid item.'
    );
    expect(() =>
      validateCartItems([
        { inventoryId: INVENTORY_ID, quantity: 1 },
        { inventoryId: INVENTORY_ID, quantity: 1 },
      ])
    ).toThrow('Persisted Cart contains duplicate Inventory items.');
    expect(() => validateCartItems([{ inventoryId: INVENTORY_ID, quantity: 0 }])).toThrow(
      'Persisted Cart contains an invalid item.'
    );
  });

  it('should calculate money in safe cents and reject invalid precision or unsafe totals', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(() => toCents(1.005)).toThrow(
      'Inventory price must use no more than two decimal places.'
    );
    expect(() => toCents(Number.MAX_SAFE_INTEGER)).toThrow(
      'Inventory price must use no more than two decimal places.'
    );
  });

  it('should reject missing Inventory, insufficient stock, and invalid price data', () => {
    const cartItems = [{ inventoryId: new mongoose.Types.ObjectId(INVENTORY_ID), quantity: 2 }];
    expect(() => buildOrderItems(cartItems, new Map())).toThrow('Inventory item not found.');
    expect(() =>
      buildOrderItems(
        cartItems,
        new Map([[INVENTORY_ID, { quantity: 1, price: 12, itemName: 'Frame' }]])
      )
    ).toThrow('Insufficient Inventory stock.');
    expect(() =>
      buildOrderItems(
        cartItems,
        new Map([[INVENTORY_ID, { quantity: 5, price: -1, itemName: 'Frame' }]])
      )
    ).toThrow('Inventory price is invalid.');
  });

  it('should abort when conditional stock deduction no longer matches', async () => {
    Inventory.findOneAndUpdate.mockResolvedValue(null);
    Inventory.findById.mockReturnValue({
      session: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        quantity: 1,
      }),
    });

    await expect(
      decrementInventoryStock(
        [{ inventoryId: new mongoose.Types.ObjectId(INVENTORY_ID), quantity: 2 }],
        session
      )
    ).rejects.toMatchObject({ errorCode: 'INSUFFICIENT_STOCK' });
  });
});
