const {
  parseMonitoringQuery,
  validatePaymentMonitoringDetail,
  validatePaymentMonitoringEvents,
} = require('../../src/validations/paymentMonitoring.validation');
const {
  shapeManagementPayment,
  shapeManagementEvent,
  listManagementPayments,
  getManagementPayment,
  listManagementPaymentEvents,
} = require('../../src/services/paymentMonitoring.service');
const mongoose = require('mongoose');

describe('Payment monitoring validation and DTOs', () => {
  it('defaults to bounded newest-first pagination with a stable tie-breaker', () => {
    expect(parseMonitoringQuery()).toEqual({
      page: 1,
      limit: 25,
      skip: 0,
      filter: {},
      sort: { createdAt: -1, _id: -1 },
    });
    expect(parseMonitoringQuery({}, true).sort).toEqual({ verifiedAt: -1, _id: -1 });
  });
  it('builds validated AND filters without accepting client-controlled operators', () => {
    const orderId = new mongoose.Types.ObjectId().toString();
    expect(
      parseMonitoringQuery({
        page: '2',
        limit: '10',
        sortBy: 'amount',
        sortOrder: 'asc',
        status: 'failed',
        orderId,
        providerTransactionId: 'PH.[literal]',
        reconciliationRequired: 'true',
      })
    ).toEqual({
      page: 2,
      limit: 10,
      skip: 10,
      sort: { amount: 1, _id: 1 },
      filter: {
        status: 'failed',
        orderId,
        providerTransactionId: 'PH.[literal]',
        reconciliationRequired: true,
      },
    });
    expect(parseMonitoringQuery({ reconciliationRequired: 'false' }).filter).toEqual({
      reconciliationRequired: { $ne: true },
    });
  });
  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '10001' },
    { page: '1e2' },
    { limit: '101' },
    { limit: '0' },
    { page: ['1', '2'] },
    { limit: { $gt: 1 } },
    { sortBy: 'providerTransactionId' },
    { sortOrder: 'descending' },
    { status: 'PAID' },
    { orderId: 'not-an-id' },
    { reconciliationRequired: 'yes' },
    { reconciliationRequired: false },
    { providerTransactionId: '' },
    { providerTransactionId: 'x'.repeat(121) },
    { providerTransactionId: 'PH\nPRIVATE' },
    { providerTransactionId: { $ne: null } },
    { status: ['pending', 'failed'] },
    { branchId: 'unsupported' },
    { $where: 'unsafe' },
  ])('rejects invalid monitoring query %j', (query) => {
    expect(() => parseMonitoringQuery(query)).toThrow('Invalid payment monitoring query');
  });
  it('validates event-only filters and scalar identifiers', () => {
    expect(
      parseMonitoringQuery(
        { action: 'reconciliation_required', statusCode: '-3', sortBy: 'createdAt' },
        true
      ).filter
    ).toEqual({ action: 'reconciliation_required', statusCode: '-3' });
    expect(() => parseMonitoringQuery({ action: 'unverified' }, true)).toThrow();
    expect(() => parseMonitoringQuery({ status: 'failed' }, true)).toThrow();
    expect(validatePaymentMonitoringDetail({ params: { paymentId: [] }, query: {} })).toHaveLength(
      1
    );
    expect(
      validatePaymentMonitoringDetail({
        params: { paymentId: new mongoose.Types.ObjectId().toString() },
        query: { status: 'failed' },
      })
    ).toHaveLength(1);
    expect(
      validatePaymentMonitoringEvents({
        params: { paymentId: 'invalid' },
        query: { statusCode: '99' },
      })
    ).toHaveLength(2);
  });
  it('uses explicit DTO fields and only known safe reason codes', () => {
    const record = {
      _id: new mongoose.Types.ObjectId(),
      orderId: new mongoose.Types.ObjectId(),
      amount: 100,
      reconciliationRequired: true,
      reconciliationReason: 'LATE_SUCCESS_TERMINAL_ATTEMPT',
      failureReason: 'customer-secret@example.com',
      eventKey: 'secret-event-key',
      md5sig: 'secret-signature',
      rawPayload: { card_no: 'sensitive' },
      __v: 42,
    };
    const dto = shapeManagementPayment(record);
    expect(dto.reconciliationReason).toBe('LATE_SUCCESS_TERMINAL_ATTEMPT');
    expect(dto.failureReason).toBeNull();
    expect(dto).not.toHaveProperty('eventKey');
    expect(dto).not.toHaveProperty('rawPayload');
    expect(dto).not.toHaveProperty('__v');
    const event = shapeManagementEvent({
      ...record,
      paymentId: record._id,
      reason: 'secret unstructured provider message',
    });
    expect(event.reason).toBeNull();
    expect(event).not.toHaveProperty('md5sig');
    expect(JSON.stringify([dto, event])).not.toContain('secret');
  });
  it.each(['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN', 'MANAGEMENT'])(
    'enforces BRANCH_MANAGER at the service boundary for %s',
    async (role) => {
      await expect(listManagementPayments({ role })).rejects.toMatchObject({ statusCode: 403 });
      await expect(getManagementPayment({ role, paymentId: 'invalid' })).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(
        listManagementPaymentEvents({ role, paymentId: 'invalid' })
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  );
});
