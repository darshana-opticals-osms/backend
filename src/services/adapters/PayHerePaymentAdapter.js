const crypto = require('crypto');
const { ServiceUnavailableError } = require('../../errors/AppError');

const MD5_HEX_PATTERN = /^[A-F0-9]{32}$/;

function md5Upper(value) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex').toUpperCase();
}

function formatAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new TypeError('Payment amount must be a finite non-negative number.');
  }

  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 1e-7) {
    throw new TypeError('Payment amount must use no more than two decimal places.');
  }

  return (cents / 100).toFixed(2);
}

function createCheckoutHash({ merchantId, providerOrderId, amount, currency, merchantSecret }) {
  const formattedAmount = formatAmount(amount);
  const hashedSecret = md5Upper(merchantSecret);
  return md5Upper(`${merchantId}${providerOrderId}${formattedAmount}${currency}${hashedSecret}`);
}

function createNotificationSignature(fields, merchantSecret) {
  const hashedSecret = md5Upper(merchantSecret);
  return md5Upper(
    `${fields.merchant_id}${fields.order_id}${fields.payhere_amount}${fields.payhere_currency}${fields.status_code}${hashedSecret}`
  );
}

function timingSafeSignatureEqual(actual, expected) {
  if (
    typeof actual !== 'string' ||
    typeof expected !== 'string' ||
    !MD5_HEX_PATTERN.test(actual) ||
    !MD5_HEX_PATTERN.test(expected)
  ) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, 'ascii');
  const expectedBuffer = Buffer.from(expected, 'ascii');
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function requirePayHereConfig(config) {
  const required = [
    ['merchant ID', config.payhereMerchantId],
    ['merchant secret', config.payhereMerchantSecret],
    ['return URL', config.payhereReturnUrl],
    ['cancel URL', config.payhereCancelUrl],
    ['notification URL', config.payhereNotifyUrl],
  ];
  const missing = required.find(([, value]) => !value);
  if (missing) {
    throw new Error(`PayHere ${missing[0]} is not configured.`);
  }
}

class PayHerePaymentAdapter {
  constructor(config) {
    this.config = config;
  }

  buildCheckoutPayload({ payment, customer, billing }) {
    this.assertConfigured();
    const amount = formatAmount(payment.amount);
    const currency = payment.currency;
    const merchantId = this.config.payhereMerchantId;

    return {
      checkoutUrl: this.config.payhereCheckoutUrl,
      fields: {
        merchant_id: merchantId,
        return_url: this.config.payhereReturnUrl,
        cancel_url: this.config.payhereCancelUrl,
        notify_url: this.config.payhereNotifyUrl,
        first_name: billing.firstName,
        last_name: billing.lastName,
        email: customer.email,
        phone: customer.phone,
        address: billing.address,
        city: billing.city,
        country: 'Sri Lanka',
        order_id: payment.providerOrderId,
        items: `OSMS Order ${payment.orderId}`,
        currency,
        amount,
        hash: createCheckoutHash({
          merchantId,
          providerOrderId: payment.providerOrderId,
          amount: payment.amount,
          currency,
          merchantSecret: this.config.payhereMerchantSecret,
        }),
      },
    };
  }

  verifyNotification(fields) {
    this.assertConfigured();
    if (fields.merchant_id !== this.config.payhereMerchantId) return false;
    const expected = createNotificationSignature(fields, this.config.payhereMerchantSecret);
    return timingSafeSignatureEqual(fields.md5sig, expected);
  }

  assertConfigured() {
    try {
      requirePayHereConfig(this.config);
    } catch {
      throw new ServiceUnavailableError(
        'Payment gateway is temporarily unavailable.',
        null,
        'PAYMENT_UNAVAILABLE'
      );
    }
  }
}

module.exports = {
  PayHerePaymentAdapter,
  createCheckoutHash,
  createNotificationSignature,
  formatAmount,
  timingSafeSignatureEqual,
};
