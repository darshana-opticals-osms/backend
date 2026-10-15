const mongoose = require('mongoose');
const ManualRefundEvidence = require('../../src/models/manualRefundEvidence.model');
const {
  validateManualRefundEvidence,
  assertFullRefundAmount,
} = require('../../src/validations/manualRefundEvidence.validation');
const {
  appendConfirmedManualRefundEvidence,
  shapeManualRefundEvidence,
} = require('../../src/services/manualRefundEvidence.service');
const { recordConfirmedManualFullRefund } = require('../../src/services/manualRefund.service');
const {
  applyFullRefundReversal,
  verifyFullRefundReversal,
} = require('../../src/services/loyaltyRefundBoundary.service');

describe('Internal manual full-refund evidence infrastructure', () => {
  it('accepts full-refund facts without inventing a mandatory receipt format or channel', () => {
    expect(validateManualRefundEvidence({ amount: 2500, currency: 'LKR' })).toEqual({
      amount: 2500,
      currency: 'LKR',
      refundChannel: null,
      refundReference: null,
    });
    expect(
      validateManualRefundEvidence({
        amount: 2500,
        currency: 'LKR',
        refundChannel: 'bank_transfer',
        refundReference: ' BANK-123 ',
      }).refundReference
    ).toBe('BANK-123');
    expect(
      validateManualRefundEvidence({
        amount: 2500,
        currency: 'LKR',
        refundChannel: 'payhere_portal',
      }).refundChannel
    ).toBe('payhere_portal');
  });
  it.each([
    null,
    [],
    'receipt',
    {},
    { amount: '2500.00', currency: 'LKR' },
    { amount: -1, currency: 'LKR' },
    { amount: NaN, currency: 'LKR' },
    { amount: Infinity, currency: 'LKR' },
    { amount: 1.001, currency: 'LKR' },
    { amount: 1, currency: 'USD' },
    { amount: 1, currency: { $ne: 'LKR' } },
    { amount: 1, currency: 'LKR', refundChannel: 'cash' },
    { amount: 1, currency: 'LKR', refundReference: '' },
    { amount: 1, currency: 'LKR', refundReference: 'x'.repeat(121) },
    { amount: 1, currency: 'LKR', refundReference: ['ref'] },
    { amount: 1, currency: 'LKR', refundReference: 'REF\nSECRET' },
    { amount: 1, currency: 'LKR', status: 'refunded' },
    { amount: 1, currency: 'LKR', recordedBy: 'client-chosen-actor' },
    { amount: 1, currency: 'LKR', providerTransactionId: 'different-capture' },
    { amount: 1, currency: 'LKR', rawPayload: { card_no: 'sensitive' } },
    { amount: 1, currency: 'LKR', cvv: 'secret' },
    { amount: 1, currency: 'LKR', md5sig: 'secret' },
    { amount: 1, currency: 'LKR', merchantSecret: 'secret' },
  ])('rejects invalid/unsafe evidence %j', (evidence) => {
    expect(() => validateManualRefundEvidence(evidence)).toThrow();
  });
  it('matches the exact full Payment amount and currency without partial refunds', () => {
    expect(() =>
      assertFullRefundAmount({ amount: 2500, currency: 'LKR' }, { amount: 2500, currency: 'LKR' })
    ).not.toThrow();
    expect(() =>
      assertFullRefundAmount(
        { amount: 2499.99, currency: 'LKR' },
        { amount: 2500, currency: 'LKR' }
      )
    ).toThrow('full original Payment');
    expect(() =>
      assertFullRefundAmount({ amount: 2500, currency: 'LKR' }, { amount: 2500, currency: 'USD' })
    ).toThrow();
  });
  it('defines database uniqueness for one canonical full refund and one idempotency identity', () => {
    expect(ManualRefundEvidence.schema.indexes()).toEqual(
      expect.arrayContaining([
        [{ paymentId: 1 }, expect.objectContaining({ unique: true })],
        [{ idempotencyKey: 1 }, expect.objectContaining({ unique: true })],
      ])
    );
    expect(ManualRefundEvidence.schema.options.strict).toBe('throw');
    expect(ManualRefundEvidence.schema.path('updatedAt')).toBeUndefined();
  });
  it('shapes audit metadata without keys, hashes, raw evidence or secrets', () => {
    const dto = shapeManualRefundEvidence({
      _id: new mongoose.Types.ObjectId(),
      paymentId: new mongoose.Types.ObjectId(),
      orderId: new mongoose.Types.ObjectId(),
      amount: 100,
      currency: 'LKR',
      recordedBy: new mongoose.Types.ObjectId(),
      idempotencyKey: 'private-idempotency',
      requestHash: 'private-hash',
      md5sig: 'private-signature',
      rawPayload: { cvv: 'private-cvv' },
    });
    expect(Object.keys(dto)).toEqual([
      'evidenceId',
      'paymentId',
      'orderId',
      'providerOrderId',
      'providerTransactionId',
      'amount',
      'currency',
      'refundChannel',
      'refundReference',
      'recordedBy',
      'createdAt',
    ]);
    expect(JSON.stringify(dto)).not.toContain('private');
  });
  it.each(['CUSTOMER', 'BRANCH_ASSISTANT', 'OPTOMETRIST', 'SYSTEM_ADMIN', 'MANAGEMENT', undefined])(
    'rejects %s before validation or persistence',
    async (role) => {
      await expect(appendConfirmedManualRefundEvidence({ auth: { role } })).rejects.toMatchObject({
        statusCode: 403,
      });
    }
  );
  it('requires authoritative context for real loyalty reversal and verification', async () => {
    await expect(applyFullRefundReversal()).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(verifyFullRefundReversal()).rejects.toMatchObject({
      statusCode: 422,
    });
  });
  it('requires an authenticated manager identity before any refund reads or writes', async () => {
    await expect(recordConfirmedManualFullRefund({})).rejects.toMatchObject({ statusCode: 401 });
    for (const role of [
      'CUSTOMER',
      'BRANCH_ASSISTANT',
      'OPTOMETRIST',
      'SYSTEM_ADMIN',
      'MANAGEMENT',
    ])
      await expect(recordConfirmedManualFullRefund({ auth: { role } })).rejects.toMatchObject({
        statusCode: 403,
      });
    await expect(
      recordConfirmedManualFullRefund({ auth: { role: 'BRANCH_MANAGER', userId: 'forged' } })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it('rejects invalid orchestration identifiers and unsupported fields before persistence', async () => {
    const auth = { role: 'BRANCH_MANAGER', userId: new mongoose.Types.ObjectId().toString() };
    const args = {
      auth,
      paymentId: new mongoose.Types.ObjectId().toString(),
      idempotencyKey: 'refund-request',
      evidence: { amount: 100, currency: 'LKR' },
    };
    for (const changes of [
      { paymentId: 'bad-id' },
      { idempotencyKey: '' },
      { evidence: { ...args.evidence, status: 'refunded' } },
    ])
      await expect(recordConfirmedManualFullRefund({ ...args, ...changes })).rejects.toMatchObject({
        statusCode: 422,
      });
  });
  it('documents read-only evidence visibility without publishing an inactive refund mutation', () => {
    const spec = require('../../src/config/swagger');
    expect(spec.components.schemas.ManagementPayment.properties.refundEvidence).toBeDefined();
    expect(spec.components.schemas.ManualRefundEvidence.nullable).toBe(true);
    expect(spec.components.schemas.ManualRefundEvidence.properties).not.toHaveProperty(
      'requestHash'
    );
    expect(Object.keys(spec.paths).filter((path) => /refund/.test(path))).toEqual([]);
  });
});
