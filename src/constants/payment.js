const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

const PAYMENT_METHOD = Object.freeze({
  CARD: 'card',
  CASH: 'cash',
  BANK_TRANSFER: 'bank_transfer',
  ONLINE_GATEWAY: 'online_gateway',
});

const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));
const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHOD));

const PAYMENT_PROVIDER = Object.freeze({
  PAYHERE: 'payhere',
});

const PAYMENT_CURRENCY = Object.freeze({
  LKR: 'LKR',
});

const PAYHERE_STATUS_CODE = Object.freeze({
  SUCCESS: '2',
  PENDING: '0',
  CANCELLED: '-1',
  FAILED: '-2',
  CHARGEBACK: '-3',
});

const PAYHERE_STATUS_CODE_VALUES = Object.freeze(Object.values(PAYHERE_STATUS_CODE));

module.exports = {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_PROVIDER,
  PAYMENT_CURRENCY,
  PAYHERE_STATUS_CODE,
  PAYHERE_STATUS_CODE_VALUES,
};
