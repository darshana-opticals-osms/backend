const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Staff = require('../../src/models/staff.model');
const Doctor = require('../../src/models/doctor.model');
const Branch = require('../../src/models/branch.model');
const Admin = require('../../src/models/admin.model');
const Customer = require('../../src/models/customer.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { createAccessToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/services/auth.service');
const { listDoctors, listAllDoctorsAdmin } = require('../../src/services/doctor.service');

const PASSWORD = 'ValidPassword123!';

describe('Step 1: Staff & Doctor Model + Auth/Session Lifecycle Security', () => {
  let app;
  let gampahaBranch;
  let branchAssistantStaff;
  let assistantToken;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-integration-tests';
    process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
    process.env.STRICT_STAFF_AUTH = 'true';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    delete process.env.STRICT_STAFF_AUTH;
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      Staff.deleteMany({}),
      Doctor.deleteMany({}),
      Branch.deleteMany({}),
      Admin.deleteMany({}),
      Customer.deleteMany({}),
    ]);

    gampahaBranch = await Branch.create({
      address: 'Main Street, Gampaha',
      contactNumber: '0332223344',
    });

    const passwordHash = await hashPassword(PASSWORD);

    branchAssistantStaff = await Staff.create({
      name: 'Assistant Jane',
      email: 'jane.assistant@darshana.com',
      phone: '0771234567',
      address: 'Gampaha Road',
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      branchId: gampahaBranch._id,
      passwordHash,
      isActive: true,
    });

    assistantToken = createAccessToken({
      userId: branchAssistantStaff._id.toString(),
      role: branchAssistantStaff.role,
      branchId: branchAssistantStaff.branchId.toString(),
    });
  });

  describe('Staff & Doctor Models (isActive field)', () => {
    it('should default isActive to true on new Staff records', async () => {
      const passwordHash = await hashPassword(PASSWORD);
      const staff = await Staff.create({
        name: 'Optometrist Sam',
        email: 'sam.optom@darshana.com',
        phone: '0779876543',
        address: 'Colombo Road',
        role: ROLE_VALUES.OPTOMETRIST,
        passwordHash,
      });

      expect(staff.isActive).toBe(true);
    });

    it('should default isActive to true on new Doctor records', async () => {
      const doctor = await Doctor.create({
        name: 'Dr. Anne Perera',
        specialization: 'Retina Specialist',
      });

      expect(doctor.isActive).toBe(true);
    });
  });

  describe('Doctor Listing & Inactive Filtering (AC10)', () => {
    it('should exclude inactive doctors in listDoctors for public/appointment workflows', async () => {
      await Doctor.create({
        name: 'Dr. Active Doctor',
        specialization: 'Optometry',
        isActive: true,
      });
      await Doctor.create({
        name: 'Dr. Inactive Doctor',
        specialization: 'Pediatric',
        isActive: false,
      });

      const publicList = await listDoctors();
      expect(publicList).toHaveLength(1);
      expect(publicList[0].name).toBe('Dr. Active Doctor');
      expect(publicList[0]).not.toHaveProperty('isActive');
    });

    it('should include all doctors with isActive status in listAllDoctorsAdmin', async () => {
      await Doctor.create({
        name: 'Dr. Active Doctor',
        specialization: 'Optometry',
        isActive: true,
      });
      await Doctor.create({
        name: 'Dr. Inactive Doctor',
        specialization: 'Pediatric',
        isActive: false,
      });

      const adminList = await listAllDoctorsAdmin();
      expect(adminList).toHaveLength(2);
      const names = adminList.map((d) => d.name);
      expect(names).toContain('Dr. Active Doctor');
      expect(names).toContain('Dr. Inactive Doctor');
      const inactiveDoc = adminList.find((d) => d.name === 'Dr. Inactive Doctor');
      expect(inactiveDoc.isActive).toBe(false);
    });
  });

  describe('Staff Authentication & Session Verification (AC4, AC5, AC6)', () => {
    it('should reject login attempt if staff account is inactive (AC6)', async () => {
      await Staff.findByIdAndUpdate(branchAssistantStaff._id, { isActive: false });

      const response = await request(app).post('/api/auth/login').send({
        email: branchAssistantStaff.email,
        password: PASSWORD,
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/Account is inactive/i);
    });

    it('should reject existing authenticated requests when staff account is deactivated (AC6)', async () => {
      // Token was issued when active
      expect(assistantToken).toBeTruthy();

      // Deactivate staff in DB
      await Staff.findByIdAndUpdate(branchAssistantStaff._id, { isActive: false });

      // Attempt protected request with valid JWT
      const response = await request(app)
        .get('/api/doctor-sessions')
        .set('Authorization', `Bearer ${assistantToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/Account is inactive/i);
    });

    it('should dynamically enforce changed role from database on subsequent requests (AC4)', async () => {
      // Demote or change assistant to OPTOMETRIST in DB
      await Staff.findByIdAndUpdate(branchAssistantStaff._id, { role: ROLE_VALUES.OPTOMETRIST });

      // Endpoint /api/doctor-sessions POST requires BRANCH_ASSISTANT
      const futureStart = new Date(Date.now() + 86400000).toISOString();
      const futureEnd = new Date(Date.now() + 90000000).toISOString();
      const activeDoctor = await Doctor.create({
        name: 'Dr. Valid Doctor',
        specialization: 'Optometry',
        isActive: true,
      });

      const response = await request(app)
        .post('/api/doctor-sessions')
        .set('Authorization', `Bearer ${assistantToken}`) // Token claims BRANCH_ASSISTANT, but DB has OPTOMETRIST
        .send({
          doctorId: activeDoctor._id.toString(),
          branchId: gampahaBranch._id.toString(),
          startAt: futureStart,
          endAt: futureEnd,
          capacity: 10,
        });

      // Must be rejected with 403 Forbidden because authoritative DB role is now OPTOMETRIST
      expect(response.status).toBe(403);
    });

    it('should reject authentication when a staff identity no longer exists in database', async () => {
      // Staff record deleted from database
      await Staff.deleteOne({ _id: branchAssistantStaff._id });

      const response = await request(app)
        .get('/api/doctor-sessions')
        .set('Authorization', `Bearer ${assistantToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/Staff account not found/i);
    });

    it('should fail closed when authoritative staff verification is unavailable (db disconnected)', async () => {
      const originalReadyState = mongoose.connection._readyState;
      mongoose.connection._readyState = 0;

      try {
        const response = await request(app)
          .get('/api/doctor-sessions')
          .set('Authorization', `Bearer ${assistantToken}`);

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error.message).toMatch(
          /Authoritative staff verification is unavailable/i
        );
      } finally {
        mongoose.connection._readyState = originalReadyState;
      }
    });

    it('should reject authentication when staff token has invalid or malformed userId', async () => {
      const jwt = require('jsonwebtoken');
      const { loadConfig } = require('../../src/config/env');
      const { jwtSecret } = loadConfig();
      const malformedToken = jwt.sign(
        { userId: 'not-an-objectid', role: ROLE_VALUES.BRANCH_ASSISTANT },
        jwtSecret,
        { algorithm: 'HS256' }
      );

      const response = await request(app)
        .get('/api/doctor-sessions')
        .set('Authorization', `Bearer ${malformedToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(
        /Invalid authentication token|Invalid staff identity credentials/i
      );
    });

    it('should preserve existing Customer authentication behavior without staff verification', async () => {
      const passwordHash = await hashPassword(PASSWORD);
      const customer = await Customer.create({
        name: 'Test Customer',
        email: 'customer.auth@test.local',
        phone: '0779998888',
        role: ROLE_VALUES.CUSTOMER,
        passwordHash,
      });

      const customerToken = createAccessToken({
        userId: customer._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      const response = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should preserve existing System Admin authentication behavior without staff verification', async () => {
      const passwordHash = await hashPassword(PASSWORD);
      const admin = await Admin.create({
        name: 'Super Admin',
        email: 'super.admin@darshana.local',
        phone: '0770001111',
        role: ROLE_VALUES.SYSTEM_ADMIN,
        passwordHash,
      });

      const adminToken = createAccessToken({
        userId: admin._id.toString(),
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });

      const response = await request(app)
        .get('/api/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
