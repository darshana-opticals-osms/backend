const mongoose = require('mongoose');
const auditService = require('../../src/services/audit.service');
const AuditEvent = require('../../src/models/auditEvent.model');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
  AUDIT_SOURCE,
  AUDIT_SCHEMA_VERSION,
  AUDIT_PAGE_SIZE_MAX,
} = require('../../src/constants/audit');

describe('auditService (Unit Tests)', () => {
  const validUserActor = {
    actorType: AUDIT_ACTOR_TYPE.USER,
    actorId: new mongoose.Types.ObjectId().toString(),
    actorRole: 'INVENTORY_MANAGER',
  };

  const validTarget = {
    targetType: AUDIT_TARGET_TYPE.INVENTORY,
    targetId: new mongoose.Types.ObjectId().toString(),
  };

  describe('Actor Builders', () => {
    describe('buildUserActor', () => {
      it('should return a properly formatted user actor object when given valid authContext', () => {
        const authContext = {
          userId: '60d0fe4f5311236168a109ca',
          role: 'ADMIN',
        };

        const actor = auditService.buildUserActor(authContext);

        expect(actor).toEqual({
          actorType: AUDIT_ACTOR_TYPE.USER,
          actorId: '60d0fe4f5311236168a109ca',
          actorRole: 'ADMIN',
        });
      });

      it('should throw an error if authContext is missing or incomplete', () => {
        expect(() => auditService.buildUserActor(null)).toThrow(
          /authContext must contain userId and role/
        );
        expect(() => auditService.buildUserActor({})).toThrow(
          /authContext must contain userId and role/
        );
        expect(() => auditService.buildUserActor({ userId: '123' })).toThrow(
          /authContext must contain userId and role/
        );
        expect(() => auditService.buildUserActor({ role: 'ADMIN' })).toThrow(
          /authContext must contain userId and role/
        );
      });
    });

    describe('buildSystemActor', () => {
      it('should return a system actor descriptor with OSMS_BACKEND source identifiers', () => {
        const actor = auditService.buildSystemActor();

        expect(actor).toEqual({
          actorType: AUDIT_ACTOR_TYPE.SYSTEM,
          actorId: AUDIT_SOURCE.OSMS_BACKEND,
          actorRole: AUDIT_SOURCE.OSMS_BACKEND,
        });
      });
    });

    describe('buildExternalProviderActor', () => {
      it('should return an external provider actor descriptor with the specified provider source', () => {
        const actor = auditService.buildExternalProviderActor(AUDIT_SOURCE.PAYHERE_GATEWAY);

        expect(actor).toEqual({
          actorType: AUDIT_ACTOR_TYPE.EXTERNAL_PROVIDER,
          actorId: AUDIT_SOURCE.PAYHERE_GATEWAY,
          actorRole: AUDIT_SOURCE.PAYHERE_GATEWAY,
        });
      });
    });
  });

  describe('record() - Validation and Normalization', () => {
    beforeEach(() => {
      jest.spyOn(AuditEvent, 'create').mockImplementation(async (docs) =>
        docs.map((d) => ({
          _id: new mongoose.Types.ObjectId(),
          ...d,
        }))
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should throw when action is missing or invalid', async () => {
      await expect(
        auditService.record({
          action: 'INVALID_TAXONOMY_ACTION',
          actor: validUserActor,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/must be one of the controlled AUDIT_ACTION values/);

      await expect(
        auditService.record({
          action: null,
          actor: validUserActor,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/must be one of the controlled AUDIT_ACTION values/);
    });

    it('should throw when actor is missing or invalid', async () => {
      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: null,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'actor' must be a plain object/);

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: { actorType: 'HACKER', actorId: '123', actorRole: 'DEV' },
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'actor.actorType' must be one of/);

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: { actorType: AUDIT_ACTOR_TYPE.USER, actorId: '', actorRole: 'DEV' },
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'actor.actorId' must be a non-empty string/);

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: { actorType: AUDIT_ACTOR_TYPE.USER, actorId: '123', actorRole: '   ' },
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'actor.actorRole' must be a non-empty string/);
    });

    it('should throw when target is missing or invalid', async () => {
      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: null,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'target' must be a plain object/);

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: { targetType: 'UNKNOWN_RESOURCE', targetId: '123' },
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'target.targetType' must be one of/);

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: { targetType: AUDIT_TARGET_TYPE.INVENTORY, targetId: '' },
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow(/'target.targetId' must be a non-empty string/);
    });

    it('should throw when outcome is invalid', async () => {
      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: validTarget,
          outcome: 'PENDING_APPROVAL',
        })
      ).rejects.toThrow(/'outcome' must be one of/);
    });

    it('should throw when source is invalid', async () => {
      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
          source: 'UNKNOWN_EXTERNAL_APP',
        })
      ).rejects.toThrow(/'source' must be one of/);
    });

    it('should reject correlationId if it appears to be a JWT token (ADR-012 AC14)', async () => {
      const jwtToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
          correlationId: jwtToken,
        })
      ).rejects.toThrow(/correlationId must not be a JWT or credential token/);
    });

    it('should accept valid non-JWT correlation IDs', async () => {
      const result = await auditService.record({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        actor: validUserActor,
        target: validTarget,
        outcome: AUDIT_OUTCOME.SUCCESS,
        correlationId: 'req-uuid-12345',
      });

      expect(result.correlationId).toBe('req-uuid-12345');
    });
  });

  describe('record() - Persistence & Sanitization Behavior', () => {
    beforeEach(() => {
      jest.spyOn(AuditEvent, 'create').mockImplementation(async (docs) =>
        docs.map((d) => ({
          _id: new mongoose.Types.ObjectId(),
          ...d,
        }))
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should sanitize metadata removing sensitive keys before persistence', async () => {
      const rawMetadata = {
        previousQuantity: 5,
        newQuantity: 10,
        adjustmentDelta: 5,
        password: 'should_be_stripped',
        cvv: '999',
        token: 'bearer_token_stripped',
      };

      const result = await auditService.record({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        actor: validUserActor,
        target: validTarget,
        outcome: AUDIT_OUTCOME.SUCCESS,
        metadata: rawMetadata,
      });

      expect(result.metadata.previousQuantity).toBe(5);
      expect(result.metadata.newQuantity).toBe(10);
      expect(result.metadata.adjustmentDelta).toBe(5);
      expect(result.metadata.password).toBeUndefined();
      expect(result.metadata.cvv).toBeUndefined();
      expect(result.metadata.token).toBeUndefined();
    });

    it('should preserve provided eventId for idempotent retries (ADR-012 AC48)', async () => {
      const fixedEventId = 'my-deterministic-idempotency-key-123';

      const result = await auditService.record({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        actor: validUserActor,
        target: validTarget,
        outcome: AUDIT_OUTCOME.SUCCESS,
        eventId: fixedEventId,
      });

      expect(result.eventId).toBe(fixedEventId);
      expect(result.schemaVersion).toBe(AUDIT_SCHEMA_VERSION);
    });

    it('should pass session to AuditEvent.create when session is provided', async () => {
      const mockSession = { id: 'mock-mongo-session' };
      const createSpy = jest.spyOn(AuditEvent, 'create').mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          eventId: 'mock-event-id',
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        },
      ]);

      await auditService.record({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        actor: validUserActor,
        target: validTarget,
        outcome: AUDIT_OUTCOME.SUCCESS,
        session: mockSession,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ session: mockSession })
      );
    });

    it('should propagate database persistence failures to callers (fail-closed requirement)', async () => {
      jest
        .spyOn(AuditEvent, 'create')
        .mockRejectedValueOnce(new Error('Mongo connection timed out or write rejected'));

      await expect(
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: validUserActor,
          target: validTarget,
          outcome: AUDIT_OUTCOME.SUCCESS,
        })
      ).rejects.toThrow('Mongo connection timed out or write rejected');
    });
  });

  describe('query() - Audit Trail Queries (ADR-012 AC53-AC58)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should throw an error on unsupported action filter', async () => {
      await expect(auditService.query({ action: 'INVALID_QUERY_ACTION' })).rejects.toThrow(
        /unsupported action filter value/
      );
    });

    it('should throw an error on unsupported targetType filter', async () => {
      await expect(auditService.query({ targetType: 'INVALID_TARGET_TYPE' })).rejects.toThrow(
        /unsupported targetType filter value/
      );
    });

    it('should execute query with deterministic sort and bounded pagination', async () => {
      const mockEvents = [
        { _id: '1', action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED },
        { _id: '2', action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED },
      ];

      const leanMock = jest.fn().mockResolvedValue(mockEvents);
      const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
      const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
      const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
      const findSpy = jest.spyOn(AuditEvent, 'find').mockReturnValue({ sort: sortMock });
      const countSpy = jest.spyOn(AuditEvent, 'countDocuments').mockResolvedValue(2);

      const result = await auditService.query({
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        page: 2,
        limit: 10,
      });

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED })
      );
      expect(sortMock).toHaveBeenCalledWith({ occurredAt: -1, _id: -1 });
      expect(skipMock).toHaveBeenCalledWith(10); // (page 2 - 1) * 10
      expect(limitMock).toHaveBeenCalledWith(10);
      expect(countSpy).toHaveBeenCalled();
      expect(result).toEqual({
        events: mockEvents,
        total: 2,
        page: 2,
        pages: 1,
      });
    });

    it('should cap page limit at AUDIT_PAGE_SIZE_MAX', async () => {
      const leanMock = jest.fn().mockResolvedValue([]);
      const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
      const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
      const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
      jest.spyOn(AuditEvent, 'find').mockReturnValue({ sort: sortMock });
      jest.spyOn(AuditEvent, 'countDocuments').mockResolvedValue(0);

      await auditService.query({
        limit: AUDIT_PAGE_SIZE_MAX + 500, // Requesting exceeding limit
      });

      expect(limitMock).toHaveBeenCalledWith(AUDIT_PAGE_SIZE_MAX);
    });

    it('should apply date range filter with $gte and $lte', async () => {
      const leanMock = jest.fn().mockResolvedValue([]);
      const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
      const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
      const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
      const findSpy = jest.spyOn(AuditEvent, 'find').mockReturnValue({ sort: sortMock });
      jest.spyOn(AuditEvent, 'countDocuments').mockResolvedValue(0);

      const from = '2026-01-01T00:00:00Z';
      const to = '2026-01-31T23:59:59Z';

      await auditService.query({
        fromDate: from,
        toDate: to,
      });

      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          occurredAt: {
            $gte: new Date(from),
            $lte: new Date(to),
          },
        })
      );
    });

    it('should throw ValidationError on invalid fromDate format', async () => {
      await expect(auditService.query({ fromDate: 'not-a-valid-date' })).rejects.toThrow(
        /invalid fromDate format/
      );
    });

    it('should throw ValidationError on invalid toDate format', async () => {
      await expect(auditService.query({ toDate: 'not-a-valid-date' })).rejects.toThrow(
        /invalid toDate format/
      );
    });

    it('should throw ValidationError when fromDate is after toDate', async () => {
      await expect(
        auditService.query({
          fromDate: '2026-05-10T00:00:00Z',
          toDate: '2026-05-01T00:00:00Z',
        })
      ).rejects.toThrow(/fromDate cannot be after toDate/);
    });

    it('should throw ValidationError when date range exceeds 90 days (ADR-012 §14.3)', async () => {
      await expect(
        auditService.query({
          fromDate: '2026-01-01T00:00:00Z',
          toDate: '2026-04-15T00:00:00Z', // 104 days > 90 days
        })
      ).rejects.toThrow(/date range exceeds maximum allowed limit of 90 days/);
    });

    it('should throw ValidationError when fromDate is more than 90 days in the past and toDate is omitted', async () => {
      const past100Days = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      await expect(auditService.query({ fromDate: past100Days })).rejects.toThrow(
        /date range exceeds maximum allowed limit of 90 days/
      );
    });
  });

  describe('logAuditWriteFailure()', () => {
    it('should log audit write failures with sanitized error messages (AC60)', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const sensitiveError = new Error(
        'Database write failed with token=secret123 and password=supersecret'
      );

      auditService.logAuditWriteFailure(
        AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        'TARGET-123',
        sensitiveError
      );

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const loggedMsg = consoleErrorSpy.mock.calls[0][0];

      expect(loggedMsg).toContain('[AUDIT WRITE FAILURE]');
      expect(loggedMsg).toContain(`action=${AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED}`);
      expect(loggedMsg).toContain('targetId=TARGET-123');
      expect(loggedMsg).not.toContain('secret123');
      expect(loggedMsg).not.toContain('supersecret');
      expect(loggedMsg).toContain('[REDACTED]');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Cryptographic Hash Chaining & Integrity (ADR-012 §10.2 / §17.2)', () => {
    describe('computePayloadString()', () => {
      it('should compute canonical concatenated payload string', () => {
        const payload = auditService.computePayloadString({
          eventId: 'evt-001',
          schemaVersion: '1.0',
          occurredAt: new Date('2026-10-17T10:00:00.000Z'),
          action: AUDIT_ACTION.INVENTORY_PRICE_UPDATED,
          actorId: 'usr-123',
          targetType: AUDIT_TARGET_TYPE.INVENTORY,
          targetId: 'inv-456',
          metadata: { previousPrice: 100, newPrice: 150 },
        });

        expect(payload).toBe(
          'evt-0011.02026-10-17T10:00:00.000ZINVENTORY_PRICE_UPDATEDusr-123INVENTORYinv-456{"previousPrice":100,"newPrice":150}'
        );
      });
    });

    describe('computeEventHash()', () => {
      it('should generate a 64-character SHA-256 hex digest', () => {
        const hash = auditService.computeEventHash(
          auditService.AUDIT_GENESIS_HASH,
          'samplePayloadString'
        );
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    describe('verifyIntegrityChain()', () => {
      it('should return valid for empty collection', async () => {
        jest.spyOn(AuditEvent, 'find').mockReturnValue({
          sort: () => ({
            lean: async () => [],
          }),
        });

        const result = await auditService.verifyIntegrityChain();
        expect(result.valid).toBe(true);
        expect(result.verifiedCount).toBe(0);

        jest.restoreAllMocks();
      });

      it('should verify valid cryptographic linkages across events', async () => {
        const date1 = new Date('2026-10-17T10:00:00.000Z');
        const payload1 = auditService.computePayloadString({
          eventId: 'evt-1',
          schemaVersion: '1.0',
          occurredAt: date1,
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actorId: 'usr-1',
          targetType: AUDIT_TARGET_TYPE.INVENTORY,
          targetId: 'inv-1',
          metadata: { delta: 5 },
        });
        const hash1 = auditService.computeEventHash(auditService.AUDIT_GENESIS_HASH, payload1);

        const date2 = new Date('2026-10-17T10:01:00.000Z');
        const payload2 = auditService.computePayloadString({
          eventId: 'evt-2',
          schemaVersion: '1.0',
          occurredAt: date2,
          action: AUDIT_ACTION.PAYMENT_COMPLETED,
          actorId: 'usr-2',
          targetType: AUDIT_TARGET_TYPE.PAYMENT,
          targetId: 'pay-2',
          metadata: { amount: 5000 },
        });
        const hash2 = auditService.computeEventHash(hash1, payload2);

        const mockEvents = [
          {
            eventId: 'evt-1',
            schemaVersion: '1.0',
            occurredAt: date1,
            action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
            actorId: 'usr-1',
            targetType: AUDIT_TARGET_TYPE.INVENTORY,
            targetId: 'inv-1',
            metadata: { delta: 5 },
            integrity: {
              eventHash: hash1,
              prevEventHash: auditService.AUDIT_GENESIS_HASH,
            },
          },
          {
            eventId: 'evt-2',
            schemaVersion: '1.0',
            occurredAt: date2,
            action: AUDIT_ACTION.PAYMENT_COMPLETED,
            actorId: 'usr-2',
            targetType: AUDIT_TARGET_TYPE.PAYMENT,
            targetId: 'pay-2',
            metadata: { amount: 5000 },
            integrity: {
              eventHash: hash2,
              prevEventHash: hash1,
            },
          },
        ];

        jest.spyOn(AuditEvent, 'find').mockReturnValue({
          sort: () => ({
            lean: async () => mockEvents,
          }),
        });

        const result = await auditService.verifyIntegrityChain();
        expect(result.valid).toBe(true);
        expect(result.verifiedCount).toBe(2);

        jest.restoreAllMocks();
      });

      it('should detect broken chain link when prevEventHash does not match previous eventHash', async () => {
        const date1 = new Date('2026-10-17T10:00:00.000Z');
        const payload1 = auditService.computePayloadString({
          eventId: 'evt-1',
          schemaVersion: '1.0',
          occurredAt: date1,
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actorId: 'usr-1',
          targetType: AUDIT_TARGET_TYPE.INVENTORY,
          targetId: 'inv-1',
          metadata: {},
        });
        const hash1 = auditService.computeEventHash(auditService.AUDIT_GENESIS_HASH, payload1);

        const mockEvents = [
          {
            eventId: 'evt-1',
            schemaVersion: '1.0',
            occurredAt: date1,
            action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
            actorId: 'usr-1',
            targetType: AUDIT_TARGET_TYPE.INVENTORY,
            targetId: 'inv-1',
            metadata: {},
            integrity: {
              eventHash: hash1,
              prevEventHash: auditService.AUDIT_GENESIS_HASH,
            },
          },
          {
            eventId: 'evt-2',
            schemaVersion: '1.0',
            occurredAt: new Date('2026-10-17T10:01:00.000Z'),
            action: AUDIT_ACTION.PAYMENT_COMPLETED,
            actorId: 'usr-2',
            targetType: AUDIT_TARGET_TYPE.PAYMENT,
            targetId: 'pay-2',
            metadata: {},
            integrity: {
              eventHash: 'hash-2-valid',
              prevEventHash: 'tampered-prev-hash-broken',
            },
          },
        ];

        jest.spyOn(AuditEvent, 'find').mockReturnValue({
          sort: () => ({
            lean: async () => mockEvents,
          }),
        });

        const result = await auditService.verifyIntegrityChain();
        expect(result.valid).toBe(false);
        expect(result.failedEventId).toBe('evt-2');
        expect(result.error).toMatch(/broken chain link/i);

        jest.restoreAllMocks();
      });

      it('should detect tampered payload when computed hash differs from eventHash', async () => {
        const date1 = new Date('2026-10-17T10:00:00.000Z');
        const mockEvents = [
          {
            eventId: 'evt-1',
            schemaVersion: '1.0',
            occurredAt: date1,
            action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
            actorId: 'usr-1',
            targetType: AUDIT_TARGET_TYPE.INVENTORY,
            targetId: 'inv-1',
            metadata: { delta: 99999 }, // Tampered metadata!
            integrity: {
              eventHash: 'forged-hash-does-not-match',
              prevEventHash: auditService.AUDIT_GENESIS_HASH,
            },
          },
        ];

        jest.spyOn(AuditEvent, 'find').mockReturnValue({
          sort: () => ({
            lean: async () => mockEvents,
          }),
        });

        const result = await auditService.verifyIntegrityChain();
        expect(result.valid).toBe(false);
        expect(result.failedEventId).toBe('evt-1');
        expect(result.error).toMatch(/hash mismatch/i);

        jest.restoreAllMocks();
      });
    });
  });
});
