const mongoose = require('mongoose');
const { getOwnLoyalty, shapeTransaction } = require('../../src/services/loyaltyRead.service');
const {
  validateOwnLoyaltyRequest,
  parseOwnLoyaltyPagination,
} = require('../../src/validations/loyalty.validation');

describe('Customer own-loyalty read contract', () => {
  it('shapes an explicit safe DTO with fixed two-decimal strings', () => {
    const record = {
      _id: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      orderId: new mongoose.Types.ObjectId(),
      paymentId: new mongoose.Types.ObjectId(),
      eventType: 'EARN_PURCHASE',
      sourceEventId: new mongoose.Types.ObjectId(),
      providerTransactionId: 'secret-provider-reference',
      pointsDelta: mongoose.Types.Decimal128.fromString('2.50'),
      balanceAfter: mongoose.Types.Decimal128.fromString('12.50'),
      createdAt: new Date('2026-10-16T10:00:00.000Z'),
      __v: 7,
    };

    expect(shapeTransaction(record)).toEqual({
      id: record._id.toString(),
      type: 'EARN_PURCHASE',
      pointsDelta: '2.50',
      balanceAfter: '12.50',
      orderId: record.orderId.toString(),
      createdAt: record.createdAt,
    });
  });

  it('defaults and parses bounded pagination', () => {
    expect(parseOwnLoyaltyPagination()).toEqual({ page: 1, limit: 25, skip: 0 });
    expect(parseOwnLoyaltyPagination({ page: '3', limit: '10' })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it.each([
    [{ page: 'not-a-number' }, 'page'],
    [{ page: '0' }, 'page'],
    [{ limit: '101' }, 'limit'],
    [{ limit: ['25'] }, 'limit'],
  ])('rejects invalid direct parser input %#', (query, field) => {
    expect(() => parseOwnLoyaltyPagination(query)).toThrow(
      expect.objectContaining({
        statusCode: 422,
        errorCode: 'VALIDATION_ERROR',
        details: expect.arrayContaining([expect.objectContaining({ field })]),
      })
    );
  });

  it('rejects an invalid authenticated identity before querying persistence', async () => {
    await expect(getOwnLoyalty({ customerId: 'not-an-object-id' })).rejects.toMatchObject({
      statusCode: 422,
      errorCode: 'VALIDATION_ERROR',
    });
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '-1' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ page: ['1'] }, 'page'],
    [{ page: { $gt: '0' } }, 'page'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '101' }, 'limit'],
    [{ limit: '1.5' }, 'limit'],
    [{ customerId: new mongoose.Types.ObjectId().toString() }, 'customerId'],
    [{ sortBy: 'createdAt' }, 'sortBy'],
    [{ $where: 'true' }, '$where'],
  ])('rejects unsupported or malformed query %#', (query, field) => {
    const errors = validateOwnLoyaltyRequest({ loyaltyOriginalQuery: query, body: {} });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });

  it('rejects every request body field, including fields removed by sanitization', () => {
    const errors = validateOwnLoyaltyRequest({
      query: {},
      loyaltyOriginalBody: { customerId: 'other', $set: { loyaltyBalance: 50 } },
    });
    expect(errors.map((error) => error.field)).toEqual(['customerId', '$set']);
  });

  it('rejects non-object query and body containers', () => {
    expect(
      validateOwnLoyaltyRequest({ loyaltyOriginalQuery: [], loyaltyOriginalBody: [] })
    ).toEqual([
      { field: 'query', message: 'Query parameters must be an object.' },
      { field: 'body', message: 'Request body must be an empty object.' },
    ]);
  });
});
