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

module.exports = {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS_VALUES,
  PAYMENT_METHOD_VALUES,
};
