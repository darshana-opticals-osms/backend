const mongoose = require('mongoose');
const Payment = require('../../src/models/payment.model');
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS_VALUES,
} = require('../../src/constants/payment');

describe('Payment model (Unit tests)', () => {
  const validOrderId = new mongoose.Types.ObjectId();

  it('should validate a valid payment object without throwing errors (AC1, AC3, AC4, AC5)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 2500.0,
      status: PAYMENT_STATUS.PENDING,
      method: PAYMENT_METHOD.CARD,
    });

    // Act & Assert
    await expect(payment.validate()).resolves.toBeUndefined();
    expect(payment.orderId).toEqual(validOrderId);
    expect(payment.amount).toBe(2500.0);
    expect(payment.status).toBe(PAYMENT_STATUS.PENDING);
    expect(payment.method).toBe(PAYMENT_METHOD.CARD);
  });

  it('should default status to pending when not provided (AC4)', () => {
    // Arrange & Act
    const payment = new Payment({
      orderId: validOrderId,
      amount: 1000,
      method: PAYMENT_METHOD.CASH,
    });

    // Assert
    expect(payment.status).toBe(PAYMENT_STATUS.PENDING);
  });

  it('should default providerTransactionId to null when not provided (AC6)', () => {
    // Arrange & Act
    const payment = new Payment({
      orderId: validOrderId,
      amount: 1000,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
    });

    // Assert
    expect(payment.providerTransactionId).toBeNull();
  });

  it('should accept a providerTransactionId when provided (AC6)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 3500,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      providerTransactionId: 'txn_abc123xyz',
    });

    // Act & Assert
    await expect(payment.validate()).resolves.toBeUndefined();
    expect(payment.providerTransactionId).toBe('txn_abc123xyz');
  });

  it('should fail validation when orderId is missing (AC7)', async () => {
    // Arrange
    const payment = new Payment({
      amount: 1000,
      method: PAYMENT_METHOD.CASH,
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when amount is missing (AC7)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      method: PAYMENT_METHOD.CARD,
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when method is missing (AC7)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 1000,
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when amount is negative (AC3)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: -100,
      method: PAYMENT_METHOD.CASH,
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when status is an invalid value (AC4)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 1000,
      status: 'approved',
      method: PAYMENT_METHOD.CARD,
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when method is an invalid value (AC5)', async () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 1000,
      method: 'crypto',
    });

    // Act & Assert
    await expect(payment.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should not define raw card number or CVV fields on the schema (AC9)', () => {
    // Arrange
    const payment = new Payment({
      orderId: validOrderId,
      amount: 500,
      method: PAYMENT_METHOD.CARD,
      cardNumber: '4111111111111111',
      cvv: '123',
    });

    // Assert: schema must silently ignore these fields — they must not be persisted
    expect(payment.cardNumber).toBeUndefined();
    expect(payment.cvv).toBeUndefined();
  });

  it('should accept all valid controlled status values (AC4)', async () => {
    // Arrange & Act & Assert
    for (const status of PAYMENT_STATUS_VALUES) {
      const payment = new Payment({
        orderId: validOrderId,
        amount: 100,
        status,
        method: PAYMENT_METHOD.CASH,
      });
      await expect(payment.validate()).resolves.toBeUndefined();
    }
  });
});
