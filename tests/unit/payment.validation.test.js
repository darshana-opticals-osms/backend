const {
  validatePaymentInitiation,
  validatePayHereNotification,
} = require('../../src/validations/payment.validation');

describe('payment validation', () => {
  it('rejects client-controlled financial fields during initiation', () => {
    const errors = validatePaymentInitiation({
      body: {
        orderId: '507f1f77bcf86cd799439011',
        city: 'Colombo',
        amount: 1,
        currency: 'USD',
        status: 'completed',
      },
    });
    expect(errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(['amount', 'currency', 'status'])
    );
  });

  it('accepts only scalar, documented, form-encoded notification fields', () => {
    const request = {
      is: (type) => type === 'application/x-www-form-urlencoded',
      body: {
        merchant_id: '1211149',
        order_id: 'PAY-123',
        payment_id: '320025071278',
        payhere_amount: '1000.00',
        payhere_currency: 'LKR',
        status_code: '2',
        md5sig: 'A'.repeat(32),
      },
    };
    expect(validatePayHereNotification(request)).toEqual([]);
    expect(
      validatePayHereNotification({
        ...request,
        body: {
          ...request.body,
          captured_amount: '37000.00',
          recurring: '0',
          custom_1: '',
          custom_2: 'order context',
          method: 'VISA',
          status_message: 'Payment received',
          card_holder_name: 'Test Customer',
          card_no: '************4564',
          card_expiry: '1230',
        },
      })
    ).toEqual([]);
    expect(
      validatePayHereNotification({
        ...request,
        body: { ...request.body, order_id: ['PAY-123', 'PAY-456'] },
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'order_id' })]));
    expect(
      validatePayHereNotification({
        ...request,
        body: { ...request.body, recurring: ['0', '1'] },
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'recurring' })]));
    for (const value of ['-1.00', '37000', '1e3', 'bad', ['37000.00', '1.00']]) {
      expect(
        validatePayHereNotification({
          ...request,
          body: { ...request.body, captured_amount: value },
        })
      ).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'captured_amount' })]));
    }
    expect(
      validatePayHereNotification({ ...request, body: { ...request.body, arbitrary: 'untrusted' } })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'arbitrary' })]));
  });
});
