const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const AuditEvent = require('../../src/models/auditEvent.model');
const auditService = require('../../src/services/audit.service');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
} = require('../../src/constants/audit');

const JWT_SECRET = 'audit-api-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.SYSTEM_ADMIN,
  branchId = null,
} = {}) =>
  jwt.sign({ userId, role, ...(branchId ? { branchId } : {}) }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

describe('Audit Events Retrieval API (GET /api/audit-events) - ADR-012 AC53-AC58', () => {
  let mongoServer;
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET,
      JWT_EXPIRES_IN: '1h',
    });

    mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: new URL(uri).host }],
      },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });

    await AuditEvent.init();
    app = createApp();
  }, 60000);

  beforeEach(async () => {
    await AuditEvent.collection.deleteMany({});
  });

  afterAll(async () => {
    await AuditEvent.collection.deleteMany({});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      try {
        await mongoServer.stop();
      } catch {
        // Ignored MongoServerSelectionError during server shutdown
      }
    }
    process.env = originalEnv;
  }, 30000);

  const seedSampleEvents = async () => {
    const baseDate = new Date('2026-10-15T10:00:00.000Z');

    return AuditEvent.create([
      {
        action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: 'user-manager-01',
        actorRole: ROLE_VALUES.BRANCH_MANAGER,
        targetType: AUDIT_TARGET_TYPE.INVENTORY,
        targetId: 'inv-item-101',
        branchId: 'branch-colombo-1',
        outcome: AUDIT_OUTCOME.SUCCESS,
        occurredAt: new Date(baseDate.getTime() + 1000),
        metadata: { previousQuantity: 10, newQuantity: 15, adjustmentDelta: 5 },
      },
      {
        action: AUDIT_ACTION.PAYMENT_COMPLETED,
        actorType: AUDIT_ACTOR_TYPE.EXTERNAL_PROVIDER,
        actorId: 'PAYHERE_GATEWAY',
        actorRole: 'PAYHERE_GATEWAY',
        targetType: AUDIT_TARGET_TYPE.PAYMENT,
        targetId: 'pay-txn-202',
        outcome: AUDIT_OUTCOME.SUCCESS,
        occurredAt: new Date(baseDate.getTime() + 2000),
        metadata: { orderId: 'order-303', amount: 4500, currency: 'LKR' },
      },
      {
        action: AUDIT_ACTION.PRESCRIPTION_RECORDED,
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: 'user-optom-03',
        actorRole: ROLE_VALUES.OPTOMETRIST,
        targetType: AUDIT_TARGET_TYPE.PRESCRIPTION,
        targetId: 'presc-404',
        outcome: AUDIT_OUTCOME.SUCCESS,
        occurredAt: new Date(baseDate.getTime() + 3000),
        metadata: { customerId: 'cust-505', recordedByStaffId: 'user-optom-03' },
      },
    ]);
  };

  describe('RBAC Access Control (AC53, AC55)', () => {
    it('allows SYSTEM_ADMIN to retrieve audit events', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.pagination).toEqual({
        total: 3,
        page: 1,
        pages: 1,
      });
    });

    it('records an AUDIT_TRAIL_ACCESSED meta-audit event when audit events are retrieved (ADR-012 §14.2)', async () => {
      await seedSampleEvents();
      const adminToken = createToken({
        userId: '507f1f77bcf86cd799439011',
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });

      const response = await request(app)
        .get('/api/audit-events')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      const metaEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.AUDIT_TRAIL_ACCESSED,
      });
      expect(metaEvent).not.toBeNull();
      expect(metaEvent.actorId).toBe('507f1f77bcf86cd799439011');
      expect(metaEvent.actorRole).toBe(ROLE_VALUES.SYSTEM_ADMIN);
      expect(metaEvent.targetType).toBe(AUDIT_TARGET_TYPE.AUDIT_LOG);
      expect(metaEvent.targetId).toBe('AUDIT_TRAIL');
    });

    it('forbids BRANCH_MANAGER from retrieving audit events (Admin-only restriction)', async () => {
      const managerToken = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

      const response = await request(app)
        .get('/api/audit-events')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('forbids other staff roles (OPTOMETRIST, INVENTORY_MANAGER) from retrieving audit events', async () => {
      const optomToken = createToken({ role: ROLE_VALUES.OPTOMETRIST });

      const response = await request(app)
        .get('/api/audit-events')
        .set('Authorization', `Bearer ${optomToken}`);

      expect(response.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const response = await request(app).get('/api/audit-events');

      expect(response.status).toBe(401);
    });
  });

  describe('Filtering and Pagination (AC56, AC57, AC58)', () => {
    it('filters audit events by action', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({ action: AUDIT_ACTION.PAYMENT_COMPLETED })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].action).toBe(AUDIT_ACTION.PAYMENT_COMPLETED);
      expect(response.body.pagination.total).toBe(1);
    });

    it('filters audit events by targetType and targetId', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({
          targetType: AUDIT_TARGET_TYPE.INVENTORY,
          targetId: 'inv-item-101',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].targetId).toBe('inv-item-101');
    });

    it('orders results deterministically (occurredAt: -1, _id: -1)', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const events = response.body.data;
      expect(events[0].action).toBe(AUDIT_ACTION.PRESCRIPTION_RECORDED); // Most recent (base + 3000ms)
      expect(events[1].action).toBe(AUDIT_ACTION.PAYMENT_COMPLETED); // (base + 2000ms)
      expect(events[2].action).toBe(AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED); // (base + 1000ms)
    });

    it('applies pagination with page and limit correctly', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({ page: 2, limit: 1 })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].action).toBe(AUDIT_ACTION.PAYMENT_COMPLETED);
      expect(response.body.pagination).toEqual({
        total: 3,
        page: 2,
        pages: 3,
      });
    });

    it('rejects date range query exceeding 90 days with 422 Unprocessable Entity (ADR-012 §14.3)', async () => {
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({
          fromDate: '2026-01-01T00:00:00.000Z',
          toDate: '2026-05-01T00:00:00.000Z', // 120 days > 90 days
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(
        /date range exceeds maximum allowed limit of 90 days/i
      );
    });

    it('rejects invalid date query parameters with 422 Unprocessable Entity', async () => {
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({ fromDate: 'not-a-valid-date' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/invalid fromDate format/i);
    });

    it('accepts valid date query within 90 days', async () => {
      await seedSampleEvents();
      const adminToken = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

      const response = await request(app)
        .get('/api/audit-events')
        .query({
          fromDate: '2026-10-14T00:00:00.000Z',
          toDate: '2026-10-16T23:59:59.000Z',
        })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
    });
  });

  describe('Cryptographic Hash Chain Continuity & Tamper Evidence (ADR-012 §10.2, §17.2 Requirement 4)', () => {
    it('generates 10 sequential audit events with valid cryptographic linkages and detects tampering', async () => {
      // 1. Sequentially record 10 events via auditService.record()
      const recordedEvents = [];
      for (let i = 0; i < 10; i += 1) {
        const event = await auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: {
            actorType: AUDIT_ACTOR_TYPE.USER,
            actorId: `user-mgr-${i}`,
            actorRole: ROLE_VALUES.BRANCH_MANAGER,
          },
          target: {
            targetType: AUDIT_TARGET_TYPE.INVENTORY,
            targetId: `item-${i}`,
          },
          outcome: AUDIT_OUTCOME.SUCCESS,
          metadata: { sequenceIndex: i },
        });
        recordedEvents.push(event);
      }

      expect(recordedEvents).toHaveLength(10);

      // Verify the genesis event points to AUDIT_GENESIS_HASH
      expect(recordedEvents[0].integrity.prevEventHash).toBe(auditService.AUDIT_GENESIS_HASH);

      // Verify each subsequent event points to the predecessor's eventHash
      for (let i = 1; i < 10; i += 1) {
        expect(recordedEvents[i].integrity.prevEventHash).toBe(
          recordedEvents[i - 1].integrity.eventHash
        );
      }

      // 2. Run automated integrity chain verification -> must be valid
      const initialVerification = await auditService.verifyIntegrityChain();
      expect(initialVerification.valid).toBe(true);
      expect(initialVerification.verifiedCount).toBe(10);

      // 3. Simulate an adversarial direct database modification (tampering with metadata in event 5)
      // Bypasses Mongoose middleware via native collection driver to simulate direct DB intrusion
      const tamperedEvent = recordedEvents[4];
      await AuditEvent.collection.updateOne(
        { _id: tamperedEvent._id },
        { $set: { 'metadata.sequenceIndex': 999999 } }
      );

      // 4. Run automated integrity chain verification -> must detect tampering!
      const tamperedVerification = await auditService.verifyIntegrityChain();
      expect(tamperedVerification.valid).toBe(false);
      expect(tamperedVerification.failedEventId).toBe(tamperedEvent.eventId);
      expect(tamperedVerification.error).toMatch(/hash mismatch/i);
    });

    it('maintains strict linear chain continuity and prevents branching forks under concurrent writes', async () => {
      // Execute 10 simultaneous concurrent audit write operations
      const concurrentWrites = Array.from({ length: 10 }, (_, i) =>
        auditService.record({
          action: AUDIT_ACTION.INVENTORY_QUANTITY_ADJUSTED,
          actor: {
            actorType: AUDIT_ACTOR_TYPE.USER,
            actorId: `concurrent-user-${i}`,
            actorRole: ROLE_VALUES.BRANCH_MANAGER,
          },
          target: {
            targetType: AUDIT_TARGET_TYPE.INVENTORY,
            targetId: `concurrent-item-${i}`,
          },
          outcome: AUDIT_OUTCOME.SUCCESS,
          metadata: { concurrentIndex: i },
        })
      );

      const results = await Promise.all(concurrentWrites);
      expect(results).toHaveLength(10);

      // Verify that all 10 events form a single contiguous linear chain without any fork
      const chainVerification = await auditService.verifyIntegrityChain();
      expect(chainVerification.valid).toBe(true);
      expect(chainVerification.verifiedCount).toBe(10);

      // Verify all recorded events in DB have distinct prevEventHash values (no two events branch off the same predecessor)
      const allEvents = await AuditEvent.find({}).sort({ occurredAt: 1, _id: 1 }).lean();
      const prevHashes = allEvents.map((e) => e.integrity.prevEventHash);
      const uniquePrevHashes = new Set(prevHashes);
      expect(uniquePrevHashes.size).toBe(10);
    });
  });
});
