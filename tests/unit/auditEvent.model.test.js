const mongoose = require('mongoose');
const AuditEvent = require('../../src/models/auditEvent.model');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
  AUDIT_SOURCE,
  AUDIT_SCHEMA_VERSION,
} = require('../../src/constants/audit');

describe('AuditEvent model (Unit Tests)', () => {
  const validEventData = {
    action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
    actorType: AUDIT_ACTOR_TYPE.USER,
    actorId: new mongoose.Types.ObjectId().toString(),
    actorRole: 'INVENTORY_MANAGER',
    targetType: AUDIT_TARGET_TYPE.INVENTORY,
    targetId: new mongoose.Types.ObjectId().toString(),
    outcome: AUDIT_OUTCOME.SUCCESS,
    branchId: 'BRANCH-COLOMBO-01',
    correlationId: 'req-12345-abc',
    source: AUDIT_SOURCE.OSMS_BACKEND,
    metadata: {
      previousQuantity: 10,
      newQuantity: 15,
      adjustmentDelta: 5,
    },
  };

  describe('Schema Validation', () => {
    it('should validate a complete, valid AuditEvent document without throwing (ADR-012 AC1)', async () => {
      const doc = new AuditEvent(validEventData);

      await expect(doc.validate()).resolves.toBeUndefined();
      expect(doc.eventId).toBeDefined();
      expect(typeof doc.eventId).toBe('string');
      expect(doc.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
      expect(doc.occurredAt).toBeInstanceOf(Date);
      expect(doc.action).toBe(AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED);
      expect(doc.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(doc.targetType).toBe(AUDIT_TARGET_TYPE.INVENTORY);
      expect(doc.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(doc.branchId).toBe('BRANCH-COLOMBO-01');
      expect(doc.correlationId).toBe('req-12345-abc');
      expect(doc.source).toBe(AUDIT_SOURCE.OSMS_BACKEND);
      expect(doc.metadata).toEqual(validEventData.metadata);
    });

    it('should set default values for optional fields (ADR-012 AC15)', () => {
      const minimalDoc = new AuditEvent({
        action: AUDIT_ACTION.PAYMENT_COMPLETED,
        actorType: AUDIT_ACTOR_TYPE.EXTERNAL_PROVIDER,
        actorId: AUDIT_SOURCE.PAYHERE_GATEWAY,
        actorRole: AUDIT_SOURCE.PAYHERE_GATEWAY,
        targetType: AUDIT_TARGET_TYPE.PAYMENT,
        targetId: 'PAY-12345',
        outcome: AUDIT_OUTCOME.SUCCESS,
      });

      expect(minimalDoc.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
      expect(minimalDoc.eventId).toBeDefined();
      expect(minimalDoc.occurredAt).toBeInstanceOf(Date);
      expect(minimalDoc.branchId).toBeNull();
      expect(minimalDoc.correlationId).toBeNull();
      expect(minimalDoc.source).toBeNull();
      expect(minimalDoc.metadata).toBeNull();
    });

    it('should fail validation if required fields are missing', async () => {
      const emptyDoc = new AuditEvent({});

      let error;
      try {
        await emptyDoc.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.action).toBeDefined();
      expect(error.errors.actorType).toBeDefined();
      expect(error.errors.actorId).toBeDefined();
      expect(error.errors.actorRole).toBeDefined();
      expect(error.errors.targetType).toBeDefined();
      expect(error.errors.targetId).toBeDefined();
      expect(error.errors.outcome).toBeDefined();
    });

    it('should enforce enum restrictions on action, actorType, targetType, outcome, and source', async () => {
      const invalidDoc = new AuditEvent({
        ...validEventData,
        action: 'UNKNOWN_ACTION_INVALID',
        actorType: 'SUPERMAN',
        targetType: 'SECRET_VAULT',
        outcome: 'MAYBE',
        source: 'ALIEN_SYSTEM',
      });

      let error;
      try {
        await invalidDoc.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.action).toBeDefined();
      expect(error.errors.actorType).toBeDefined();
      expect(error.errors.targetType).toBeDefined();
      expect(error.errors.outcome).toBeDefined();
      expect(error.errors.source).toBeDefined();
    });
  });

  describe('Indexes and Retention Configuration', () => {
    it('defines a unique index on eventId for idempotency (ADR-012 AC48)', () => {
      const indexes = AuditEvent.schema.indexes();
      const uniqueEventIdIndex = indexes.find(
        ([fields, options]) => fields.eventId === 1 && options?.unique === true
      );

      expect(uniqueEventIdIndex).toBeDefined();
    });

    it('defines operational compound indexes for fast audit query retrieval', () => {
      const indexes = AuditEvent.schema.indexes();

      const actionOccurredIndex = indexes.find(
        ([fields]) => fields.action === 1 && fields.occurredAt === -1
      );
      const targetOccurredIndex = indexes.find(
        ([fields]) => fields.targetType === 1 && fields.targetId === 1 && fields.occurredAt === -1
      );
      const actorOccurredIndex = indexes.find(
        ([fields]) => fields.actorId === 1 && fields.occurredAt === -1
      );
      const branchOccurredIndex = indexes.find(
        ([fields]) => fields.branchId === 1 && fields.occurredAt === -1
      );

      expect(actionOccurredIndex).toBeDefined();
      expect(targetOccurredIndex).toBeDefined();
      expect(actorOccurredIndex).toBeDefined();
      expect(branchOccurredIndex).toBeDefined();
    });

    it('must NOT define any TTL (expireAfterSeconds) index to satisfy the 7-year retention rule', () => {
      const indexes = AuditEvent.schema.indexes();
      const ttlIndex = indexes.find(([, options]) => options && options.expireAfterSeconds);

      expect(ttlIndex).toBeUndefined();
    });
  });

  describe('Append-Only Immutability Middleware (ADR-012 AC4-AC5)', () => {
    const IMMUTABILITY_MSG = /AuditEvent records are immutable and append-only/;

    it('should block update query methods at the middleware level', () => {
      const updateMethods = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'];

      for (const method of updateMethods) {
        const queryHooks = AuditEvent.schema.s.hooks._pres.get(method) || [];
        const immutabilityHook = queryHooks.find((h) =>
          String(h.fn).includes('IMMUTABILITY_ERROR')
        );

        expect(immutabilityHook).toBeDefined();
        expect(() => {
          immutabilityHook.fn();
        }).toThrow(IMMUTABILITY_MSG);
      }
    });

    it('should block delete query methods at the middleware level', () => {
      const deleteMethods = ['deleteOne', 'deleteMany', 'findOneAndDelete'];

      for (const method of deleteMethods) {
        const queryHooks = AuditEvent.schema.s.hooks._pres.get(method) || [];
        const immutabilityHook = queryHooks.find((h) =>
          String(h.fn).includes('IMMUTABILITY_ERROR')
        );

        expect(immutabilityHook).toBeDefined();
        expect(() => {
          immutabilityHook.fn();
        }).toThrow(IMMUTABILITY_MSG);
      }
    });

    it('should reject save() when the document is not new (isNew = false)', (done) => {
      const saveHooks = AuditEvent.schema.s.hooks._pres.get('save') || [];
      const saveImmutabilityHook = saveHooks.find((h) =>
        String(h.fn).includes('IMMUTABILITY_ERROR')
      );

      expect(saveImmutabilityHook).toBeDefined();

      const fakeExistingDoc = { isNew: false };
      saveImmutabilityHook.fn.call(fakeExistingDoc, (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(IMMUTABILITY_MSG);
        done();
      });
    });

    it('should allow save() when the document is new (isNew = true)', (done) => {
      const saveHooks = AuditEvent.schema.s.hooks._pres.get('save') || [];
      const saveImmutabilityHook = saveHooks.find((h) =>
        String(h.fn).includes('IMMUTABILITY_ERROR')
      );

      expect(saveImmutabilityHook).toBeDefined();

      const fakeNewDoc = { isNew: true };
      saveImmutabilityHook.fn.call(fakeNewDoc, (err) => {
        expect(err).toBeUndefined();
        done();
      });
    });
  });
});
