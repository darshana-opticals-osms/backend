const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Doctor = require('../../src/models/doctor.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const Customer = require('../../src/models/customer.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'doctor-api-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = (role, userId = '507f1f77bcf86cd799439011') =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });

describe('Doctor Directory API (Integration tests)', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([
      Doctor.deleteMany({}),
      Staff.deleteMany({}),
      Admin.deleteMany({}),
      Customer.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      Doctor.deleteMany({}),
      Staff.deleteMany({}),
      Admin.deleteMany({}),
      Customer.deleteMany({}),
    ]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  describe('POST /api/doctors (AC5 - AC8, AC29 - AC32)', () => {
    it('should allow SYSTEM_ADMIN to create a doctor and return safe DTO (AC5, AC6, AC7)', async () => {
      const payload = {
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      };

      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        id: expect.any(String),
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      });

      // Verify persisted in DB
      const persisted = await Doctor.findById(response.body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted.name).toBe('Dr. Nimal Perera');
      expect(persisted.specialization).toBe('Ophthalmologist');

      // Verify AC4: No Staff/Admin/Customer login/identity record was created
      const [staffCount, adminCount, customerCount] = await Promise.all([
        Staff.countDocuments({}),
        Admin.countDocuments({}),
        Customer.countDocuments({}),
      ]);
      expect(staffCount).toBe(0);
      expect(adminCount).toBe(0);
      expect(customerCount).toBe(0);
    });

    it('should reject unauthenticated request with 401', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .send({ name: 'Dr. Test', specialization: 'Surgeon' });

      expect(response.status).toBe(401);
    });

    it.each([
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.BRANCH_ASSISTANT,
      ROLE_VALUES.OPTOMETRIST,
    ])('should deny non-admin role %s with 403 (AC8)', async (role) => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(role)}`)
        .send({ name: 'Dr. Test', specialization: 'Surgeon' });

      expect(response.status).toBe(403);
    });

    it('should reject payload with unsupported/extra fields (AC6)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({
          name: 'Dr. Nimal Perera',
          specialization: 'Ophthalmologist',
          role: 'DOCTOR',
          password: 'password123',
          staffId: '507f1f77bcf86cd799439011',
          branchId: '507f1f77bcf86cd799439012',
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing name (AC2)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ specialization: 'Ophthalmologist' });

      expect(response.status).toBe(422);
    });

    it('should reject whitespace-only name (AC2)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: '    ', specialization: 'Ophthalmologist' });

      expect(response.status).toBe(422);
    });

    it('should reject non-string name (AC2)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 12345, specialization: 'Ophthalmologist' });

      expect(response.status).toBe(422);
    });

    it('should reject name exceeding 100 characters (AC2)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 'Dr. ' + 'x'.repeat(100), specialization: 'Ophthalmologist' });

      expect(response.status).toBe(422);
    });

    it('should reject missing specialization (AC3)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 'Dr. Nimal Perera' });

      expect(response.status).toBe(422);
    });

    it('should reject whitespace-only specialization (AC3)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 'Dr. Nimal Perera', specialization: '    ' });

      expect(response.status).toBe(422);
    });

    it('should reject non-string specialization (AC3)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 'Dr. Nimal Perera', specialization: ['Ophthalmologist'] });

      expect(response.status).toBe(422);
    });

    it('should reject specialization exceeding 100 characters (AC3)', async () => {
      const response = await request(app)
        .post('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send({ name: 'Dr. Nimal Perera', specialization: 'x'.repeat(101) });

      expect(response.status).toBe(422);
    });
  });

  describe('GET /api/doctors (AC9 - AC13, AC29)', () => {
    it('should return empty array with 200 when no doctors exist (AC13)', async () => {
      const response = await request(app)
        .get('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER)}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: [],
      });
    });

    it('should reject unauthenticated request with 401 (AC10, AC29)', async () => {
      const response = await request(app).get('/api/doctors');
      expect(response.status).toBe(401);
    });

    it.each([
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.SYSTEM_ADMIN,
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.BRANCH_ASSISTANT,
      ROLE_VALUES.OPTOMETRIST,
    ])('should allow canonical role %s to retrieve doctors (AC10)', async (role) => {
      await Doctor.create({ name: 'Dr. Silva', specialization: 'Optometrist' });

      const response = await request(app)
        .get('/api/doctors')
        .set('Authorization', `Bearer ${createToken(role)}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].name).toBe('Dr. Silva');
    });

    it('should return safe fields only and use deterministic ordering (AC11, AC12)', async () => {
      await Doctor.create({ name: 'Dr. Carol White', specialization: 'Surgeon' });
      const docA2 = await Doctor.create({ name: 'Dr. Alice Brown', specialization: 'Pediatric' });
      const docA1 = await Doctor.create({
        name: 'Dr. Alice Brown',
        specialization: 'Ophthalmologist',
      });
      await Doctor.create({ name: 'Dr. Bob Green', specialization: 'Retina Specialist' });

      const response = await request(app)
        .get('/api/doctors')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.BRANCH_ASSISTANT)}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const data = response.body.data;
      expect(data).toHaveLength(4);

      // Verify minimal fields (AC11)
      data.forEach((item) => {
        expect(Object.keys(item).sort()).toEqual(['id', 'name', 'specialization']);
      });

      // Verify deterministic ordering: name asc, _id asc (AC12)
      // Both Alice Browns sort first by name; then tie broken by _id asc
      const aliceIdsInDb = [docA2, docA1].sort((a, b) => (a._id < b._id ? -1 : 1)).map((d) => d._id.toString());
      expect(data[0].id).toBe(aliceIdsInDb[0]);
      expect(data[1].id).toBe(aliceIdsInDb[1]);
      expect(data[2].name).toBe('Dr. Bob Green');
      expect(data[3].name).toBe('Dr. Carol White');
    });
  });
});
