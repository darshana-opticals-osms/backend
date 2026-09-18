const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Order = require('../../src/models/order.model');
const Customer = require('../../src/models/customer.model');
const Payment = require('../../src/models/payment.model');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');

const syntheticHash = '$2b$12$' + 'a'.repeat(53);

describe('Payment model (Integration tests)', () => {
  let testOrder;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    await Promise.all([Customer.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({})]);

    const testCustomer = await Customer.create({
      name: 'Pay Test Customer',
      email: 'pay.customer@example.com',
      address: '10 Test Street, Colombo',
      phone: '+94710000001',
      passwordHash: syntheticHash,
    });

    testOrder = await Order.create({
      customerId: testCustomer._id,
      orderDate: new Date(),
      orderAmount: 3500,
    });
  });

  beforeEach(async () => {
    await Payment.deleteMany({});
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({})]);
    await disconnectDatabase();
  });

  it('should create and persist a valid payment record referencing an Order (AC1, AC2)', async () => {
    // Arrange
    const payload = {
      orderId: testOrder._id,
      amount: 3500,
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHOD.CARD,
    };

    // Act
    const payment = await Payment.create(payload);

    // Assert
    expect(payment._id).toBeDefined();
    expect(payment.orderId.toString()).toBe(testOrder._id.toString());
    expect(payment.amount).toBe(3500);
    expect(payment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(payment.method).toBe(PAYMENT_METHOD.CARD);
  });

  it('should persist and retrieve a providerTransactionId for external reconciliation (AC6)', async () => {
    // Arrange & Act
    const payment = await Payment.create({
      orderId: testOrder._id,
      amount: 2000,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      providerTransactionId: 'pay_gw_ref_XYZ999',
    });

    const retrieved = await Payment.findById(payment._id);

    // Assert
    expect(retrieved.providerTransactionId).toBe('pay_gw_ref_XYZ999');
  });

  it('should reject a payment with a negative amount (AC3)', async () => {
    // Arrange & Act & Assert
    await expect(
      Payment.create({
        orderId: testOrder._id,
        amount: -500,
        method: PAYMENT_METHOD.CASH,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject a payment when orderId is missing (AC7)', async () => {
    // Arrange & Act & Assert
    await expect(
      Payment.create({
        amount: 1000,
        method: PAYMENT_METHOD.CASH,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject a payment with an invalid status value (AC4)', async () => {
    // Arrange & Act & Assert
    await expect(
      Payment.create({
        orderId: testOrder._id,
        amount: 1000,
        status: 'paid',
        method: PAYMENT_METHOD.CARD,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject a payment with an invalid method value (AC5)', async () => {
    // Arrange & Act & Assert
    await expect(
      Payment.create({
        orderId: testOrder._id,
        amount: 1000,
        method: 'bitcoin',
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should maintain createdAt and updatedAt timestamps (AC8)', async () => {
    // Arrange & Act
    const payment = await Payment.create({
      orderId: testOrder._id,
      amount: 1500,
      method: PAYMENT_METHOD.BANK_TRANSFER,
    });

    // Assert
    expect(payment.createdAt).toBeInstanceOf(Date);
    expect(payment.updatedAt).toBeInstanceOf(Date);
  });

  it('should update updatedAt when the status changes (AC8)', async () => {
    // Arrange
    const payment = await Payment.create({
      orderId: testOrder._id,
      amount: 1000,
      method: PAYMENT_METHOD.CARD,
      status: PAYMENT_STATUS.PENDING,
    });
    const originalUpdatedAt = payment.updatedAt;

    // Act
    await new Promise((resolve) => setTimeout(resolve, 10));
    payment.status = PAYMENT_STATUS.COMPLETED;
    await payment.save();

    // Assert
    expect(payment.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it('should be reusable by populating the linked Order document (AC10)', async () => {
    // Arrange
    const payment = await Payment.create({
      orderId: testOrder._id,
      amount: 3500,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      status: PAYMENT_STATUS.COMPLETED,
    });

    // Act
    const populated = await Payment.findById(payment._id).populate('orderId');

    // Assert
    expect(populated.orderId._id.toString()).toBe(testOrder._id.toString());
    expect(populated.orderId.orderAmount).toBe(3500);
  });

  it('should not persist raw card credentials when provided (AC9)', async () => {
    // Arrange & Act
    const payment = await Payment.create({
      orderId: testOrder._id,
      amount: 1000,
      method: PAYMENT_METHOD.CARD,
      cardNumber: '4111111111111111',
      cvv: '123',
    });

    const retrieved = await Payment.findById(payment._id);

    // Assert: schema silently drops disallowed fields
    expect(retrieved.cardNumber).toBeUndefined();
    expect(retrieved.cvv).toBeUndefined();
  });
});
