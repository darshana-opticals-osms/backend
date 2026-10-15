const mongoose = require('mongoose');
const { calculateEarnedPoints, toMinor, fromMinor } = require('../../src/utils/loyaltyDecimal');
const { LOYALTY_EVENT_TYPE: TYPE } = require('../../src/constants/loyalty');
const LoyaltyTransaction = require('../../src/models/loyaltyTransaction.model');
const {
  earnPurchasePoints,
  reverseFullRefundPoints,
} = require('../../src/services/loyalty.service');

describe('Loyalty decimal core and controlled persistence', () => {
  it.each([
    ['100.00', '1.00'],
    ['250', '2.50'],
    ['320.00', '3.20'],
    ['0.00', '0.00'],
    ['90071992547409.00', '900719925474.09'],
  ])('calculates exact eligible spend %s / 100 as %s without binary rounding', (spend, points) => {
    expect(calculateEarnedPoints(spend)).toBe(points);
    expect(fromMinor(toMinor(points))).toBe(points);
  });
  it.each(['0.01', '100.50', '100.99', '1.005', 250, NaN, 'Infinity', '-1.00'])(
    'does not invent rounding or coerce invalid input %s',
    (value) => {
      expect(() => calculateEarnedPoints(value)).toThrow();
    }
  );
  it('reports the actual rounding contract gap rather than flooring or choosing half-up', () => {
    expect(() => calculateEarnedPoints('250.50')).toThrow(
      expect.objectContaining({ errorCode: 'LOYALTY_ROUNDING_CONTRACT_REQUIRED' })
    );
  });
  it('adds/subtracts decimal hundredths exactly and rejects excessive precision', () => {
    expect(fromMinor(toMinor('0.10') + toMinor('0.20'))).toBe('0.30');
    expect(fromMinor(-toMinor('2.50'))).toBe('-2.50');
    expect(toMinor(mongoose.Types.Decimal128.fromString('2.50'))).toBe(250n);
    expect(() => toMinor('0.001')).toThrow();
    expect(() => fromMinor(10n ** 34n)).toThrow();
  });
  it('centrally defines event types and enforces source and per-Payment identities', () => {
    expect(Object.values(TYPE)).toEqual([
      'EARN_PURCHASE',
      'REFUND_REVERSAL',
      'REDEMPTION_DEDUCTION',
    ]);
    expect(LoyaltyTransaction.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ sourceEventId: 1, eventType: 1 }, expect.objectContaining({ unique: true })],
        [{ paymentId: 1, eventType: 1 }, expect.objectContaining({ unique: true })],
      ])
    );
    expect(LoyaltyTransaction.schema.path('pointsDelta').instance).toBe('Decimal128');
  });
  it('does not accept arbitrary client spend, points, roles or balance inputs', async () => {
    const paymentId = new mongoose.Types.ObjectId().toString();
    for (const field of ['eligibleSpend', 'earnedPoints', 'loyaltyBalance', 'role'])
      await expect(earnPurchasePoints({ paymentId, [field]: '100' })).rejects.toMatchObject({
        statusCode: 422,
      });
    await expect(reverseFullRefundPoints({ paymentId })).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      earnPurchasePoints({ paymentId, session: { inTransaction: () => false } })
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
