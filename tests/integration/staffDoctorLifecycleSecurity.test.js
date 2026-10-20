const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Staff = require('../../src/models/staff.model');
const Doctor = require('../../src/models/doctor.model');
const Branch = require('../../src/models/branch.model');
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
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([Staff.deleteMany({}), Doctor.deleteMany({}), Branch.deleteMany({})]);

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
  });
});
