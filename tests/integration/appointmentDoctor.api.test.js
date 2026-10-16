const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Staff = require('../../src/models/staff.model');
const Customer = require('../../src/models/customer.model');
const Doctor = require('../../src/models/doctor.model');
const DoctorSession = require('../../src/models/doctorSession.model');
const Appointment = require('../../src/models/appointment.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { generalLimiter } = require('../../src/middleware/rateLimiter');

const JWT_SECRET = 'appointment-doctor-jwt-secret';
const JWT_EXPIRES_IN = '1h';
const APPROVED_BRANCH_CODE = 'GAMPAHA_CENTRAL';
const syntheticHash = '$2b$12$' + 'a'.repeat(53);

const createToken = (role, userId) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });

describe('Appointment Provider Integration (AC19 - AC22, AC27, AC28)', () => {
  let app;
  let mongoServer;
  let originalEnv;
  let branch;
  let customer;
  let branchAssistant;
  let doctorA;
  let doctorB;
  let sessionA;
  let sessionB;

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
      Customer.init(),
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
      Customer.deleteMany({}),
      Doctor.deleteMany({}),
      DoctorSession.deleteMany({}),
      Appointment.deleteMany({}),
    ]);

    branch = await Branch.create({
      codeName: APPROVED_BRANCH_CODE,
      address: '12 Main Street, Gampaha',
      contactNumber: '+94 33 222 1111',
    });

    customer = await Customer.create({
      name: 'Kamal Perera',
      email: 'kamal@example.com',
      phone: '+94 71 222 3333',
      address: '15 Station Road, Gampaha',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash: syntheticHash,
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

    const startA = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const endA = new Date(startA.getTime() + 3 * 60 * 60 * 1000);
    sessionA = await DoctorSession.create({
      doctorId: doctorA._id,
      branchId: branch._id,
      startAt: startA,
      endAt: endA,
      capacity: 5,
      confirmedCount: 0,
    });

    const startB = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const endB = new Date(startB.getTime() + 3 * 60 * 60 * 1000);
    sessionB = await DoctorSession.create({
      doctorId: doctorB._id,
      branchId: branch._id,
      startAt: startB,
      endAt: endB,
      capacity: 5,
      confirmedCount: 0,
    });
  });

  afterAll(async () => {
    await Promise.all([
      Branch.deleteMany({}),
      Staff.deleteMany({}),
      Customer.deleteMany({}),
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

  describe('Customer Booking Flow (AC19 - AC21)', () => {
    it('should derive Doctor identity from session and return safe Doctor information (AC19, AC20, AC21)', async () => {
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`)
        .send({ sessionId: sessionA._id.toString() });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const appointment = response.body.data;
      expect(appointment.doctorId).toBe(doctorA._id.toString());
      expect(appointment.doctorName).toBe('Dr. Nimal Perera');
      expect(appointment.specialization).toBe('Ophthalmologist');
      expect(appointment.doctor).toEqual({
        id: doctorA._id.toString(),
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      });
      expect(appointment.position).toBe(1);

      // Verify DB persistence
      const inDb = await Appointment.findById(appointment.id);
      expect(inDb).not.toBeNull();
      expect(inDb.doctorId.toString()).toBe(doctorA._id.toString());
    });

    it('should reject client attempts to submit an arbitrary doctorId in booking payload (AC21)', async () => {
      const response = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`)
        .send({
          sessionId: sessionA._id.toString(),
          doctorId: doctorB._id.toString(),
        });

      expect(response.status).toBe(422);
    });
  });

  describe('Appointment Retrieval Responses (AC20)', () => {
    it('should display Doctor details to Customer when viewing appointment list and details', async () => {
      const bookRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`)
        .send({ sessionId: sessionA._id.toString() });

      const appointmentId = bookRes.body.data.id;

      // GET /api/appointments
      const listRes = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data[0].doctorId).toBe(doctorA._id.toString());
      expect(listRes.body.data[0].doctorName).toBe('Dr. Nimal Perera');
      expect(listRes.body.data[0].specialization).toBe('Ophthalmologist');

      // GET /api/appointments/:id
      const detailRes = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.doctorId).toBe(doctorA._id.toString());
      expect(detailRes.body.data.doctorName).toBe('Dr. Nimal Perera');
    });

    it('should display Doctor details to Staff when viewing branch appointments', async () => {
      const bookRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`)
        .send({ sessionId: sessionA._id.toString() });

      const appointmentId = bookRes.body.data.id;

      const staffListRes = await request(app)
        .get('/api/appointments')
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        );

      expect(staffListRes.status).toBe(200);
      expect(staffListRes.body.data[0].doctorId).toBe(doctorA._id.toString());
      expect(staffListRes.body.data[0].doctorName).toBe('Dr. Nimal Perera');
      expect(staffListRes.body.data[0].customer).toHaveProperty('phone');

      const staffDetailRes = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        );

      expect(staffDetailRes.status).toBe(200);
      expect(staffDetailRes.body.data.doctorId).toBe(doctorA._id.toString());
      expect(staffDetailRes.body.data.doctorName).toBe('Dr. Nimal Perera');
    });
  });

  describe('Reassignment Flow (AC22)', () => {
    it('should update appointment doctorId to the target session Doctor upon reassignment', async () => {
      // 1. Book session A (Doctor A)
      const bookRes = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`)
        .send({ sessionId: sessionA._id.toString() });

      const appointmentId = bookRes.body.data.id;
      expect(bookRes.body.data.doctorId).toBe(doctorA._id.toString());

      // 2. Branch Assistant reassigns appointment to Session B (Doctor B)
      const reassignRes = await request(app)
        .patch(`/api/appointments/${appointmentId}/reassign`)
        .set(
          'Authorization',
          `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT, branchAssistant._id)}`
        )
        .send({ sessionId: sessionB._id.toString() });

      expect(reassignRes.status).toBe(200);
      expect(reassignRes.body.success).toBe(true);

      // 3. Verify appointment now reflects Doctor B
      const getRes = await request(app)
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER, customer._id)}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.doctorId).toBe(doctorB._id.toString());
      expect(getRes.body.data.doctorName).toBe('Dr. Sunethra Silva');
      expect(getRes.body.data.specialization).toBe('Retina Specialist');

      // 4. Verify capacity counts updated properly
      const updatedSessionA = await DoctorSession.findById(sessionA._id);
      const updatedSessionB = await DoctorSession.findById(sessionB._id);
      expect(updatedSessionA.confirmedCount).toBe(0);
      expect(updatedSessionB.confirmedCount).toBe(1);
    });
  });
});
