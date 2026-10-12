/**
 * Unit tests for order.service.js — Customer Order History and Single Order
 * Retrieval (Step 3 of #48).
 *
 * All Mongoose models are mocked so these tests run without a database.
 *
 * AC1  – Customer Order History: only authenticated customer's Orders returned.
 * AC2  – Empty history returns [] not an error.
 * AC3  – Single Order returned with OrderItems.
 * AC4  – Ownership enforced: different customerId → NotFoundError.
 * AC5  – Invalid Order ID format → ValidationError.
 * AC6  – Non-existent Order → NotFoundError (no leakage).
 * AC7  – Canonical ADR-004 status returned.
 * AC8  – Embedded status history returned.
 * AC9  – OrderItems: only approved customer-facing fields exposed.
 * AC18 – Safe fields only: no _id raw objects, __v, passwordHash, etc.
 */

const mongoose = require('mongoose');
const {
  getOrders,
  getOrderById,
  getCustomerOrders,
  getCustomerOrderById,
  updateOrderStatus,
  shapeOrderItem,
  shapeOrderSummary,
  shapeHistoryEntry,
} = require('../../src/services/order.service');
const { NotFoundError, ValidationError } = require('../../src/errors/AppError');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const { ROLE_VALUES } = require('../../src/constants/roles');

// ─── Mock Mongoose Models ─────────────────────────────────────────────────────

jest.mock('../../src/models/order.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../src/models/orderItem.model', () => ({
  find: jest.fn(),
}));
jest.mock('../../src/models/customer.model', () => ({
  findById: jest.fn(),
}));
jest.mock('../../src/services/notification.service', () => ({
  sendOrderCancellationNotification: jest.fn().mockResolvedValue({ delivered: true }),
}));

const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Customer = require('../../src/models/customer.model');
const { sendOrderCancellationNotification } = require('../../src/services/notification.service');

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const CUSTOMER_ID = new mongoose.Types.ObjectId();
const CUSTOMER_ID_STR = CUSTOMER_ID.toString();
const OTHER_CUSTOMER_ID = new mongoose.Types.ObjectId();
const ORDER_ID = new mongoose.Types.ObjectId();
const ORDER_ID_STR = ORDER_ID.toString();
const ITEM_ID_1 = new mongoose.Types.ObjectId();
const ITEM_ID_2 = new mongoose.Types.ObjectId();

const now = new Date('2024-05-01T10:00:00.000Z');
const laterNow = new Date('2024-05-01T11:00:00.000Z');

const makeOrder = (overrides = {}) => ({
  _id: ORDER_ID,
  customerId: CUSTOMER_ID,
  orderDate: now,
  orderAmount: 26500.5,
  status: ORDER_STATUS_VALUES.ORDER_CREATED,
  statusUpdatedAt: now,
  statusHistory: [
    { status: ORDER_STATUS_VALUES.ORDER_CREATED, changedAt: now, changedBy: CUSTOMER_ID },
  ],
  createdAt: now,
  updatedAt: laterNow,
  ...overrides,
});

const makeItem = (id = ITEM_ID_1, overrides = {}) => ({
  _id: id,
  orderId: ORDER_ID,
  itemName: 'Optical Frame',
  price: 12000,
  quantity: 2,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

/** Returns a chainable mock query that resolves to `result`. */
const makeQuery = (result) => ({
  sort: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});

// ─── shapeHistoryEntry ────────────────────────────────────────────────────────

describe('shapeHistoryEntry()', () => {
  it('omits changedBy by default for customer view (Comment 3 Security)', () => {
    const entry = {
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
      changedBy: CUSTOMER_ID,
    };
    const result = shapeHistoryEntry(entry);
    expect(result).toEqual({
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
    });
    expect(result.changedBy).toBeUndefined();
  });

  it('includes string changedBy when isStaff is true', () => {
    const entry = {
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
      changedBy: CUSTOMER_ID,
    };
    const result = shapeHistoryEntry(entry, { isStaff: true });
    expect(result).toEqual({
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
      changedBy: CUSTOMER_ID_STR,
    });
  });
});

// ─── shapeOrderItem ───────────────────────────────────────────────────────────

describe('shapeOrderItem()', () => {
  it('returns only approved customer-facing fields (AC9)', () => {
    const item = makeItem();
    const shaped = shapeOrderItem(item);
    expect(shaped).toEqual({
      id: ITEM_ID_1.toString(),
      itemName: 'Optical Frame',
      price: 12000,
      quantity: 2,
    });
  });

  it('does not expose orderId, __v, or raw _id object (AC9, AC18)', () => {
    const shaped = shapeOrderItem(makeItem());
    expect(shaped).not.toHaveProperty('orderId');
    expect(shaped).not.toHaveProperty('__v');
    expect(shaped._id).toBeUndefined();
  });
});

// ─── shapeOrderSummary ────────────────────────────────────────────────────────

describe('shapeOrderSummary()', () => {
  it('returns expected top-level fields (AC7, AC8, AC18)', () => {
    const order = makeOrder();
    const shaped = shapeOrderSummary(order);
    expect(shaped).toHaveProperty('id', ORDER_ID_STR);
    expect(shaped).toHaveProperty('customerId', CUSTOMER_ID_STR);
    expect(shaped).toHaveProperty('orderDate', now);
    expect(shaped).toHaveProperty('orderAmount', 26500.5);
    expect(shaped).toHaveProperty('status', ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(shaped).toHaveProperty('statusUpdatedAt', now);
    expect(shaped).toHaveProperty('statusHistory');
    expect(shaped).toHaveProperty('createdAt', now);
    expect(shaped).toHaveProperty('updatedAt', laterNow);
  });

  it('statusHistory entries are shaped without changedBy for customer view (AC8, Comment 3 Security)', () => {
    const order = makeOrder();
    const shaped = shapeOrderSummary(order);
    expect(shaped.statusHistory).toHaveLength(1);
    expect(shaped.statusHistory[0]).toEqual({
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
    });
    expect(shaped.statusHistory[0].changedBy).toBeUndefined();
  });

  it('statusHistory entries include changedBy when isStaff is true', () => {
    const order = makeOrder();
    const shaped = shapeOrderSummary(order, { isStaff: true });
    expect(shaped.statusHistory).toHaveLength(1);
    expect(shaped.statusHistory[0]).toEqual({
      status: ORDER_STATUS_VALUES.ORDER_CREATED,
      changedAt: now,
      changedBy: CUSTOMER_ID_STR,
    });
  });

  it('uses canonical ADR-004 status value (AC7)', () => {
    const order = makeOrder({ status: ORDER_STATUS_VALUES.PROCESSING });
    const shaped = shapeOrderSummary(order);
    expect(shaped.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
  });

  it('does not expose raw _id object or __v (AC18)', () => {
    const shaped = shapeOrderSummary(makeOrder());
    expect(shaped._id).toBeUndefined();
    expect(shaped.__v).toBeUndefined();
  });

  it('handles empty statusHistory gracefully', () => {
    const order = makeOrder({ statusHistory: [] });
    const shaped = shapeOrderSummary(order);
    expect(shaped.statusHistory).toEqual([]);
  });
});

// ─── getCustomerOrders ────────────────────────────────────────────────────────

describe('getCustomerOrders()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns shaped orders for the authenticated customer (AC1)', async () => {
    const order = makeOrder();
    Order.find.mockReturnValue(makeQuery([order]));

    const result = await getCustomerOrders(CUSTOMER_ID_STR);

    expect(Order.find).toHaveBeenCalledWith({ customerId: CUSTOMER_ID_STR });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('id', ORDER_ID_STR);
    expect(result[0]).toHaveProperty('status', ORDER_STATUS_VALUES.ORDER_CREATED);
  });

  it('returns an empty array when the customer has no Orders (AC2)', async () => {
    Order.find.mockReturnValue(makeQuery([]));

    const result = await getCustomerOrders(CUSTOMER_ID_STR);

    expect(result).toEqual([]);
  });

  it('scopes query to the authenticated customer ID — does not accept a client ID (AC1)', async () => {
    Order.find.mockReturnValue(makeQuery([]));

    await getCustomerOrders(CUSTOMER_ID_STR);

    const findCall = Order.find.mock.calls[0][0];
    expect(findCall).toHaveProperty('customerId', CUSTOMER_ID_STR);
    // Confirms only one filter key — no additional scopes that could be bypassed
    expect(Object.keys(findCall)).toEqual(['customerId']);
  });

  it('returns multiple orders when the customer has many (AC1)', async () => {
    const ORDER_ID_2 = new mongoose.Types.ObjectId();
    const order1 = makeOrder();
    const order2 = makeOrder({ _id: ORDER_ID_2 });
    Order.find.mockReturnValue(makeQuery([order1, order2]));

    const result = await getCustomerOrders(CUSTOMER_ID_STR);

    expect(result).toHaveLength(2);
  });

  it('throws ValidationError for a malformed customer ID', async () => {
    await expect(getCustomerOrders('not-an-object-id')).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── getCustomerOrderById ─────────────────────────────────────────────────────

describe('getCustomerOrderById()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns shaped order with items when customer owns the Order (AC3, AC9)', async () => {
    const order = makeOrder();
    const item1 = makeItem(ITEM_ID_1);
    const item2 = makeItem(ITEM_ID_2, { itemName: 'Lens', price: 5000, quantity: 1 });

    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(order) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([item1, item2]) });

    const result = await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    expect(result).toHaveProperty('id', ORDER_ID_STR);
    expect(result).toHaveProperty('items');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      id: ITEM_ID_1.toString(),
      itemName: 'Optical Frame',
      price: 12000,
      quantity: 2,
    });
  });

  it('scopes DB query to both orderId AND authenticatedCustomerId (AC4 — IDOR prevention)', async () => {
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    const findOneCall = Order.findOne.mock.calls[0][0];
    expect(findOneCall).toMatchObject({
      _id: ORDER_ID_STR,
      customerId: CUSTOMER_ID_STR,
    });
  });

  it('throws NotFoundError when a different customer tries to access the Order (AC4)', async () => {
    // findOne returns null because customerId won't match
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(
      getCustomerOrderById(OTHER_CUSTOMER_ID.toString(), ORDER_ID_STR)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for an invalid Order ID format (AC5)', async () => {
    await expect(getCustomerOrderById(CUSTOMER_ID_STR, 'not-valid')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('does not call the database when the Order ID is invalid (AC5)', async () => {
    await expect(getCustomerOrderById(CUSTOMER_ID_STR, 'bad-id')).rejects.toBeInstanceOf(
      ValidationError
    );

    expect(Order.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a valid but non-existent Order (AC6)', async () => {
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(
      getCustomerOrderById(CUSTOMER_ID_STR, new mongoose.Types.ObjectId().toString())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns canonical ADR-004 status (AC7)', async () => {
    const order = makeOrder({ status: ORDER_STATUS_VALUES.PROCESSING });
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(order) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const result = await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    expect(result.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
  });

  it('includes embedded statusHistory (AC8)', async () => {
    const order = makeOrder();
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(order) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const result = await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    expect(result.statusHistory).toHaveLength(1);
    expect(result.statusHistory[0]).toHaveProperty('status', ORDER_STATUS_VALUES.ORDER_CREATED);
  });

  it('does not expose internal or sensitive fields in Order response (AC18)', async () => {
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const result = await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    expect(result).not.toHaveProperty('__v');
    expect(result._id).toBeUndefined();
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('does not expose internal fields in OrderItem response (AC9, AC18)', async () => {
    Order.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
    OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });

    const result = await getCustomerOrderById(CUSTOMER_ID_STR, ORDER_ID_STR);

    const item = result.items[0];
    expect(item).not.toHaveProperty('orderId');
    expect(item).not.toHaveProperty('__v');
    expect(item._id).toBeUndefined();
  });
});

describe('updateOrderStatus (ADR-004 §9, §10, §11, §15, §16, §17)', () => {
  const STAFF_ID = new mongoose.Types.ObjectId();
  const STAFF_ID_STR = STAFF_ID.toString();

  const makeMockOrderDoc = (status, overrides = {}) => {
    const doc = {
      _id: ORDER_ID,
      customerId: CUSTOMER_ID,
      orderDate: now,
      orderAmount: 26500.5,
      status,
      statusUpdatedAt: now,
      statusHistory: [
        {
          status: ORDER_STATUS_VALUES.ORDER_CREATED,
          changedAt: now,
          changedBy: CUSTOMER_ID,
        },
      ],
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockImplementation(function () {
        return Promise.resolve(this);
      }),
      ...overrides,
    };
    return doc;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Order.findOneAndUpdate.mockImplementation(async (filter, update) => {
      const existing = await Order.findById(filter._id);
      if (!existing || existing.status !== filter.status) {
        return null;
      }
      return {
        _id: filter._id,
        customerId: existing.customerId || CUSTOMER_ID,
        orderDate: existing.orderDate || now,
        orderAmount: existing.orderAmount || 26500.5,
        status: update.$set.status,
        statusUpdatedAt: update.$set.statusUpdatedAt,
        statusHistory: [...(existing.statusHistory || []), update.$push.statusHistory],
        createdAt: existing.createdAt || now,
        updatedAt: now,
      };
    });
  });

  describe('Validation & Error Handling', () => {
    it('throws ValidationError for invalid orderId ObjectId format', async () => {
      await expect(
        updateOrderStatus('invalid-id', ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when status is missing or not a string', async () => {
      await expect(updateOrderStatus(ORDER_ID_STR, null, STAFF_ID_STR)).rejects.toThrow(
        ValidationError
      );

      await expect(updateOrderStatus(ORDER_ID_STR, 123, STAFF_ID_STR)).rejects.toThrow(
        ValidationError
      );
    });

    it('throws ValidationError when status is not a canonical ADR-004 value', async () => {
      await expect(updateOrderStatus(ORDER_ID_STR, 'SHIPPED', STAFF_ID_STR)).rejects.toThrow(
        ValidationError
      );

      await expect(updateOrderStatus(ORDER_ID_STR, 'DELIVERED', STAFF_ID_STR)).rejects.toThrow(
        ValidationError
      );
    });

    it('throws NotFoundError when order does not exist', async () => {
      Order.findById.mockResolvedValue(null);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Terminal State Locks (ADR-004 §9)', () => {
    it('rejects status change when current status is COMPLETED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.COMPLETED);
      Order.findById.mockResolvedValue(order);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);

      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects status change when current status is CANCELLED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.CANCELLED);
      Order.findById.mockResolvedValue(order);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);

      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Lifecycle Transitions (ADR-004 §9, §10)', () => {
    it('rejects skipping from ORDER_CREATED directly to COMPLETED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.ORDER_CREATED);
      Order.findById.mockResolvedValue(order);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.COMPLETED, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);

      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects skipping from PROCESSING directly to PICKED_UP', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.PROCESSING);
      Order.findById.mockResolvedValue(order);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PICKED_UP, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);

      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects cancellation once order is READY_FOR_PICKUP', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.READY_FOR_PICKUP);
      Order.findById.mockResolvedValue(order);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.CANCELLED, STAFF_ID_STR)
      ).rejects.toThrow(ValidationError);

      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Valid Lifecycle Transitions (ADR-004 §9, §15, §16)', () => {
    it('successfully transitions ORDER_CREATED -> PROCESSING and updates history', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.ORDER_CREATED);
      Order.findById.mockResolvedValue(order);
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.PROCESSING,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: ORDER_ID_STR,
          status: ORDER_STATUS_VALUES.ORDER_CREATED,
        },
        expect.objectContaining({
          $set: {
            status: ORDER_STATUS_VALUES.PROCESSING,
            statusUpdatedAt: expect.any(Date),
          },
          $push: {
            statusHistory: expect.objectContaining({
              status: ORDER_STATUS_VALUES.PROCESSING,
              changedBy: STAFF_ID_STR,
            }),
          },
        }),
        { new: true, runValidators: true }
      );
      expect(sendOrderCancellationNotification).not.toHaveBeenCalled();
      expect(result.status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(result.statusHistory).toHaveLength(2);
      expect(result.statusHistory[1].status).toBe(ORDER_STATUS_VALUES.PROCESSING);
      expect(result.statusHistory[1].changedBy).toBe(STAFF_ID_STR);
    });

    it('successfully transitions PROCESSING -> READY_FOR_PICKUP', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.PROCESSING);
      Order.findById.mockResolvedValue(order);
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(ORDER_STATUS_VALUES.READY_FOR_PICKUP);
    });

    it('successfully transitions READY_FOR_PICKUP -> PICKED_UP', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.READY_FOR_PICKUP);
      Order.findById.mockResolvedValue(order);
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.PICKED_UP,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(ORDER_STATUS_VALUES.PICKED_UP);
    });

    it('successfully transitions PICKED_UP -> COMPLETED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.PICKED_UP);
      Order.findById.mockResolvedValue(order);
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.COMPLETED,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(ORDER_STATUS_VALUES.COMPLETED);
    });
  });

  describe('Concurrent Update Protection (Comment 1)', () => {
    it('throws ValidationError with CONCURRENT_STATUS_UPDATE when atomic conditional update returns null', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.ORDER_CREATED);
      Order.findById.mockResolvedValue(order);
      Order.findOneAndUpdate.mockResolvedValue(null);

      try {
        await updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR);
        throw new Error('Expected updateOrderStatus to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.errorCode).toBe('CONCURRENT_STATUS_UPDATE');
        expect(err.statusCode).toBe(422);
      }

      expect(Order.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: ORDER_ID_STR,
          status: ORDER_STATUS_VALUES.ORDER_CREATED,
        },
        expect.any(Object),
        { new: true, runValidators: true }
      );
    });
  });

  describe('Cancellation Notification Integration (ADR-004 §17)', () => {
    it('dispatches cancellation email when transition is CANCELLED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.ORDER_CREATED);
      Order.findById.mockResolvedValue(order);
      Customer.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: CUSTOMER_ID,
          name: 'Kamal Silva',
          email: 'kamal@example.com',
        }),
      });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.CANCELLED,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(sendOrderCancellationNotification).toHaveBeenCalledTimes(1);
      expect(sendOrderCancellationNotification).toHaveBeenCalledWith({
        customerEmail: 'kamal@example.com',
        customerName: 'Kamal Silva',
        orderId: ORDER_ID_STR,
        orderAmount: order.orderAmount,
      });
      expect(result.status).toBe(ORDER_STATUS_VALUES.CANCELLED);
    });

    it('does not fail status update if notification service throws', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.PROCESSING);
      Order.findById.mockResolvedValue(order);
      Customer.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: CUSTOMER_ID,
          name: 'Kamal Silva',
          email: 'kamal@example.com',
        }),
      });
      sendOrderCancellationNotification.mockRejectedValueOnce(new Error('SMTP Network Offline'));
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.CANCELLED,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(ORDER_STATUS_VALUES.CANCELLED);
    });
  });
});

describe('Staff Order Tracking Visibility (AC6, ADR-004 §13)', () => {
  const STAFF_ID = new mongoose.Types.ObjectId();
  const STAFF_ID_STR = STAFF_ID.toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrders with staff roles', () => {
    it('retrieves all orders without customerId filter for SALES_ASSISTANT_CASHIER', async () => {
      const mockOrders = [makeOrder()];
      Order.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
      });

      const results = await getOrders({
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
      });

      expect(Order.find).toHaveBeenCalledWith({});
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(ORDER_ID_STR);
    });

    it.each([ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.OPTOMETRIST])(
      'rejects unauthorized role %s with ValidationError',
      async (unauthorizedRole) => {
        await expect(getOrders({ userId: STAFF_ID_STR, role: unauthorizedRole })).rejects.toThrow(
          ValidationError
        );
      }
    );
  });

  describe('getOrderById with staff roles', () => {
    it('retrieves any order by ID for SALES_ASSISTANT_CASHIER', async () => {
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });

      const result = await getOrderById({
        orderId: ORDER_ID_STR,
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
      });

      expect(Order.findById).toHaveBeenCalledWith(ORDER_ID_STR);
      expect(result.id).toBe(ORDER_ID_STR);
      expect(result.items).toHaveLength(1);
    });

    it('throws NotFoundError if order does not exist', async () => {
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      await expect(
        getOrderById({
          orderId: ORDER_ID_STR,
          userId: STAFF_ID_STR,
          role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it.each([ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.OPTOMETRIST])(
      'rejects unauthorized role %s with ValidationError',
      async (unauthorizedRole) => {
        await expect(
          getOrderById({
            orderId: ORDER_ID_STR,
            userId: STAFF_ID_STR,
            role: unauthorizedRole,
          })
        ).rejects.toThrow(ValidationError);
      }
    );
  });
});
