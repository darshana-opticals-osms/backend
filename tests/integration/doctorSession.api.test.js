const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Staff = require('../../src/models/staff.model');
const Doctor = require('../../src/models/doctor.model');
const DoctorSession = require('../../src/models/doctorSession.model');
const Appointment = require('../../src/models/appointment.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { generalLimiter } = require('../../src/middleware/rateLimiter');

const JWT_SECRET = 'session-test-jwt-secret';
const JWT_EXPIRES_IN = '1h';
const APPROVED_BRANCH_CODE = 'GAMPAHA_CENTRAL';
const syntheticHash = '$2b$12$' + 'a'.repeat(53);

const createToken = (role, userId) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });

describe('DoctorSession Provider Integration (AC14 - AC18, AC25, AC26)', () => {
  let app;
  let mongoServer;
  let originalEnv;
  let branch;
  let branchAssistant;
  let doctorA;
  let doctorB;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

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

    await Promise.all([
      Branch.init(),
      Staff.init(),
      Doctor.init(),
      DoctorSession.init(),
      Appointment.init(),
    ]);

    app = createApp();
  }, 30000);

  beforeEach(async () => {
    generalLimiter.resetKey('::ffff:127.0.0.1');
    generalLimiter.resetKey('127.0.0.1');

    await Promise.all([
      Branch.deleteMany({}),
      Staff.deleteMany({}),
      Doctor.deleteMany({}),
      DoctorSession.deleteMany({}),
      Appointment.deleteMany({}),
    ]);

    branch = await Branch.create({
      codeName: APPROVED_BRANCH_CODE,
      address: '12 Main Street, Gampaha',
      contactNumber: '+94 33 222 1111',
    });

    branchAssistant = await Staff.create({
      name: 'Assistant Gampaha',
      email: 'assistant@darshanaopticals.local',
      phone: '+94 77 100 0001',
      address: '12 Main Street, Gampaha',
      branchId: branch._id,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      passwordHash: syntheticHash,
    });

    doctorA = await Doctor.create({
      name: 'Dr. Nimal Perera',
      specialization: 'Ophthalmologist',
    });

    doctorB = await Doctor.create({
      name: 'Dr. Sunethra Silva',
      specialization: 'Retina Specialist',
    });
  });

  afterAll(async () => {
    await Promise.all([
      Branch.deleteMany({}),
      Staff.deleteMany({}),
      Doctor.deleteMany({}),
      DoctorSession.deleteMany({}),
      Appointment.deleteMany({}),
    ]);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    try {
      if (mongoServer) await mongoServer.stop();
    } catch {
      void 0;
    }
    process.env = originalEnv;
  }, 30000);

  describe('POST /api/doctor-sessions (AC14, AC15, AC17, AC18)', () => {
    it('should allow Branch Assistant to create a session referencing a valid Doctor (AC14, AC15, AC18)', async () => {
      const payload = {
        doctorId: doctorA._id.toString(),
        branchId: branch._id.toString(),
        startAt: '2026-11-20T09:00:00Z',
        endAt: '2026-11-20T12:00:00Z',
        capacity: 10,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const session = response.body.data;
      expect(session.doctorId).toBe(doctorA._id.toString());
      expect(session.doctorName).toBe('Dr. Nimal Perera');
      expect(session.specialization).toBe('Ophthalmologist');
      expect(session.doctor).toEqual({
        id: doctorA._id.toString(),
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      });
      expect(session.capacity).toBe(10);
      expect(session.confirmedCount).toBe(0);
      expect(session.remainingCapacity).toBe(10);

      // Verify DB persistence
      const inDb = await DoctorSession.findById(session.id);
      expect(inDb).not.toBeNull();
      expect(inDb.doctorId.toString()).toBe(doctorA._id.toString());
    });

    it('should reject nonexistent doctorId with 404 (AC15)', async () => {
      const nonExistentId = '507f1f77bcf86cd799439099';
      const payload = {
        doctorId: nonExistentId,
        branchId: branch._id.toString(),
        startAt: '2026-11-20T09:00:00Z',
        endAt: '2026-11-20T12:00:00Z',
        capacity: 10,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/doctor not found/i);
    });

    it('should reject malformed doctorId with 422 (AC15)', async () => {
      const payload = {
        doctorId: 'invalid-id-format',
        branchId: branch._id.toString(),
        startAt: '2026-11-20T09:00:00Z',
        endAt: '2026-11-20T12:00:00Z',
        capacity: 10,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(422);
    });

    it('should reject Staff ID as doctorId if not in Doctor collection (AC15)', async () => {
      const optometrist = await Staff.create({
        name: 'Optometrist User',
        email: 'opto@darshanaopticals.local',
        phone: '+94 77 100 0009',
        address: '12 Main Street, Gampaha',
        branchId: branch._id,
        role: ROLE_VALUES.OPTOMETRIST,
        passwordHash: syntheticHash,
      });

      const payload = {
        doctorId: optometrist._id.toString(),
        branchId: branch._id.toString(),
        startAt: '2026-11-20T09:00:00Z',
        endAt: '2026-11-20T12:00:00Z',
        capacity: 10,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.error.message).toMatch(/doctor not found/i);
    });

    it('should reject overlapping session for the same Doctor (AC17)', async () => {
      // Create first session: 09:00 - 12:00
      await DoctorSession.create({
        doctorId: doctorA._id,
        branchId: branch._id,
        startAt: new Date('2026-11-20T09:00:00Z'),
        endAt: new Date('2026-11-20T12:00:00Z'),
        capacity: 10,
      });

      // Attempt overlapping session for same doctor: 11:00 - 14:00
      const payload = {
        doctorId: doctorA._id.toString(),
        branchId: branch._id.toString(),
        startAt: '2026-11-20T11:00:00Z',
        endAt: '2026-11-20T14:00:00Z',
        capacity: 5,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('OVERLAPPING_SESSION');
    });

    it('should permit concurrent overlapping sessions for DIFFERENT Doctors (AC17)', async () => {
      // Doctor A: 09:00 - 12:00
      await DoctorSession.create({
        doctorId: doctorA._id,
        branchId: branch._id,
        startAt: new Date('2026-11-20T09:00:00Z'),
        endAt: new Date('2026-11-20T12:00:00Z'),
        capacity: 10,
      });

      // Doctor B: 10:00 - 13:00 (overlapping time, but different doctor)
      const payload = {
        doctorId: doctorB._id.toString(),
        branchId: branch._id.toString(),
        startAt: '2026-11-20T10:00:00Z',
        endAt: '2026-11-20T13:00:00Z',
        capacity: 8,
      };

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.data.doctorId).toBe(doctorB._id.toString());
      expect(response.body.data.doctorName).toBe('Dr. Sunethra Silva');
    });
  });

  describe('PATCH /api/doctor-sessions/:id (AC16)', () => {
    it('should allow Branch Assistant to update doctorId and validate new Doctor (AC16)', async () => {
      const session = await DoctorSession.create({
        doctorId: doctorA._id,
        branchId: branch._id,
        startAt: new Date('2026-11-20T09:00:00Z'),
        endAt: new Date('2026-11-20T12:00:00Z'),
        capacity: 10,
      });

      const response = await request(app)
        .patch(`/api/doctor-sessions/${session._id}`)
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send({ doctorId: doctorB._id.toString() });

      expect(response.status).toBe(200);
      expect(response.body.data.doctorId).toBe(doctorB._id.toString());
      expect(response.body.data.doctorName).toBe('Dr. Sunethra Silva');
      expect(response.body.data.specialization).toBe('Retina Specialist');

      const updatedInDb = await DoctorSession.findById(session._id);
      expect(updatedInDb.doctorId.toString()).toBe(doctorB._id.toString());
    });
  });

  describe('GET /api/doctor-sessions/available (AC18)', () => {
    it('should return available sessions populated with safe Doctor display data (AC18)', async () => {
      const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      await DoctorSession.create({
        doctorId: doctorA._id,
        branchId: branch._id,
        startAt: futureStart,
        endAt: futureEnd,
        capacity: 10,
        confirmedCount: 2,
      });

      const response = await request(app)
        .get('/api/doctor-sessions/available')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.CUSTOMER, '507f1f77bcf86cd799439011')}`
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);

      const session = response.body.data[0];
      expect(session.doctorId).toBe(doctorA._id.toString());
      expect(session.doctorName).toBe('Dr. Nimal Perera');
      expect(session.specialization).toBe('Ophthalmologist');
      expect(session.doctor).toEqual({
        id: doctorA._id.toString(),
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      });
      expect(session.remainingCapacity).toBe(8);
    });
  });
});
