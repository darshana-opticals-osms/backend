const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');

const syntheticHash = '$2b$12$' + 'a'.repeat(53);

async function createTestCustomer() {
  return Customer.create({
    name: 'Order Test Customer',
    email: 'order.customer@example.com',
    address: '12 Test Street, Colombo',
    phone: '+94711234567',
    passwordHash: syntheticHash,
  });
}

describe('Order and Order Item models', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();

    await Promise.all([OrderItem.deleteMany({}), Order.deleteMany({}), Customer.deleteMany({})]);
  });

  afterEach(async () => {
    await Promise.all([OrderItem.deleteMany({}), Order.deleteMany({}), Customer.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should create a valid Order record', async () => {
    // Arrange
    const customer = await createTestCustomer();

    const orderPayload = {
      customerId: customer._id,
      orderDate: new Date('2026-09-15T10:00:00.000Z'),
      orderAmount: 25000,
    };

    // Act
    const order = await Order.create(orderPayload);

    // Assert
    expect(order.customerId.toString()).toBe(customer._id.toString());
    expect(order.orderDate).toEqual(orderPayload.orderDate);
    expect(order.orderAmount).toBe(25000);
  });

  it('should create a valid Order Item linked to an Order', async () => {
    // Arrange
    const customer = await createTestCustomer();

    const order = await Order.create({
      customerId: customer._id,
      orderDate: new Date('2026-09-15T10:00:00.000Z'),
      orderAmount: 15000,
    });

    const orderItemPayload = {
      orderId: order._id,
      itemName: '  Ray-Ban Frame  ',
      price: 15000,
      quantity: 1,
    };

    // Act
    const orderItem = await OrderItem.create(orderItemPayload);

    // Assert
    expect(orderItem.orderId.toString()).toBe(order._id.toString());
    expect(orderItem.itemName).toBe('Ray-Ban Frame');
    expect(orderItem.price).toBe(15000);
    expect(orderItem.quantity).toBe(1);
  });

  it('should enforce required Order fields', async () => {
    // Arrange
    const invalidOrder = new Order({});

    // Act
    const validationError = invalidOrder.validateSync();

    // Assert
    expect(validationError.errors.customerId).toBeDefined();
    expect(validationError.errors.orderDate).toBeDefined();
    expect(validationError.errors.orderAmount).toBeDefined();
  });

  it('should enforce required Order Item fields', async () => {
    // Arrange
    const invalidOrderItem = new OrderItem({});

    // Act
    const validationError = invalidOrderItem.validateSync();

    // Assert
    expect(validationError.errors.orderId).toBeDefined();
    expect(validationError.errors.itemName).toBeDefined();
    expect(validationError.errors.price).toBeDefined();
    expect(validationError.errors.quantity).toBeDefined();
  });

  it('should reject a negative order amount', async () => {
    // Arrange
    const customer = await createTestCustomer();

    const invalidOrder = {
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: -100,
    };

    // Act / Assert
    await expect(Order.create(invalidOrder)).rejects.toThrow();
  });

  it('should reject a negative Order Item price', async () => {
    // Arrange
    const invalidOrderItem = {
      orderId: '507f1f77bcf86cd799439011',
      itemName: 'Test Frame',
      price: -500,
      quantity: 1,
    };

    // Act / Assert
    await expect(OrderItem.create(invalidOrderItem)).rejects.toThrow();
  });

  it('should reject a negative Order Item quantity', async () => {
    // Arrange
    const invalidOrderItem = {
      orderId: '507f1f77bcf86cd799439011',
      itemName: 'Test Frame',
      price: 5000,
      quantity: -1,
    };

    // Act / Assert
    await expect(OrderItem.create(invalidOrderItem)).rejects.toThrow();
  });

  it('should preserve the Customer-to-Order relationship', async () => {
    // Arrange
    const customer = await createTestCustomer();

    // Act
    const order = await Order.create({
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: 10000,
    });

    // Assert
    expect(order.customerId.toString()).toBe(customer._id.toString());
  });

  it('should preserve the Order-to-OrderItem relationship', async () => {
    // Arrange
    const customer = await createTestCustomer();

    const order = await Order.create({
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: 10000,
    });

    // Act
    const orderItem = await OrderItem.create({
      orderId: order._id,
      itemName: 'Optical Frame',
      price: 10000,
      quantity: 1,
    });

    // Assert
    expect(orderItem.orderId.toString()).toBe(order._id.toString());
  });
});
