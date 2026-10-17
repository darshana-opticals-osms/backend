const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Inventory = require('../../src/models/inventory.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Cart = require('../../src/models/cart.model');
const Payment = require('../../src/models/payment.model');
const PaymentEvent = require('../../src/models/paymentEvent.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const InventoryConfig = require('../../src/models/inventoryConfig.model');
const { REORDER_ALERT_STATUS } = require('../../src/constants/inventoryAlert.constants');
const {
  sweepExpiredReservations,
  cancelUnpaidReservation,
} = require('../../src/services/orderReservation.service');
const { updateOrderStatus } = require('../../src/services/order.service');
const {
  processVerifiedNotification,
  initiatePayment,
} = require('../../src/services/payment.service');
const {
  createNotificationSignature,
} = require('../../src/services/adapters/PayHerePaymentAdapter');
const { domainEvents, ORDER_EVENTS } = require('../../src/utils/domainEvents');

describe('Order reservation expiry and restoration', () => {
  let server;
  let originalEnv;
  const now = new Date();
  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PAYHERE_MODE: 'sandbox',
      PAYMENT_CURRENCY: 'LKR',
      PAYHERE_MERCHANT_ID: '1211149',
      PAYHERE_MERCHANT_SECRET: 'expiry-test-secret',
      PAYHERE_RETURN_URL: 'http://localhost:3000/payments/return',
      PAYHERE_CANCEL_URL: 'http://localhost:3000/payments/cancel',
      PAYHERE_NOTIFY_URL: 'https://example.test/api/payments/notify',
    });
    server = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = server.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db
      .admin()
      .command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: new URL(uri).host }] } });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([Order.init(), Payment.init(), PaymentEvent.init()]);
  }, 60000);
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(domainEvents, 'emit');
    await mongoose.connection.db.dropDatabase();
    await Promise.all([
      Order.createIndexes(),
      Payment.createIndexes(),
      PaymentEvent.createIndexes(),
      ReorderAlert.createIndexes(),
      InventoryConfig.createIndexes(),
      Cart.createIndexes(),
    ]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    if (server) await server.stop();
    process.env = originalEnv;
  }, 60000);

  async function reservation(overrides = {}) {
    const customer = await Customer.create({
      name: 'Expiry Customer',
      email: `expiry-${new mongoose.Types.ObjectId()}@example.com`,
      address: 'Test',
      phone: '+94711234567',
      passwordHash: `$2b$12$${'a'.repeat(53)}`,
    });
    const branch = await Branch.create({ address: 'Test Branch', contactNumber: '+94332000000' });
    const inventory = await Inventory.create({
      branchId: branch._id,
      itemName: 'Frame',
      category: 'Frames',
      brand: 'Brand',
      price: 100,
      quantity: 5,
    });
    const order = await Order.create({
      customerId: customer._id,
      orderDate: now,
      orderAmount: 200,
      status: 'ORDER_CREATED',
      reservationExpiresAt: new Date(now.getTime() - 1000),
      statusHistory: [{ status: 'ORDER_CREATED', changedAt: now, changedBy: customer._id }],
      ...overrides,
    });
    const item = await OrderItem.create({
      orderId: order._id,
      inventoryId: inventory._id,
      itemName: 'Frame',
      price: 100,
      quantity: 2,
    });
    return { order, item, inventory, customer };
  }
  const attempt = (order, status, overrides = {}) =>
    Payment.create({
      orderId: order._id,
      amount: order.orderAmount,
      method: 'online_gateway',
      status,
      providerOrderId: `PAY-${new mongoose.Types.ObjectId()}`,
      expiresAt: order.reservationExpiresAt,
      ...overrides,
    });
  const success = (payment) => {
    const fields = {
      merchant_id: '1211149',
      order_id: payment.providerOrderId,
      payment_id: `PH-${payment._id}`,
      payhere_amount: '200.00',
      payhere_currency: 'LKR',
      status_code: '2',
    };
    fields.md5sig = createNotificationSignature(fields, 'expiry-test-secret');
    return fields;
  };
  async function expectUnchanged(order, inventory) {
    const stored = await Order.findById(order._id);
    expect(stored.status).toBe(order.status);
    expect(stored.inventoryRestoredAt).toBeNull();
    expect(stored.statusHistory).toHaveLength(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(5);
    expect(domainEvents.emit).not.toHaveBeenCalled();
    expect(await Cart.countDocuments({ customerId: order.customerId })).toBe(0);
  }

  it('expires unpaid stock exactly once with system history and post-commit notification', async () => {
    const { order, inventory } = await reservation();
    jest.spyOn(domainEvents, 'emit').mockImplementationOnce((_event, _payload) => {
      expect(Order.findById(order._id)).resolves.toMatchObject({ status: 'CANCELLED' });
      expect(Inventory.findById(inventory._id)).resolves.toMatchObject({ quantity: 7 });
    });
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(0);
    const stored = await Order.findById(order._id);
    expect(stored.inventoryRestoredAt).toEqual(now);
    expect(stored.reservationExpiresAt).toEqual(order.reservationExpiresAt);
    expect((await Cart.findOne({ customerId: stored.customerId })).items).toEqual([
      expect.objectContaining({ inventoryId: inventory._id, quantity: 2 }),
    ]);
    expect(stored.statusHistory).toHaveLength(2);
    expect(stored.statusHistory[1].source).toBe('RESERVATION_EXPIRY');
    expect(stored.statusHistory[1].changedBy).toBeNull();
    expect(domainEvents.emit).toHaveBeenCalledWith(
      ORDER_EVENTS.STATUS_CHANGED,
      expect.objectContaining({
        orderId: order._id,
        targetStatus: 'CANCELLED',
      })
    );
    expect(await Payment.countDocuments()).toBe(0);
  });
  it.each(['completed', 'refunded'])('holds confirmed financial state %s', async (status) => {
    const { order, inventory } = await reservation();
    await attempt(order, status);
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(0);
    await expectUnchanged(order, inventory);
  });
  it('leaves unexpired reservations unchanged', async () => {
    const { order, inventory } = await reservation({
      reservationExpiresAt: new Date(now.getTime() + 60000),
    });
    expect((await sweepExpiredReservations({ now })).examined).toBe(0);
    await expectUnchanged(order, inventory);
  });
  it.each(['PROCESSING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'])(
    'never sweeps %s Orders',
    async (status) => {
      const { order, inventory } = await reservation({ status });
      expect((await sweepExpiredReservations({ now })).examined).toBe(0);
      await expectUnchanged(order, inventory);
    }
  );
  it.each(['failed', 'cancelled'])(
    'restores stock while preserving %s attempt history',
    async (status) => {
      const { order, inventory } = await reservation();
      const payment = await attempt(order, status, { providerTransactionId: 'PH-ORIGINAL' });
      expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
      const retained = await Payment.findById(payment._id);
      expect(retained.status).toBe(status);
      expect(retained.providerTransactionId).toBe('PH-ORIGINAL');
      expect(retained.expiresAt).toEqual(payment.expiresAt);
    }
  );
  it.each(['pending', 'processing'])(
    'closes stale %s locally and releases its original reservation once',
    async (status) => {
      const { order, inventory } = await reservation();
      const payment = await attempt(order, status, {
        providerTransactionId: 'PH-RETAINED',
        providerPaymentMethod: 'VISA',
      });
      const result = await sweepExpiredReservations({ now });
      expect(result.cancelled).toBe(1);
      expect(result.held).toEqual([]);
      const retained = await Payment.findById(payment._id);
      expect(retained.status).toBe('cancelled');
      expect(retained.failureReason).toBe('session_expired');
      expect(retained.providerTransactionId).toBe('PH-RETAINED');
      expect(retained.providerPaymentMethod).toBe('VISA');
      expect(retained.expiresAt).toEqual(payment.expiresAt);
      expect(retained.reconciliationRequired).toBe(false);
      expect((await Order.findById(order._id)).status).toBe('CANCELLED');
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
      expect((await sweepExpiredReservations({ now })).cancelled).toBe(0);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
      expect(await PaymentEvent.countDocuments()).toBe(0); // Never fabricate a verified IPN.
    }
  );
  it.each(['pending', 'processing'])(
    'holds reconciliation-flagged %s at expiry',
    async (status) => {
      const { order, inventory } = await reservation();
      const payment = await attempt(order, status, { reconciliationRequired: true });
      const result = await sweepExpiredReservations({ now });
      expect(result.held[0].reason).toBe('PAYMENT_RECONCILIATION_REQUIRED');
      expect((await Payment.findById(payment._id)).status).toBe(status);
      await expectUnchanged(order, inventory);
    }
  );
  it('holds verified reconciliation evidence even when a Payment flag is absent', async () => {
    const { order, inventory } = await reservation();
    const payment = await attempt(order, 'pending');
    await PaymentEvent.create({
      eventKey: 'prior-reconciliation',
      paymentId: payment._id,
      orderId: order._id,
      providerOrderId: payment.providerOrderId,
      providerTransactionId: 'PH-PRIOR',
      statusCode: '2',
      amount: '200.00',
      currency: 'LKR',
      action: 'reconciliation_required',
      reason: 'OTHER_PAYMENT_RECONCILIATION_PENDING',
    });
    expect((await sweepExpiredReservations({ now })).held[0].reason).toBe(
      'PAYMENT_RECONCILIATION_REQUIRED'
    );
    expect((await Payment.findById(payment._id)).status).toBe('pending');
    await expectUnchanged(order, inventory);
  });
  it('holds unresolved reconciliation on a terminal attempt', async () => {
    const { order, inventory } = await reservation();
    await attempt(order, 'failed', {
      reconciliationRequired: true,
      reconciliationReason: 'LATE_SUCCESS_TERMINAL_ATTEMPT',
    });
    const result = await sweepExpiredReservations({ now });
    expect(result.held[0].reason).toBe('PAYMENT_RECONCILIATION_REQUIRED');
    await expectUnchanged(order, inventory);
  });
  it('multiple simultaneous workers restore stock once', async () => {
    const { order, inventory } = await reservation();
    const payment = await attempt(order, 'pending');
    const results = await Promise.all([
      sweepExpiredReservations({ now }),
      sweepExpiredReservations({ now }),
      sweepExpiredReservations({ now }),
    ]);
    expect(results.reduce((sum, result) => sum + result.cancelled, 0)).toBe(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    expect((await Order.findById(order._id)).statusHistory).toHaveLength(2);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      ORDER_EVENTS.STATUS_CHANGED,
      expect.objectContaining({
        orderId: order._id,
        targetStatus: 'CANCELLED',
      })
    );
    expect((await Payment.findById(payment._id)).status).toBe('cancelled');
    expect((await Payment.findById(payment._id)).failureReason).toBe('session_expired');
  });
  it('staff cancellation competing with expiry restores once and retains the winning actor', async () => {
    const { order, inventory } = await reservation();
    const staffId = new mongoose.Types.ObjectId();
    const results = await Promise.allSettled([
      sweepExpiredReservations({ now }),
      updateOrderStatus(order._id.toString(), 'CANCELLED', staffId.toString()),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const stored = await Order.findById(order._id);
    expect(stored.status).toBe('CANCELLED');
    expect(stored.statusHistory).toHaveLength(2);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    expect(domainEvents.emit).toHaveBeenCalledWith(
      ORDER_EVENTS.STATUS_CHANGED,
      expect.objectContaining({
        orderId: order._id,
        targetStatus: 'CANCELLED',
      })
    );
    if (stored.statusHistory[1].source === 'USER')
      expect(stored.statusHistory[1].changedBy).toEqual(staffId);
  });
  it('staff unpaid cancellation restores exact references before the deadline', async () => {
    const { order, inventory } = await reservation({
      reservationExpiresAt: new Date(now.getTime() + 60000),
    });
    const staffId = new mongoose.Types.ObjectId();
    const result = await updateOrderStatus(order._id.toString(), 'CANCELLED', staffId.toString());
    expect(result.status).toBe('CANCELLED');
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    expect((await Order.findById(order._id)).statusHistory[1].changedBy).toEqual(staffId);
    expect(await Cart.countDocuments({ customerId: order.customerId })).toBe(0);
  });
  it.each(['pending', 'completed'])('staff cannot release stock for %s payment', async (status) => {
    const { order, inventory } = await reservation();
    await attempt(order, status);
    await expect(
      updateOrderStatus(order._id.toString(), 'CANCELLED', new mongoose.Types.ObjectId().toString())
    ).rejects.toThrow('unsafe');
    await expectUnchanged(order, inventory);
  });
  it('legacy missing reference blocks all restoration without guessing', async () => {
    const { order, item, inventory } = await reservation();
    await OrderItem.collection.updateOne({ _id: item._id }, { $set: { inventoryId: null } });
    const result = await sweepExpiredReservations({ now });
    expect(result.held[0].reason).toBe('INVENTORY_RESTORATION_UNVERIFIABLE');
    await expectUnchanged(order, inventory);
  });
  it('missing Inventory blocks restoration', async () => {
    const { order, item, inventory } = await reservation();
    await OrderItem.collection.updateOne(
      { _id: item._id },
      { $set: { inventoryId: new mongoose.Types.ObjectId() } }
    );
    expect((await sweepExpiredReservations({ now })).held[0].reason).toBe(
      'INVENTORY_RESTORATION_UNVERIFIABLE'
    );
    await expectUnchanged(order, inventory);
  });
  it('partial failure rolls stock, Order history and restoration guard back and allows safe retry', async () => {
    const { order, inventory } = await reservation();
    const payment = await attempt(order, 'pending');
    await InventoryConfig.create({ key: 'REORDER_THRESHOLD', value: 6 });
    const alert = await ReorderAlert.create({
      inventoryId: inventory._id,
      branchId: inventory.branchId,
      currentQuantity: 5,
      threshold: 6,
      status: REORDER_ALERT_STATUS.ACTIVE,
    });
    const originalAlert = await ReorderAlert.findById(alert._id).lean();
    const original = Order.findOneAndUpdate.bind(Order);
    const spy = jest
      .spyOn(Order, 'findOneAndUpdate')
      .mockImplementation((filter, update, options) => {
        if (update.$set?.inventoryRestoredAt)
          throw new Error('simulated failure after stock restoration');
        return original(filter, update, options);
      });
    try {
      expect((await sweepExpiredReservations({ now })).failed).toHaveLength(1);
      await expectUnchanged(order, inventory);
      expect((await Payment.findById(payment._id)).status).toBe('pending');
      expect((await Payment.findById(payment._id)).failureReason).toBeNull();
      expect(await ReorderAlert.findById(alert._id).lean()).toEqual(originalAlert);
    } finally {
      spy.mockRestore();
    }
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    expect((await Payment.findById(payment._id)).failureReason).toBe('session_expired');
    expect((await ReorderAlert.findById(alert._id)).status).toBe(REORDER_ALERT_STATUS.RESOLVED);
  });
  it.each([
    [6, REORDER_ALERT_STATUS.RESOLVED],
    [8, REORDER_ALERT_STATUS.ACTIVE],
  ])(
    'keeps reorder alerts consistent after restoration with threshold %s',
    async (threshold, status) => {
      const { order, inventory } = await reservation();
      await InventoryConfig.create({ key: 'REORDER_THRESHOLD', value: threshold });
      const alert = await ReorderAlert.create({
        inventoryId: inventory._id,
        branchId: inventory.branchId,
        currentQuantity: 5,
        threshold,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });

      expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
      expect((await Order.findById(order._id)).status).toBe('CANCELLED');
      const restoredAlert = await ReorderAlert.findById(alert._id);
      expect(restoredAlert.status).toBe(status);
      if (status === REORDER_ALERT_STATUS.ACTIVE) {
        expect(restoredAlert.currentQuantity).toBe(7);
        expect(restoredAlert.resolvedAt).toBeNull();
      } else {
        expect(restoredAlert.resolvedAt).toBeInstanceOf(Date);
      }
      expect(await ReorderAlert.countDocuments({ inventoryId: inventory._id })).toBe(1);
      expect((await sweepExpiredReservations({ now })).cancelled).toBe(0);
      expect(await ReorderAlert.findById(alert._id).lean()).toEqual(restoredAlert.toObject());
    }
  );
  it('SMTP failure does not undo the committed cancellation', async () => {
    const { order, inventory } = await reservation();
    const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(domainEvents, 'emit').mockImplementationOnce(() => {
      throw new Error('SMTP unavailable');
    });
    try {
      expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Non-blocking notification'),
        'SMTP unavailable'
      );
      expect((await Order.findById(order._id)).status).toBe('CANCELLED');
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    } finally {
      log.mockRestore();
    }
  });
  it('expiry and verified success serialize with one winning Order transition', async () => {
    const { order, inventory } = await reservation({
      reservationExpiresAt: new Date(Date.now() + 60000),
    });
    const payment = await attempt(order, 'pending');
    await Promise.all([
      sweepExpiredReservations({ now: new Date(Date.now() + 120000) }),
      processVerifiedNotification(success(payment)),
    ]);
    const storedOrder = await Order.findById(order._id);
    const storedPayment = await Payment.findById(payment._id);
    if (storedOrder.status === 'PROCESSING') {
      expect(storedPayment.status).toBe('completed');
      expect((await Inventory.findById(inventory._id)).quantity).toBe(5);
      expect(storedOrder.inventoryRestoredAt).toBeNull();
    } else {
      expect(storedOrder.status).toBe('CANCELLED');
      expect(storedPayment.status).toBe('cancelled');
      expect(storedPayment.reconciliationRequired).toBe(true);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    }
    expect(storedOrder.statusHistory).toHaveLength(2);
    expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
  });
  it('retains late success after local expiry without reviving the Order or restoring twice', async () => {
    const { order, inventory, customer } = await reservation();
    const payment = await attempt(order, 'processing');
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(1);
    const fields = success(payment);
    await Promise.all([processVerifiedNotification(fields), processVerifiedNotification(fields)]);
    const retained = await Payment.findById(payment._id);
    expect(retained.status).toBe('cancelled');
    expect(retained.failureReason).toBe('session_expired');
    expect(retained.reconciliationRequired).toBe(true);
    expect(retained.reconciliationReason).toBe('LATE_SUCCESS_TERMINAL_ATTEMPT');
    expect(
      await PaymentEvent.countDocuments({
        paymentId: payment._id,
        statusCode: '2',
        action: 'reconciliation_required',
      })
    ).toBe(1);
    expect((await Order.findById(order._id)).status).toBe('CANCELLED');
    expect((await Order.findById(order._id)).statusHistory).toHaveLength(2);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    await expect(
      initiatePayment({
        orderId: order._id.toString(),
        customerId: customer._id.toString(),
        billingInput: { city: 'Colombo' },
      })
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
    expect((await sweepExpiredReservations({ now })).cancelled).toBe(0);
  });
  it.each(['pending', 'processing', 'failed'])(
    'expiry racing late success on %s never revives an Order or loses financial evidence',
    async (status) => {
      const { order, inventory } = await reservation();
      const payment = await attempt(order, status);
      await Promise.all([
        sweepExpiredReservations({ now }),
        processVerifiedNotification(success(payment)),
      ]);
      const stored = await Order.findById(order._id);
      expect(['ORDER_CREATED', 'CANCELLED']).toContain(stored.status);
      expect((await Payment.findById(payment._id)).reconciliationRequired).toBe(true);
      expect(await PaymentEvent.countDocuments({ paymentId: payment._id })).toBe(1);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(
        stored.status === 'CANCELLED' ? 7 : 5
      );
    }
  );

  it('initiation racing expiry cannot create a chargeable attempt after stock is released', async () => {
    const { order, inventory, customer } = await reservation({
      reservationExpiresAt: new Date(Date.now() + 60000),
    });
    await Promise.allSettled([
      sweepExpiredReservations({ now: new Date(Date.now() + 120000) }),
      initiatePayment({
        orderId: order._id.toString(),
        customerId: customer._id.toString(),
        billingInput: { city: 'Colombo' },
      }),
    ]);
    const stored = await Order.findById(order._id);
    const payments = await Payment.find({ orderId: order._id });
    if (stored.status === 'CANCELLED') {
      expect(payments.every((payment) => payment.status === 'cancelled')).toBe(true);
      expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    } else {
      expect(stored.status).toBe('ORDER_CREATED');
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('pending');
      expect((await Inventory.findById(inventory._id)).quantity).toBe(5);
    }
  });
  it('bounded pages progress past held Orders without starving later eligible reservations', async () => {
    const first = await reservation();
    await attempt(first.order, 'pending', { reconciliationRequired: true });
    await reservation();
    const page = await sweepExpiredReservations({ now, limit: 1 });
    expect(page.held).toHaveLength(1);
    const next = await sweepExpiredReservations({ now, limit: 1, afterId: page.nextCursor });
    expect(next.cancelled).toBe(1);
  });
  it('rejects invalid sweep bounds', async () => {
    await expect(sweepExpiredReservations({ limit: 101 })).rejects.toThrow('Invalid');
    await expect(sweepExpiredReservations({ now: new Date('invalid') })).rejects.toThrow('Invalid');
  });
  it('aggregates multiple exact line references for the same Inventory', async () => {
    const { order, inventory } = await reservation();
    await OrderItem.create({
      orderId: order._id,
      inventoryId: inventory._id,
      itemName: 'Frame',
      price: 100,
      quantity: 3,
    });
    expect((await cancelUnpaidReservation({ orderId: order._id, now, expiry: true })).action).toBe(
      'cancelled'
    );
    expect((await Inventory.findById(inventory._id)).quantity).toBe(10);
  });
});
