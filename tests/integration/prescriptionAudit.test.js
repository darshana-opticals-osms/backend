const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Prescription = require('../../src/models/prescription.model');
const AuditEvent = require('../../src/models/auditEvent.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
} = require('../../src/constants/audit');

let sharedPasswordHash;

const JWT_SECRET = 'prescription-audit-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({ userId, role } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

const createCustomer = async (overrides = {}) =>
  Customer.create({
    name: 'Clinical Patient',
    email: `patient-${Date.now()}-${Math.random()}@test.com`,
    phone: '+94711234567',
    passwordHash: sharedPasswordHash,
    role: ROLE_VALUES.CUSTOMER,
    ...overrides,
  });

const createStaff = async (role = ROLE_VALUES.OPTOMETRIST, overrides = {}) =>
  Staff.create({
    name: 'Dr. Silva',
    email: `optom-${Date.now()}-${Math.random()}@test.com`,
    phone: '+94711234568',
    address: '1 Clinic Road, Colombo',
    role,
    passwordHash: sharedPasswordHash,
    ...overrides,
  });

const buildPrescriptionPayload = (customerId, overrides = {}) => ({
  customerId: customerId.toString(),
  rightEye: {
    distance: { sph: -2.25, cyl: -0.75, axis: 90, va: '6/6' },
    reading: { add: 1.5, nearVa: 'N8' },
  },
  leftEye: {
    distance: { sph: -2.5, cyl: -1.0, axis: 85, va: '6/9' },
    reading: { add: 1.5, nearVa: 'N8' },
  },
  remarks: 'Patient experiences mild astigmatism. Prescribed anti-glare coating.',
  ...overrides,
});

describe('Clinical Operations - Audit Trail Integration (ADR-012 / DDP-065)', () => {
  let app;
  let originalEnv;
  let mongoServer;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    sharedPasswordHash = await bcrypt.hash('SecureStaffPass123!', 10);

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

    await Promise.all([Customer.init(), Staff.init(), Prescription.init(), AuditEvent.init()]);

    app = createApp();
  }, 60000);

  beforeEach(async () => {
    await Promise.all([
      AuditEvent.collection.deleteMany({}),
      Prescription.collection.deleteMany({}),
      Customer.collection.deleteMany({}),
      Staff.collection.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      AuditEvent.collection.deleteMany({}),
      Prescription.collection.deleteMany({}),
      Customer.collection.deleteMany({}),
      Staff.collection.deleteMany({}),
    ]);
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

  describe('Prescription Creation Audit Trail (PRESCRIPTION_RECORDED)', () => {
    it('persists an AuditEvent with non-clinical reference metadata when optometrist records a prescription (AC29-AC35)', async () => {
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const payload = buildPrescriptionPayload(customer._id);

      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      const prescriptionId = response.body.data.id || response.body.data._id;

      // Verify AuditEvent persisted in database
      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PRESCRIPTION_RECORDED,
        targetId: prescriptionId,
      });

      expect(auditEvent).not.toBeNull();
      expect(auditEvent.action).toBe(AUDIT_ACTION.PRESCRIPTION_RECORDED);
      expect(auditEvent.actorType).toBe(AUDIT_ACTOR_TYPE.USER);
      expect(auditEvent.actorId).toBe(optometrist._id.toString());
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.OPTOMETRIST);
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.PRESCRIPTION);
      expect(auditEvent.targetId).toBe(prescriptionId);
      expect(auditEvent.outcome).toBe(AUDIT_OUTCOME.SUCCESS);
      expect(auditEvent.occurredAt).toBeInstanceOf(Date);

      // Verify safe metadata structure
      expect(auditEvent.metadata).toBeDefined();
      expect(auditEvent.metadata.customerId).toBe(customer._id.toString());
      expect(auditEvent.metadata.recordedByStaffId).toBe(optometrist._id.toString());

      // Immutability: attempts to modify or delete this event must fail (AC4-AC5)
      await expect(
        AuditEvent.updateOne({ _id: auditEvent._id }, { $set: { outcome: 'FAILURE' } })
      ).rejects.toThrow(/AuditEvent records are immutable and append-only/);

      await expect(AuditEvent.deleteOne({ _id: auditEvent._id })).rejects.toThrow(
        /AuditEvent records are immutable and append-only/
      );
    });

    it('enforces strict clinical data minimization — zero clinical measurement data in audit metadata (ADR-012 AC32, AC36-AC41)', async () => {
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      expect(response.status).toBe(201);
      const prescriptionId = response.body.data.id || response.body.data._id;

      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.PRESCRIPTION_RECORDED,
        targetId: prescriptionId,
      });

      expect(auditEvent).not.toBeNull();
      const metadata = auditEvent.metadata;

      // Clinical lens parameters MUST NOT be stored in audit metadata
      expect(metadata.rightEye).toBeUndefined();
      expect(metadata.leftEye).toBeUndefined();
      expect(metadata.distance).toBeUndefined();
      expect(metadata.reading).toBeUndefined();
      expect(metadata.sph).toBeUndefined();
      expect(metadata.cyl).toBeUndefined();
      expect(metadata.axis).toBeUndefined();
      expect(metadata.va).toBeUndefined();
      expect(metadata.add).toBeUndefined();
      expect(metadata.nearVa).toBeUndefined();

      // Clinical remarks and diagnostic notes MUST NOT be stored in audit metadata
      expect(metadata.remarks).toBeUndefined();
      expect(metadata.notes).toBeUndefined();
      expect(metadata.diagnosis).toBeUndefined();

      // Sensitive credentials MUST NOT be stored
      expect(metadata.password).toBeUndefined();
      expect(metadata.token).toBeUndefined();
    });
  });
});
