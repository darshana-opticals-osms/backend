const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Admin = require('../../src/models/admin.model');
const Doctor = require('../../src/models/doctor.model');
const Branch = require('../../src/models/branch.model');
const Staff = require('../../src/models/staff.model');
const DoctorSession = require('../../src/models/doctorSession.model');
const AuditEvent = require('../../src/models/auditEvent.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE } = require('../../src/constants/audit');
const { createAccessToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/services/auth.service');
const auditService = require('../../src/services/audit.service');

const PASSWORD = 'StrongPassword123!';

describe('Doctor Management APIs (/api/admin/doctors) - Issue #93', () => {
  let app;
  let adminUser;
  let adminToken;
  let doctor1;
  let doctor2;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-integration-tests';
    process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      Admin.deleteMany({}),
      Doctor.deleteMany({}),
      Branch.deleteMany({}),
      Staff.deleteMany({}),
      DoctorSession.deleteMany({}),
      AuditEvent.collection.deleteMany({}),
    ]);

    const passwordHash = await hashPassword(PASSWORD);

    adminUser = await Admin.create({
      name: 'System Admin',
      email: 'admin@darshana.com',
      phone: '0770000000',
      role: ROLE_VALUES.SYSTEM_ADMIN,
      passwordHash,
    });

    adminToken = createAccessToken({
      userId: adminUser._id.toString(),
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    doctor1 = await Doctor.create({
      name: 'Dr. Anne Perera',
      specialization: 'Glaucoma Specialist',
      isActive: true,
    });

    doctor2 = await Doctor.create({
      name: 'Dr. Charles Silva',
      specialization: 'Retina Surgeon',
      isActive: false,
    });
  });

  describe('GET /api/admin/doctors (AC7, AC11)', () => {
    it('returns all doctors with management status isActive for SYSTEM_ADMIN', async () => {
      const response = await request(app)
        .get('/api/admin/doctors')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);

      const anne = response.body.data.find((d) => d.name === 'Dr. Anne Perera');
      expect(anne).toBeDefined();
      expect(anne.specialization).toBe('Glaucoma Specialist');
      expect(anne.isActive).toBe(true);

      const charles = response.body.data.find((d) => d.name === 'Dr. Charles Silva');
      expect(charles).toBeDefined();
      expect(charles.specialization).toBe('Retina Surgeon');
      expect(charles.isActive).toBe(false);
    });

    it('filters doctors by isActive status', async () => {
      const activeRes = await request(app)
        .get('/api/admin/doctors?isActive=true')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data).toHaveLength(1);
      expect(activeRes.body.data[0].name).toBe('Dr. Anne Perera');

      const inactiveRes = await request(app)
        .get('/api/admin/doctors?isActive=false')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(inactiveRes.status).toBe(200);
      expect(inactiveRes.body.data).toHaveLength(1);
      expect(inactiveRes.body.data[0].name).toBe('Dr. Charles Silva');
    });

    it('searches doctors by name or specialization', async () => {
      const nameSearch = await request(app)
        .get('/api/admin/doctors?search=charles')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(nameSearch.status).toBe(200);
      expect(nameSearch.body.data).toHaveLength(1);
      expect(nameSearch.body.data[0].name).toBe('Dr. Charles Silva');

      const specSearch = await request(app)
        .get('/api/admin/doctors?search=glaucoma')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(specSearch.status).toBe(200);
      expect(specSearch.body.data).toHaveLength(1);
      expect(specSearch.body.data[0].name).toBe('Dr. Anne Perera');
    });

    it('returns empty list when search yields no matches', async () => {
      const response = await request(app)
        .get('/api/admin/doctors?search=nonexistentdoctor')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const response = await request(app).get('/api/admin/doctors');
      expect(response.status).toBe(401);
    });

    it.each([
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.BRANCH_ASSISTANT,
      ROLE_VALUES.OPTOMETRIST,
    ])('denies non-admin role %s with 403', async (role) => {
      const token = createAccessToken({
        userId: '507f1f77bcf86cd799439099',
        role,
      });

      const response = await request(app)
        .get('/api/admin/doctors')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /api/admin/doctors/:id (AC8, AC11, AC12, AC14)', () => {
    it('successfully edits doctor name and specialization and records audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dr. Anne Perera Updated',
          specialization: 'Pediatric Ophthalmology',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(doctor1._id.toString());
      expect(response.body.data.name).toBe('Dr. Anne Perera Updated');
      expect(response.body.data.specialization).toBe('Pediatric Ophthalmology');
      expect(response.body.data.isActive).toBe(true);

      // Verify DB persistence
      const inDb = await Doctor.findById(doctor1._id);
      expect(inDb.name).toBe('Dr. Anne Perera Updated');
      expect(inDb.specialization).toBe('Pediatric Ophthalmology');

      // Verify Audit Event
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.DOCTOR_RECORD_UPDATED,
        targetId: doctor1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.targetType).toBe(AUDIT_TARGET_TYPE.DOCTOR);
      expect(audit.actorId).toBe(adminUser._id.toString());
      expect(audit.metadata.updatedFields).toContain('name');
      expect(audit.metadata.updatedFields).toContain('specialization');
    });

    it('allows updating only name or only specialization', async () => {
      const nameOnly = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Anne OnlyName' });

      expect(nameOnly.status).toBe(200);
      expect(nameOnly.body.data.name).toBe('Dr. Anne OnlyName');
      expect(nameOnly.body.data.specialization).toBe('Glaucoma Specialist');

      const specOnly = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ specialization: 'Cornea Specialist' });

      expect(specOnly.status).toBe(200);
      expect(specOnly.body.data.specialization).toBe('Cornea Specialist');
    });

    it('returns 404 for non-existent doctor ID', async () => {
      const nonExistentId = '507f1f77bcf86cd799439099';
      const response = await request(app)
        .patch(`/api/admin/doctors/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. NonExistent' });

      expect(response.status).toBe(404);
    });

    it('returns 422 for malformed identifier', async () => {
      const response = await request(app)
        .patch('/api/admin/doctors/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Dr. Invalid' });

      expect(response.status).toBe(422);
    });

    it('rejects empty or whitespace-only name with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '   ' });

      expect(response.status).toBe(422);
    });

    it('rejects name exceeding 100 characters with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'A'.repeat(101) });

      expect(response.status).toBe(422);
    });

    it('rejects disallowed fields like email or role with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'doctor@example.com' });

      expect(response.status).toBe(422);
      expect(response.body.error.message).toMatch(/not allowed/i);
    });

    it('rejects empty update payload with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(422);
      expect(response.body.error.message).toMatch(/at least one editable field/i);
    });

    it('rejects whitespace-only specialization with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ specialization: '   ' });

      expect(response.status).toBe(422);
    });

    it('rejects specialization exceeding 100 characters with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ specialization: 'S'.repeat(101) });

      expect(response.status).toBe(422);
    });

    it('trims whitespace on doctor name and specialization updates', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: '   Dr. Trimmed Doctor   ',
          specialization: '   Cataract Specialist   ',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Dr. Trimmed Doctor');
      expect(response.body.data.specialization).toBe('Cataract Specialist');
    });
  });

  describe('PATCH /api/admin/doctors/:id/status (AC9, AC10, AC14)', () => {
    it('deactivates an active doctor and records audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isActive).toBe(false);

      const inDb = await Doctor.findById(doctor1._id);
      expect(inDb.isActive).toBe(false);

      // Verify Audit Event
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.DOCTOR_STATUS_TOGGLED,
        targetId: doctor1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.targetType).toBe(AUDIT_TARGET_TYPE.DOCTOR);
      expect(audit.metadata.previousStatus).toBe(true);
      expect(audit.metadata.newStatus).toBe(false);
    });

    it('reactivates an inactive doctor and allows active filtering', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor2._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });

      expect(response.status).toBe(200);
      expect(response.body.data.isActive).toBe(true);

      const inDb = await Doctor.findById(doctor2._id);
      expect(inDb.isActive).toBe(true);
    });

    it('accepts string status "ACTIVE" or "INACTIVE"', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor2._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(response.status).toBe(200);
      expect(response.body.data.isActive).toBe(true);
    });

    it('rejects invalid status values with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: 'UNKNOWN_STATUS' });

      expect(response.status).toBe(422);
    });

    it('returns 404 when status update targets non-existent doctor identifier', async () => {
      const nonExistentId = '507f1f77bcf86cd799439099';
      const response = await request(app)
        .patch(`/api/admin/doctors/${nonExistentId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(404);
    });

    it('returns 422 when status update targets malformed doctor identifier', async () => {
      const response = await request(app)
        .patch('/api/admin/doctors/malformed-id/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(422);
    });

    it('returns 422 when status update payload is empty', async () => {
      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(422);
    });

    it('preserves existing doctor sessions when doctor is deactivated (AC9, AC13)', async () => {
      const branch = await Branch.create({
        codeName: 'GAMPAHA',
        address: '10 Main Road, Gampaha',
        contactNumber: '0331112233',
      });

      // Existing session created when doctor was active
      const session = await DoctorSession.create({
        doctorId: doctor1._id,
        branchId: branch._id,
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 7200000),
        capacity: 10,
        confirmedCount: 2,
      });

      // Deactivate doctor
      const deactRes = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(deactRes.status).toBe(200);

      // Verify DoctorSession still exists historically intact
      const preservedSession = await DoctorSession.findById(session._id);
      expect(preservedSession).not.toBeNull();
      expect(preservedSession.doctorId.toString()).toBe(doctor1._id.toString());
      expect(preservedSession.confirmedCount).toBe(2);
    });
  });

  describe('Audit Persistence Failure and Rollback Behavior (ADR-012, AC14)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rolls back doctor update if audit write fails', async () => {
      jest
        .spyOn(auditService, 'record')
        .mockRejectedValueOnce(new Error('Audit persistence failed'));

      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Should Not Persist', specialization: 'Updated Spec' });

      expect(response.status).toBe(500);

      const doctorInDb = await Doctor.findById(doctor1._id);
      expect(doctorInDb.name).toBe(doctor1.name);
      expect(doctorInDb.specialization).toBe(doctor1.specialization);
    });

    it('rolls back doctor status toggle if audit write fails', async () => {
      jest
        .spyOn(auditService, 'record')
        .mockRejectedValueOnce(new Error('Audit persistence failed'));

      const response = await request(app)
        .patch(`/api/admin/doctors/${doctor1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(500);

      const doctorInDb = await Doctor.findById(doctor1._id);
      expect(doctorInDb.isActive).toBe(true);
    });
  });
});
