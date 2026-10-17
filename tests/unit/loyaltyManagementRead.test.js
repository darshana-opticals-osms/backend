const mongoose = require('mongoose');
const {
  validateManagementLoyaltyRequest,
  parseManagementLoyaltyQuery,
} = require('../../src/validations/loyalty.validation');
const {
  listManagementLoyalty,
  shapeManagementTransaction,
} = require('../../src/services/loyaltyRead.service');

describe('BRANCH_MANAGER loyalty monitoring contract', () => {
  it('parses only exact allowlisted filters and deterministic sorting', () => {
    const ids = {
      customerId: new mongoose.Types.ObjectId().toString(),
      orderId: new mongoose.Types.ObjectId().toString(),
      paymentId: new mongoose.Types.ObjectId().toString(),
    };
    expect(
      parseManagementLoyaltyQuery({
        page: '2',
        limit: '10',
        ...ids,
        eventType: 'EARN_PURCHASE',
        sortOrder: 'asc',
      })
    ).toEqual({
      page: 2,
      limit: 10,
      skip: 10,
      filter: { ...ids, eventType: 'EARN_PURCHASE' },
      sort: { createdAt: 1, _id: 1 },
    });
    expect(parseManagementLoyaltyQuery()).toEqual({
      page: 1,
      limit: 25,
      skip: 0,
      filter: {},
      sort: { createdAt: -1, _id: -1 },
    });
  });

  it.each([
    [{ customerId: 'bad' }, 'customerId'],
    [{ orderId: { $ne: null } }, 'orderId'],
    [{ paymentId: ['507f1f77bcf86cd799439011'] }, 'paymentId'],
    [{ eventType: 'MANUAL_ADJUSTMENT' }, 'eventType'],
    [{ sortOrder: 'sideways' }, 'sortOrder'],
    [{ sortBy: 'pointsDelta' }, 'sortBy'],
    [{ $where: 'true' }, '$where'],
  ])('rejects unsafe direct monitoring query %#', (query, field) => {
    expect(() => parseManagementLoyaltyQuery(query)).toThrow(
      expect.objectContaining({
        statusCode: 422,
        details: expect.arrayContaining([expect.objectContaining({ field })]),
      })
    );
  });

  it('validates original pre-sanitization input and rejects bodies', () => {
    const errors = validateManagementLoyaltyRequest({
      loyaltyOriginalQuery: { $where: 'true' },
      loyaltyOriginalBody: { customerId: 'forged' },
      query: {},
      body: {},
    });
    expect(errors.map((error) => error.field)).toEqual(['$where', 'customerId']);
  });

  it('shapes only the approved manager DTO fields with exact decimals', () => {
    const record = {
      _id: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      orderId: new mongoose.Types.ObjectId(),
      paymentId: new mongoose.Types.ObjectId(),
      eventType: 'REFUND_REVERSAL',
      pointsDelta: mongoose.Types.Decimal128.fromString('-1.25'),
      balanceAfter: mongoose.Types.Decimal128.fromString('8.75'),
      createdAt: new Date('2026-10-16T10:00:00.000Z'),
      providerTransactionId: 'private-provider-reference',
      sourceEventId: new mongoose.Types.ObjectId(),
      __v: 1,
    };
    expect(shapeManagementTransaction(record)).toEqual({
      id: record._id.toString(),
      customerId: record.customerId.toString(),
      orderId: record.orderId.toString(),
      paymentId: record.paymentId.toString(),
      type: 'REFUND_REVERSAL',
      pointsDelta: '-1.25',
      balanceAfter: '8.75',
      createdAt: record.createdAt,
    });
  });

  it('defends the service boundary against non-manager callers', async () => {
    await expect(listManagementLoyalty({ role: 'CUSTOMER' })).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'FORBIDDEN',
    });
  });
});
