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
  shapeOrderDetail,
  shapeCustomerSummary,
  shapeHistoryEntry,
} = require('../../src/services/order.service');
const {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
} = require('../../src/errors/AppError');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { domainEvents, ORDER_EVENTS } = require('../../src/utils/domainEvents');

// ─── Mock Mongoose Models ─────────────────────────────────────────────────────

jest.mock('../../src/models/order.model', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../src/models/orderItem.model', () => ({
  find: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/models/inventory.model', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/models/customer.model', () => ({
  findById: jest.fn(),
  find: jest.fn(),
}));
jest.mock('../../src/models/payment.model', () => ({
  exists: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock('../../src/models/loyaltyTransaction.model', () => ({
  init: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/loyalty.service', () => ({
  earnPurchasePoints: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/reorderAlert.service', () => ({
  evaluateReorderAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/audit.service', () => ({
  record: jest.fn().mockResolvedValue({}),
  buildUserActor: jest.fn((u) => ({
    actorType: 'USER',
    actorId: (u.userId || u._id).toString(),
    actorRole: u.role || 'STAFF',
  })),
  buildSystemActor: jest.fn(() => ({
    actorType: 'SYSTEM',
    actorId: 'system',
    actorRole: 'SYSTEM',
  })),
}));
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Inventory = require('../../src/models/inventory.model');
const Payment = require('../../src/models/payment.model');
const Customer = require('../../src/models/customer.model');

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const CUSTOMER_ID = new mongoose.Types.ObjectId();
const CUSTOMER_ID_STR = CUSTOMER_ID.toString();
const OTHER_CUSTOMER_ID = new mongoose.Types.ObjectId();
const ORDER_ID = new mongoose.Types.ObjectId();
const ORDER_ID_STR = ORDER_ID.toString();
const ITEM_ID_1 = new mongoose.Types.ObjectId();
const ITEM_ID_2 = new mongoose.Types.ObjectId();
const DEFAULT_BRANCH_ID = new mongoose.Types.ObjectId();

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

let mockSession;
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = {
    withTransaction: jest.fn(async (cb) => cb()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);
});

afterEach(() => {
  if (mongoose.startSession && mongoose.startSession.mockRestore) {
    mongoose.startSession.mockRestore();
  }
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

// ─── shapeCustomerSummary ─────────────────────────────────────────────────────

describe('shapeCustomerSummary()', () => {
  it('returns name and phone for a valid customer document or object (AC1, AC2)', () => {
    const customer = {
      _id: CUSTOMER_ID,
      name: 'Kamal Perera',
      phone: '+94712345678',
      email: 'kamal@example.com',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
      loyaltyBalance: '150.00',
    };
    const shaped = shapeCustomerSummary(customer);
    expect(shaped).toEqual({
      name: 'Kamal Perera',
      phone: '+94712345678',
    });
    // Ensure sensitive customer fields are omitted (AC6)
    expect(shaped).not.toHaveProperty('email');
    expect(shaped).not.toHaveProperty('passwordHash');
    expect(shaped).not.toHaveProperty('loyaltyBalance');
    expect(shaped).not.toHaveProperty('_id');
  });

  it('returns null when customer is null or undefined (AC7)', () => {
    expect(shapeCustomerSummary(null)).toBeNull();
    expect(shapeCustomerSummary(undefined)).toBeNull();
  });

  it('falls back to empty strings when name or phone are missing on the customer object', () => {
    const shaped = shapeCustomerSummary({});
    expect(shaped).toEqual({
      name: '',
      phone: '',
    });
  });
});

// ─── shapeOrderSummary ────────────────────────────────────────────────────────

describe('shapeOrderDetail() registered address (DDP-097)', () => {
  const customer = {
    name: 'Kamal Perera',
    phone: '+94712345678',
    address: ' 10 High Level Rd, Nugegoda ',
    email: 'private@example.com',
  };

  it('includes the registered address only in opted-in staff order details', () => {
    const detail = shapeOrderDetail(makeOrder(), [], {
      isStaff: true,
      customer,
      includeCustomerAddress: true,
    });
    expect(detail.customer).toEqual({
      name: 'Kamal Perera',
      phone: '+94712345678',
      address: '10 High Level Rd, Nugegoda',
    });
    expect(detail.customer).not.toHaveProperty('email');
  });

  it('preserves staff order list data without address', () => {
    const summary = shapeOrderSummary(makeOrder(), { isStaff: true, customer });
    expect(summary.customer).toEqual({
      name: 'Kamal Perera',
      phone: '+94712345678',
    });
  });

  it('never adds staff-only customer data to customer-facing order details', () => {
    const detail = shapeOrderDetail(makeOrder(), [], {
      isStaff: false,
      customer,
      includeCustomerAddress: true,
    });
    expect(detail).not.toHaveProperty('customer');
  });

  it('uses an empty address when the customer has no registered address', () => {
    const detail = shapeOrderDetail(makeOrder(), [], {
      isStaff: true,
      customer: { name: 'Kamal Perera', phone: '+94712345678' },
      includeCustomerAddress: true,
    });
    expect(detail.customer.address).toBe('');
  });
});
describe('shapeOrderDetail() payment address snapshot (DDP-101)', () => {
  it('includes snapshot only when explicitly selected for authorized single-order details', () => {
    const order = makeOrder({ orderAddress: ' 45 Lake Road ' });
    expect(shapeOrderDetail(order, [], { includeOrderAddress: true }).orderAddress).toBe(
      '45 Lake Road'
    );
    expect(shapeOrderDetail(order, [])).not.toHaveProperty('orderAddress');
    expect(shapeOrderSummary(order)).not.toHaveProperty('orderAddress');
    expect(shapeOrderSummary(order, { isStaff: true })).not.toHaveProperty('orderAddress');
  });

  it('reports an empty snapshot for legacy orders, without using the live profile address', () => {
    const detail = shapeOrderDetail(makeOrder(), [], { includeOrderAddress: true });
    expect(detail.orderAddress).toBe('');
  });
});

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

  it('omits customer property for customer callers (isStaff: false) (AC4, AC6)', () => {
    const order = makeOrder();
    const shaped = shapeOrderSummary(order, { isStaff: false });
    expect(shaped).not.toHaveProperty('customer');
  });

  it('includes customer object when isStaff is true and customer is provided (AC1, AC2)', () => {
    const order = makeOrder();
    const customer = { name: 'Nimal Bandara', phone: '+94771234567' };
    const shaped = shapeOrderSummary(order, { isStaff: true, customer });
    expect(shaped.customer).toEqual({
      name: 'Nimal Bandara',
      phone: '+94771234567',
    });
  });

  it('includes customer: null when isStaff is true and customer is missing (AC7)', () => {
    const order = makeOrder();
    const shaped = shapeOrderSummary(order, { isStaff: true, customer: null });
    expect(shaped.customer).toBeNull();
  });
});

// ─── getCustomerOrders ────────────────────────────────────────────────────────

describe('getCustomerOrders()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  });

  it('returns shaped orders for the authenticated customer (AC1)', async () => {
    const order = makeOrder();
    Order.find.mockReturnValue(makeQuery([order]));

    const result = await getCustomerOrders(CUSTOMER_ID_STR);

    expect(Order.find).toHaveBeenCalledWith({ customerId: CUSTOMER_ID_STR });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('id', ORDER_ID_STR);
    expect(result[0]).toHaveProperty('status', ORDER_STATUS_VALUES.ORDER_CREATED);
    expect(result[0]).not.toHaveProperty('customer');
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
    expect(result).not.toHaveProperty('customer');
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
      branchId: DEFAULT_BRANCH_ID,
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
          statusUpdatedAt: now,
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
        expect.objectContaining({ new: true, runValidators: true })
      );
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
      const session = { withTransaction: async (work) => work(), endSession: jest.fn() };
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      require('../../src/models/payment.model').findOne.mockReturnValue({
        session: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId() }) }),
      });
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
      expect(require('../../src/services/loyalty.service').earnPurchasePoints).toHaveBeenCalledWith(
        expect.objectContaining({ session })
      );
      expect(session.endSession).toHaveBeenCalledTimes(1);
      startSession.mockRestore();
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
          statusUpdatedAt: now,
        },
        expect.any(Object),
        expect.objectContaining({ new: true, runValidators: true })
      );
    });
  });

  describe('Cancellation Notification Integration (ADR-004 §17, ADR-013)', () => {
    it('dispatches status_changed domain event when transition is CANCELLED', async () => {
      const order = makeMockOrderDoc(ORDER_STATUS_VALUES.PROCESSING);
      Order.findById.mockResolvedValue(order);
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const emitSpy = jest.spyOn(domainEvents, 'emit');

      const result = await updateOrderStatus(
        ORDER_ID_STR,
        ORDER_STATUS_VALUES.CANCELLED,
        STAFF_ID_STR
      );

      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith(
        ORDER_EVENTS.STATUS_CHANGED,
        expect.objectContaining({
          previousStatus: ORDER_STATUS_VALUES.PROCESSING,
          targetStatus: ORDER_STATUS_VALUES.CANCELLED,
          orderAmount: order.orderAmount,
        })
      );
      expect(result.status).toBe(ORDER_STATUS_VALUES.CANCELLED);
    });
  });
});

describe('Staff Order Tracking Visibility (AC6, ADR-004 §13)', () => {
  const STAFF_ID = new mongoose.Types.ObjectId();
  const STAFF_ID_STR = STAFF_ID.toString();
  const STAFF_BRANCH_ID = new mongoose.Types.ObjectId();
  const STAFF_BRANCH_ID_STR = STAFF_BRANCH_ID.toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrders with staff roles', () => {
    it.each([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER])(
      'retrieves scoped orders without customerId filter for %s with valid branch',
      async (staffRole) => {
        const mockOrders = [makeOrder()];
        Order.find.mockReturnValue({
          sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
        });

        const results = await getOrders({
          userId: STAFF_ID_STR,
          role: staffRole,
          branchId: STAFF_BRANCH_ID_STR,
        });

        expect(Order.find).toHaveBeenCalledWith({
          $or: [
            { status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null },
            { status: ORDER_STATUS_VALUES.PROCESSING, branchId: null },
            { branchId: new mongoose.Types.ObjectId(STAFF_BRANCH_ID_STR) },
          ],
        });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe(ORDER_ID_STR);
      }
    );

    it('includes customer name and phone in order summaries for staff (AC1, AC2)', async () => {
      const mockOrders = [makeOrder({ customerId: CUSTOMER_ID })];
      Order.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
      });
      Customer.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue([{ _id: CUSTOMER_ID, name: 'Kamal Perera', phone: '+94712345678' }]),
        }),
      });

      const results = await getOrders({
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: STAFF_BRANCH_ID_STR,
      });

      expect(results).toHaveLength(1);
      expect(results[0].customer).toEqual({
        name: 'Kamal Perera',
        phone: '+94712345678',
      });
    });

    it('batches customer queries using $in to avoid N+1 queries when multiple orders exist (AC8)', async () => {
      const CUSTOMER_2_ID = new mongoose.Types.ObjectId();
      const mockOrders = [
        makeOrder({ _id: new mongoose.Types.ObjectId(), customerId: CUSTOMER_ID }),
        makeOrder({ _id: new mongoose.Types.ObjectId(), customerId: CUSTOMER_2_ID }),
        makeOrder({ _id: new mongoose.Types.ObjectId(), customerId: CUSTOMER_ID }), // duplicate customer
      ];
      Order.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
      });
      const customerFindMock = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { _id: CUSTOMER_ID, name: 'Kamal Perera', phone: '+94712345678' },
            { _id: CUSTOMER_2_ID, name: 'Sunil Silva', phone: '+94771122334' },
          ]),
        }),
      });
      Customer.find = customerFindMock;

      const results = await getOrders({
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: STAFF_BRANCH_ID_STR,
      });

      expect(results).toHaveLength(3);
      // N+1 prevention: Customer.find must only be called ONCE with distinct IDs
      expect(customerFindMock).toHaveBeenCalledTimes(1);
      expect(customerFindMock).toHaveBeenCalledWith({
        _id: { $in: expect.arrayContaining([CUSTOMER_ID_STR, CUSTOMER_2_ID.toString()]) },
      });
      expect(results[0].customer).toEqual({ name: 'Kamal Perera', phone: '+94712345678' });
      expect(results[1].customer).toEqual({ name: 'Sunil Silva', phone: '+94771122334' });
      expect(results[2].customer).toEqual({ name: 'Kamal Perera', phone: '+94712345678' });
    });

    it('safely handles missing customer record with customer: null (AC7)', async () => {
      const mockOrders = [makeOrder({ customerId: CUSTOMER_ID })];
      Order.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
      });
      Customer.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]), // No matching customer found
        }),
      });

      const results = await getOrders({
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: STAFF_BRANCH_ID_STR,
      });

      expect(results).toHaveLength(1);
      expect(results[0].customer).toBeNull();
    });

    it.each([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER])(
      'rejects staff request with missing or invalid branchId with ForbiddenError (Review Comment 3)',
      async (staffRole) => {
        await expect(
          getOrders({ userId: STAFF_ID_STR, role: staffRole, branchId: null })
        ).rejects.toThrow(ForbiddenError);

        await expect(
          getOrders({ userId: STAFF_ID_STR, role: staffRole, branchId: 'invalid-id' })
        ).rejects.toThrow(ForbiddenError);
      }
    );

    it.each([ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.OPTOMETRIST])(
      'rejects unauthorized role %s with ValidationError',
      async (unauthorizedRole) => {
        await expect(
          getOrders({
            userId: STAFF_ID_STR,
            role: unauthorizedRole,
            branchId: STAFF_BRANCH_ID_STR,
          })
        ).rejects.toThrow(ValidationError);
      }
    );
  });

  describe('getOrderById with staff roles', () => {
    it.each([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER])(
      'retrieves any order by ID for %s with valid branch',
      async (staffRole) => {
        Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
        OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });

        const result = await getOrderById({
          orderId: ORDER_ID_STR,
          userId: STAFF_ID_STR,
          role: staffRole,
          branchId: STAFF_BRANCH_ID_STR,
        });

        expect(Order.findById).toHaveBeenCalledWith(ORDER_ID_STR);
        expect(result.id).toBe(ORDER_ID_STR);
        expect(result.items).toHaveLength(1);
      }
    );

    it('includes customer name and phone in single order details for staff (AC3)', async () => {
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });
      Customer.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: CUSTOMER_ID,
            name: 'Anura Kumara',
            phone: '+94719876543',
            email: 'anura@example.com',
            loyaltyBalance: '200.00',
          }),
        }),
      });

      const result = await getOrderById({
        orderId: ORDER_ID_STR,
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: STAFF_BRANCH_ID_STR,
      });

      expect(result.customer).toEqual({
        name: 'Anura Kumara',
        phone: '+94719876543',
        address: '',
      });
      // Ensure no sensitive fields leak (AC6)
      expect(result.customer).not.toHaveProperty('email');
      expect(result.customer).not.toHaveProperty('loyaltyBalance');
      expect(result.customer).not.toHaveProperty('_id');
    });

    it('safely sets customer: null when customer record is missing in getOrderById (AC7)', async () => {
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeOrder()) });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });
      Customer.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });

      const result = await getOrderById({
        orderId: ORDER_ID_STR,
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: STAFF_BRANCH_ID_STR,
      });

      expect(result.customer).toBeNull();
    });

    it.each([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER])(
      'rejects staff request without valid branchId with ForbiddenError (Review Comment 3)',
      async (staffRole) => {
        await expect(
          getOrderById({
            orderId: ORDER_ID_STR,
            userId: STAFF_ID_STR,
            role: staffRole,
            branchId: null,
          })
        ).rejects.toThrow(ForbiddenError);
      }
    );

    it('throws NotFoundError if order does not exist', async () => {
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      await expect(
        getOrderById({
          orderId: ORDER_ID_STR,
          userId: STAFF_ID_STR,
          role: ROLE_VALUES.BRANCH_ASSISTANT,
          branchId: STAFF_BRANCH_ID_STR,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it.each([ROLE_VALUES.SYSTEM_ADMIN, ROLE_VALUES.OPTOMETRIST])(
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

  describe('Branch Claiming and Scoped Order Visibility', () => {
    const BRANCH_A_ID = new mongoose.Types.ObjectId();
    const BRANCH_A_STR = BRANCH_A_ID.toString();
    const BRANCH_B_ID = new mongoose.Types.ObjectId();
    const BRANCH_B_STR = BRANCH_B_ID.toString();

    it('filters orders by unassigned status (ORDER_CREATED) and assigned branchId for staff', async () => {
      const mockOrders = [makeOrder()];
      Order.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrders) }),
      });

      const results = await getOrders({
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: BRANCH_A_STR,
      });

      expect(Order.find).toHaveBeenCalledWith({
        $or: [
          { status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null },
          { status: ORDER_STATUS_VALUES.PROCESSING, branchId: null },
          { branchId: new mongoose.Types.ObjectId(BRANCH_A_STR) },
        ],
      });
      expect(results).toHaveLength(1);
    });

    it('allows staff of assigned branch to view single order', async () => {
      const assignedOrder = makeOrder({
        branchId: BRANCH_A_ID,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(assignedOrder) });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });

      const result = await getOrderById({
        orderId: ORDER_ID_STR,
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: BRANCH_A_STR,
      });

      expect(result.id).toBe(ORDER_ID_STR);
      expect(result.branchId).toBe(BRANCH_A_STR);
    });

    it('allows any branch staff to view unassigned ORDER_CREATED order', async () => {
      const unassignedOrder = makeOrder({
        branchId: null,
        status: ORDER_STATUS_VALUES.ORDER_CREATED,
      });
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(unassignedOrder) });
      OrderItem.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([makeItem()]) });

      const result = await getOrderById({
        orderId: ORDER_ID_STR,
        userId: STAFF_ID_STR,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: BRANCH_A_STR,
      });

      expect(result.id).toBe(ORDER_ID_STR);
      expect(result.branchId).toBeNull();
    });

    it('denies staff from Branch B from viewing an order assigned to Branch A with ForbiddenError', async () => {
      const assignedOrder = makeOrder({
        branchId: BRANCH_A_ID,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });
      Order.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(assignedOrder) });

      await expect(
        getOrderById({
          orderId: ORDER_ID_STR,
          userId: STAFF_ID_STR,
          role: ROLE_VALUES.BRANCH_ASSISTANT,
          branchId: BRANCH_B_STR,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('assigns branchId and consumes reservation when staff transitions ORDER_CREATED to PROCESSING (same branch - Finding 2)', async () => {
      const order = makeOrder({ status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null });
      Order.findById.mockResolvedValue(order);
      Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      Order.findOneAndUpdate.mockResolvedValue(
        makeOrder({ status: ORDER_STATUS_VALUES.PROCESSING, branchId: BRANCH_A_ID })
      );
      const branchInvId = new mongoose.Types.ObjectId();
      OrderItem.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: branchInvId })]),
      });

      const branchRecord = {
        _id: branchInvId,
        branchId: BRANCH_A_ID,
        itemName: 'Optical Frame',
        quantity: 10,
      };
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(branchRecord),
      });
      Inventory.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([branchRecord]),
      });

      await updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR, {
        branchId: BRANCH_A_STR,
      });

      const updateCall = Order.findOneAndUpdate.mock.calls[0];
      expect(updateCall[1].$set).toHaveProperty(
        'branchId',
        new mongoose.Types.ObjectId(BRANCH_A_STR)
      );
      expect(updateCall[1].$set).toHaveProperty('status', ORDER_STATUS_VALUES.PROCESSING);

      // Review Finding 2: Same branch consumes checkout reservation, does NOT double-deduct
      expect(Inventory.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects cross-branch transition to PROCESSING with ConflictError (Finding 5)', async () => {
      const order = makeOrder({ status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null });
      Order.findById.mockResolvedValue(order);
      Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      const originalInvId = new mongoose.Types.ObjectId();
      const otherBranchId = new mongoose.Types.ObjectId();
      OrderItem.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: originalInvId })]),
      });

      const originalRecord = {
        _id: originalInvId,
        branchId: otherBranchId,
        itemName: 'Optical Frame',
        quantity: 5,
      };
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(originalRecord),
      });

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR, {
          branchId: BRANCH_A_STR,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('rejects transition to PROCESSING with ConflictError if branch has insufficient stock', async () => {
      const order = makeOrder({ status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null });
      Order.findById.mockResolvedValue(order);
      Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      const originalInvId = new mongoose.Types.ObjectId();
      OrderItem.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: originalInvId, quantity: 5 })]),
      });

      const originalRecord = {
        _id: originalInvId,
        branchId: new mongoose.Types.ObjectId(),
        itemName: 'Optical Frame',
        quantity: 5,
      };
      const branchRecord = {
        _id: new mongoose.Types.ObjectId(),
        branchId: BRANCH_A_ID,
        itemName: 'Optical Frame',
        quantity: 2, // only 2 in stock, but order needs 5
      };
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(originalRecord),
      });
      Inventory.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([branchRecord]),
      });

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR, {
          branchId: BRANCH_A_STR,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('rejects transition to PROCESSING if matching product is ambiguous (Review Comment 4)', async () => {
      const order = makeOrder({ status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null });
      Order.findById.mockResolvedValue(order);
      Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      const originalInvId = new mongoose.Types.ObjectId();
      OrderItem.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: originalInvId, quantity: 1 })]),
      });

      const originalRecord = {
        _id: originalInvId,
        branchId: new mongoose.Types.ObjectId(),
        itemName: 'Optical Frame',
        quantity: 5,
      };
      // 2 similarly named/variant records match at branch
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(originalRecord),
      });
      Inventory.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { _id: new mongoose.Types.ObjectId(), itemName: 'Optical Frame', quantity: 5 },
          { _id: new mongoose.Types.ObjectId(), itemName: 'Optical Frame', quantity: 5 },
        ]),
      });

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR, {
          branchId: BRANCH_A_STR,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('rejects transition to PROCESSING if source inventory is unresolved (Review Comment 4)', async () => {
      const order = makeOrder({ status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null });
      Order.findById.mockResolvedValue(order);
      Payment.exists.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
      const originalInvId = new mongoose.Types.ObjectId();
      OrderItem.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: originalInvId, quantity: 1 })]),
      });

      // source record not found in DB
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.PROCESSING, STAFF_ID_STR, {
          branchId: BRANCH_A_STR,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('restores branch inventory when an order in PROCESSING is CANCELLED', async () => {
      const branchInvId = new mongoose.Types.ObjectId();
      const order = makeOrder({
        status: ORDER_STATUS_VALUES.PROCESSING,
        branchId: BRANCH_A_ID,
      });
      Order.findById.mockResolvedValue(order);
      Order.findOneAndUpdate.mockResolvedValue(
        makeOrder({ status: ORDER_STATUS_VALUES.CANCELLED, branchId: BRANCH_A_ID })
      );
      OrderItem.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([makeItem(ITEM_ID_1, { inventoryId: branchInvId, quantity: 2 })]),
      });
      const branchRecord = {
        _id: branchInvId,
        branchId: BRANCH_A_ID,
        itemName: 'Optical Frame',
        quantity: 8,
      };
      Inventory.findByIdAndUpdate.mockResolvedValue(branchRecord);
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(branchRecord),
      });
      Inventory.find.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([branchRecord]),
      });

      await updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.CANCELLED, STAFF_ID_STR, {
        branchId: BRANCH_A_STR,
      });

      // Verify branch inventory was restored
      expect(Inventory.findByIdAndUpdate).toHaveBeenCalledWith(
        branchInvId,
        { $inc: { quantity: 2 } },
        expect.objectContaining({ new: true })
      );
    });

    it('rejects update if staff from Branch B attempts to update order assigned to Branch A', async () => {
      const assignedOrder = makeOrder({
        status: ORDER_STATUS_VALUES.PROCESSING,
        branchId: BRANCH_A_ID,
      });
      Order.findById.mockResolvedValue(assignedOrder);

      await expect(
        updateOrderStatus(ORDER_ID_STR, ORDER_STATUS_VALUES.READY_FOR_PICKUP, STAFF_ID_STR, {
          branchId: BRANCH_B_STR,
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
