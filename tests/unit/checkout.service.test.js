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
  CHECKOUT_ITEM_CLASSIFICATION_INVALID,
} = require('../../src/services/checkout.service');

const FULFILLMENT_BRANCH_ID = new mongoose.Types.ObjectId();
jest.mock('../../src/services/fulfillmentBranch.service', () => ({
  getOnlineFulfillmentBranch: jest.fn(),
}));
const { getOnlineFulfillmentBranch } = require('../../src/services/fulfillmentBranch.service');

jest.mock('../../src/services/reorderAlert.service', () => ({
  evaluateReorderAlert: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/services/audit.service', () => ({
  record: jest.fn().mockResolvedValue({ _id: 'mock-audit-id' }),
  buildSystemActor: jest.fn().mockReturnValue({
    actorType: 'SYSTEM',
    actorId: 'OSMS_BACKEND',
    actorRole: 'OSMS_BACKEND',
  }),
  buildUserActor: jest.fn().mockReturnValue({
    actorType: 'USER',
    actorId: '507f1f77bcf86cd799439011',
    actorRole: 'CUSTOMER',
  }),
  AUDIT_ACTION: {
    INVENTORY_CHECKOUT_STOCK_DEDUCTED: 'INVENTORY_CHECKOUT_STOCK_DEDUCTED',
  },
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
    getOnlineFulfillmentBranch.mockResolvedValue({ _id: FULFILLMENT_BRANCH_ID });
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
          branchId: FULFILLMENT_BRANCH_ID,
          itemName: 'Optical Frame',
          category: 'Frames',
          price: 12.25,
          quantity: 5,
          itemClassification: 'MERCHANDISE',
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
          branchId: FULFILLMENT_BRANCH_ID,
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
  it('snapshots only server Inventory facts and ignores classification/eligibility claims in Cart or Inventory extras', () => {
    const inventory = {
      _id: new mongoose.Types.ObjectId(INVENTORY_ID),
      itemName: 'Frame',
      category: 'Unmapped category',
      itemClassification: 'MERCHANDISE',
      price: 12.25,
      quantity: 5,
      loyaltyEligibility: 'FORGED_CLAIM',
      classificationSnapshot: { category: 'FORGED', loyaltyEligibility: 'ELIGIBLE' },
    };
    const result = buildOrderItems(
      [
        {
          inventoryId: inventory._id,
          quantity: 2,
          category: 'Clinical',
          classificationSnapshot: {
            source: 'CLIENT',
            sourceInventoryId: ITEM_ID,
            category: 'FORGED',
            loyaltyEligibility: 'ELIGIBLE',
          },
        },
      ],
      new Map([[INVENTORY_ID, inventory]])
    );
    expect(result.orderAmount).toBe(24.5);
    expect(result.orderItems[0]).toMatchObject({
      inventoryId: inventory._id,
      itemName: 'Frame',
      price: 12.25,
      quantity: 2,
      classificationSnapshot: {
        source: 'Inventory',
        sourceInventoryId: inventory._id,
        category: 'Unmapped category',
        itemClassification: 'MERCHANDISE',
        loyaltyEligibility: 'ELIGIBLE',
      },
    });
  });
  it('records unavailable Inventory category as null while capturing valid classification and eligibility', () => {
    const inventory = {
      _id: new mongoose.Types.ObjectId(INVENTORY_ID),
      itemName: 'Legacy Frame',
      itemClassification: 'MERCHANDISE',
      price: 10,
      quantity: 5,
    };
    const result = buildOrderItems(
      [{ inventoryId: inventory._id, quantity: 1 }],
      new Map([[INVENTORY_ID, inventory]])
    );
    expect(result.orderAmount).toBe(10);
    expect(result.orderItems[0].classificationSnapshot).toMatchObject({
      category: null,
      itemClassification: 'MERCHANDISE',
      loyaltyEligibility: 'ELIGIBLE',
    });
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
        new Map([
          [
            INVENTORY_ID,
            { quantity: 1, price: 12, itemName: 'Frame', itemClassification: 'MERCHANDISE' },
          ],
        ])
      )
    ).toThrow('Insufficient Inventory stock.');
    expect(() =>
      buildOrderItems(
        cartItems,
        new Map([
          [
            INVENTORY_ID,
            { quantity: 5, price: -1, itemName: 'Frame', itemClassification: 'MERCHANDISE' },
          ],
        ])
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

  describe('Issue #97: Inventory classification validation during checkout', () => {
    const INVENTORY_ID_2 = '507f1f77bcf86cd799439015';

    it('accepts valid MERCHANDISE and sets loyaltyEligibility to ELIGIBLE', () => {
      const inventory = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        itemName: 'Designer Sunglasses',
        category: 'Sunglasses',
        price: 50.0,
        quantity: 10,
        itemClassification: 'MERCHANDISE',
      };
      const result = buildOrderItems(
        [{ inventoryId: inventory._id, quantity: 1 }],
        new Map([[INVENTORY_ID, inventory]])
      );

      expect(result.orderItems[0].classificationSnapshot).toEqual({
        source: 'Inventory',
        sourceInventoryId: inventory._id,
        category: 'Sunglasses',
        itemClassification: 'MERCHANDISE',
        loyaltyEligibility: 'ELIGIBLE',
      });
    });

    it('accepts valid CLINICAL and sets loyaltyEligibility to INELIGIBLE', () => {
      const inventory = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        itemName: 'Prescription Contact Lens',
        category: 'Lenses',
        price: 75.0,
        quantity: 10,
        itemClassification: 'CLINICAL',
      };
      const result = buildOrderItems(
        [{ inventoryId: inventory._id, quantity: 2 }],
        new Map([[INVENTORY_ID, inventory]])
      );

      expect(result.orderItems[0].classificationSnapshot).toEqual({
        source: 'Inventory',
        sourceInventoryId: inventory._id,
        category: 'Lenses',
        itemClassification: 'CLINICAL',
        loyaltyEligibility: 'INELIGIBLE',
      });
    });

    it('accepts mixed valid classifications (MERCHANDISE and CLINICAL) in the same cart', () => {
      const invMerchandise = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        itemName: 'Frame',
        category: 'Frames',
        price: 100.0,
        quantity: 5,
        itemClassification: 'MERCHANDISE',
      };
      const invClinical = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID_2),
        itemName: 'Lens Service',
        category: 'Clinical',
        price: 50.0,
        quantity: 5,
        itemClassification: 'CLINICAL',
      };

      const result = buildOrderItems(
        [
          { inventoryId: invMerchandise._id, quantity: 1 },
          { inventoryId: invClinical._id, quantity: 1 },
        ],
        new Map([
          [INVENTORY_ID, invMerchandise],
          [INVENTORY_ID_2, invClinical],
        ])
      );

      expect(result.orderAmount).toBe(150.0);
      expect(result.orderItems[0].classificationSnapshot.itemClassification).toBe('MERCHANDISE');
      expect(result.orderItems[0].classificationSnapshot.loyaltyEligibility).toBe('ELIGIBLE');
      expect(result.orderItems[1].classificationSnapshot.itemClassification).toBe('CLINICAL');
      expect(result.orderItems[1].classificationSnapshot.loyaltyEligibility).toBe('INELIGIBLE');
    });

    it.each([
      ['missing / undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['UNKNOWN', 'UNKNOWN'],
      ['unsupported value', 'ACCESSORIES'],
      ['arbitrary string', 'INVALID_CLASS'],
    ])('rejects checkout when itemClassification is %s (AC1, AC3)', (_, invalidClassification) => {
      const inventory = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        itemName: 'Item with Bad Classification',
        category: 'Frames',
        price: 25.0,
        quantity: 5,
        itemClassification: invalidClassification,
      };

      let thrownError;
      try {
        buildOrderItems(
          [{ inventoryId: inventory._id, quantity: 1 }],
          new Map([[INVENTORY_ID, inventory]])
        );
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.statusCode).toBe(422);
      expect(thrownError.errorCode).toBe(CHECKOUT_ITEM_CLASSIFICATION_INVALID);
      expect(thrownError.message).toBe(
        'One or more cart items are unavailable for checkout because their classification is incomplete. Please contact the store.'
      );
    });

    it('rejects entire checkout if any item in a mixed cart has an invalid classification (AC10)', () => {
      const validItem = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID),
        itemName: 'Valid Frame',
        price: 100.0,
        quantity: 5,
        itemClassification: 'MERCHANDISE',
      };
      const invalidItem = {
        _id: new mongoose.Types.ObjectId(INVENTORY_ID_2),
        itemName: 'Unknown Lens',
        price: 50.0,
        quantity: 5,
        itemClassification: 'UNKNOWN',
      };

      expect(() =>
        buildOrderItems(
          [
            { inventoryId: validItem._id, quantity: 1 },
            { inventoryId: invalidItem._id, quantity: 1 },
          ],
          new Map([
            [INVENTORY_ID, validItem],
            [INVENTORY_ID_2, invalidItem],
          ])
        )
      ).toThrow(
        expect.objectContaining({
          statusCode: 422,
          errorCode: CHECKOUT_ITEM_CLASSIFICATION_INVALID,
        })
      );
    });

    it('aborts checkoutCustomer transaction and does not create Order or deduct stock on invalid classification (AC2)', async () => {
      Inventory.find.mockReturnValue(
        makeQuery([
          {
            _id: new mongoose.Types.ObjectId(INVENTORY_ID),
            branchId: FULFILLMENT_BRANCH_ID,
            itemName: 'Invalid Classification Item',
            price: 15.0,
            quantity: 5,
            itemClassification: 'UNKNOWN',
          },
        ])
      );

      await expect(checkoutCustomer(CUSTOMER_ID)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: CHECKOUT_ITEM_CLASSIFICATION_INVALID,
      });

      expect(Order.create).not.toHaveBeenCalled();
      expect(OrderItem.insertMany).not.toHaveBeenCalled();
      expect(Cart.deleteOne).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });
  });
});
