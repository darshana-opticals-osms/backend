const {
  PayHerePaymentAdapter,
  createCheckoutHash,
  createNotificationSignature,
  formatAmount,
  timingSafeSignatureEqual,
} = require('../../src/services/adapters/PayHerePaymentAdapter');

const config = {
  payhereMode: 'sandbox',
  payhereMerchantId: '1211149',
  payhereMerchantSecret: 'sandbox-secret',
  payhereReturnUrl: 'http://localhost/return',
  payhereCancelUrl: 'http://localhost/cancel',
  payhereNotifyUrl: 'https://example.test/api/payments/notify',
  payhereCheckoutUrl: 'https://sandbox.payhere.lk/pay/checkout',
};

describe('PayHerePaymentAdapter', () => {
  it('formats authoritative amounts with exactly two decimals', () => {
    expect(formatAmount(1000)).toBe('1000.00');
    expect(formatAmount(12.5)).toBe('12.50');
    expect(() => formatAmount(12.345)).toThrow(/two decimal/);
  });

  it('generates the documented uppercase merchant hash', () => {
    expect(
      createCheckoutHash({
        merchantId: '1211149',
        providerOrderId: 'PAY-123',
        amount: 1000,
        currency: 'LKR',
        merchantSecret: 'sandbox-secret',
      })
    ).toMatch(/^[A-F0-9]{32}$/);
  });

  it('verifies exact notification signatures and rejects malformed values', () => {
    const fields = {
      merchant_id: config.payhereMerchantId,
      order_id: 'PAY-123',
      payhere_amount: '1000.00',
      payhere_currency: 'LKR',
      status_code: '2',
    };
    const signature = createNotificationSignature(fields, config.payhereMerchantSecret);
    const adapter = new PayHerePaymentAdapter(config);
    expect(adapter.verifyNotification({ ...fields, md5sig: signature })).toBe(true);
    expect(adapter.verifyNotification({ ...fields, md5sig: '0'.repeat(32) })).toBe(false);
    expect(timingSafeSignatureEqual('bad', signature)).toBe(false);
  });

  it('builds a sandbox checkout payload without exposing the merchant secret', () => {
    const adapter = new PayHerePaymentAdapter(config);
    const payload = adapter.buildCheckoutPayload({
      payment: {
        orderId: '507f1f77bcf86cd799439011',
        providerOrderId: 'PAY-507f1f77bcf86cd799439012',
        amount: 2500,
        currency: 'LKR',
      },
      customer: { email: 'customer@example.com', phone: '+94711234567' },
      billing: {
        firstName: 'Test',
        lastName: 'Customer',
        address: '12 Main Street',
        city: 'Colombo',
      },
    });
    expect(payload.checkoutUrl).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(payload.fields).toMatchObject({
      merchant_id: '1211149',
      order_id: 'PAY-507f1f77bcf86cd799439012',
      amount: '2500.00',
      currency: 'LKR',
      city: 'Colombo',
      country: 'Sri Lanka',
    });
    expect(JSON.stringify(payload)).not.toContain(config.payhereMerchantSecret);
  });
});
