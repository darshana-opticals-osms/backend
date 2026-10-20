const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Admin = require('../../src/models/admin.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const AuditEvent = require('../../src/models/auditEvent.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { AUDIT_ACTION } = require('../../src/constants/audit');
const { createAccessToken } = require('../../src/utils/jwt');
const { hashPassword } = require('../../src/services/auth.service');

const PASSWORD = 'StrongPassword123!';

describe('Staff Management APIs (/api/admin/staff) - Issue #93', () => {
  let app;
  let adminUser;
  let adminToken;
  let branchA;
  let branchB;
  let testStaff1;
  let testStaff2;

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
    await Promise.all([
      Admin.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
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

    branchA = await Branch.create({
      codeName: 'GAMPAHA',
      address: '10 Main Road, Gampaha',
      contactNumber: '0331112233',
    });

    branchB = await Branch.create({
      codeName: 'COLOMBO',
      address: '50 Galle Road, Colombo',
      contactNumber: '0112223344',
    });

    testStaff1 = await Staff.create({
      name: 'Alice Manager',
      email: 'alice@darshana.com',
      phone: '0771112233',
      address: '10 Rose Street, Colombo',
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branchA._id,
      passwordHash,
      isActive: true,
    });

    testStaff2 = await Staff.create({
      name: 'Bob Optometrist',
      email: 'bob@darshana.com',
      phone: '0773334455',
      address: '25 Temple Road, Gampaha',
      role: ROLE_VALUES.OPTOMETRIST,
      branchId: branchB._id,
      passwordHash,
      isActive: false,
    });
  });

  describe('GET /api/admin/staff (AC1, AC11)', () => {
    it('returns paginated list of staff members for SYSTEM_ADMIN', async () => {
      const response = await request(app)
        .get('/api/admin/staff')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });

      const first = response.body.data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('email');
      expect(first).toHaveProperty('role');
      expect(first).toHaveProperty('branchId');
      expect(first).toHaveProperty('isActive');
      expect(first).not.toHaveProperty('passwordHash');
      expect(first).not.toHaveProperty('passwordResetTokenHash');
    });

    it('filters staff by role', async () => {
      const response = await request(app)
        .get('/api/admin/staff?role=BRANCH_MANAGER')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].role).toBe(ROLE_VALUES.BRANCH_MANAGER);
    });

    it('filters staff by branchId', async () => {
      const response = await request(app)
        .get(`/api/admin/staff?branchId=${branchA._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(testStaff1._id.toString());
    });

    it('filters staff by isActive boolean', async () => {
      const activeRes = await request(app)
        .get('/api/admin/staff?isActive=true')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data).toHaveLength(1);
      expect(activeRes.body.data[0].name).toBe('Alice Manager');

      const inactiveRes = await request(app)
        .get('/api/admin/staff?isActive=false')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(inactiveRes.status).toBe(200);
      expect(inactiveRes.body.data).toHaveLength(1);
      expect(inactiveRes.body.data[0].name).toBe('Bob Optometrist');
    });

    it('searches staff by name or email query', async () => {
      const response = await request(app)
        .get('/api/admin/staff?search=alice')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Alice Manager');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const response = await request(app).get('/api/admin/staff');
      expect(response.status).toBe(401);
    });

    it.each([
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.BRANCH_ASSISTANT,
      ROLE_VALUES.OPTOMETRIST,
    ])('denies non-admin role %s with 403', async (nonAdminRole) => {
      const token = createAccessToken({
        userId: '507f1f77bcf86cd799439099',
        role: nonAdminRole,
      });

      const response = await request(app)
        .get('/api/admin/staff')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/admin/staff/:id (AC2, AC11, AC12)', () => {
    it('returns staff details for valid identifier', async () => {
      const response = await request(app)
        .get(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testStaff1._id.toString());
      expect(response.body.data.email).toBe('alice@darshana.com');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('returns 404 for non-existent staff identifier', async () => {
      const nonExistentId = '507f1f77bcf86cd799439099';
      const response = await request(app)
        .get(`/api/admin/staff/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('returns 422 for malformed identifier', async () => {
      const response = await request(app)
        .get('/api/admin/staff/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(422);
    });
  });

  describe('PATCH /api/admin/staff/:id (AC3, AC12, AC14)', () => {
    it('updates allowed profile fields and logs audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Alice Updated',
          phone: '0779998877',
          address: '45 Updated Street, Kandy',
          email: 'alice.updated@darshana.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Alice Updated');
      expect(response.body.data.phone).toBe('0779998877');
      expect(response.body.data.email).toBe('alice.updated@darshana.com');

      // Verify DB persistence
      const updatedInDb = await Staff.findById(testStaff1._id);
      expect(updatedInDb.name).toBe('Alice Updated');
      expect(updatedInDb.email).toBe('alice.updated@darshana.com');

      // Verify Audit Event recorded (AC14)
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.STAFF_PROFILE_UPDATED,
        targetId: testStaff1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.actorId).toBe(adminUser._id.toString());
      expect(audit.metadata.updatedFields).toContain('name');
      expect(audit.metadata.updatedFields).toContain('email');
    });

    it('rejects duplicate email conflict with 409', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: testStaff2.email, // Already used by Bob
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/already exists/i);
    });

    it('rejects attempt to update disallowed field like role via profile update', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          role: ROLE_VALUES.OPTOMETRIST,
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toMatch(/not allowed/i);
    });

    it('rejects invalid field formats with 422', async () => {
      const badPhone = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ phone: '123' });
      expect(badPhone.status).toBe(422);

      const badEmail = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'not-an-email' });
      expect(badEmail.status).toBe(422);

      const shortAddress = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ address: 'abc' });
      expect(shortAddress.status).toBe(422);
    });
  });

  describe('PATCH /api/admin/staff/:id/role (AC4, AC12, AC14)', () => {
    it('successfully changes staff role and records audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: ROLE_VALUES.OPTOMETRIST });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.role).toBe(ROLE_VALUES.OPTOMETRIST);

      const updated = await Staff.findById(testStaff1._id);
      expect(updated.role).toBe(ROLE_VALUES.OPTOMETRIST);

      // Verify Audit Event
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.USER_ROLE_PERMISSIONS_MODIFIED,
        targetId: testStaff1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.metadata.previousRole).toBe(ROLE_VALUES.BRANCH_MANAGER);
      expect(audit.metadata.newRole).toBe(ROLE_VALUES.OPTOMETRIST);
    });

    it('rejects non-staff or invalid roles with 422', async () => {
      const adminRoleRes = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: ROLE_VALUES.SYSTEM_ADMIN });
      expect(adminRoleRes.status).toBe(422);

      const custRoleRes = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: ROLE_VALUES.CUSTOMER });
      expect(custRoleRes.status).toBe(422);

      const invalidRoleRes = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'SUPER_DOCTOR' });
      expect(invalidRoleRes.status).toBe(422);
    });
  });

  describe('PATCH /api/admin/staff/:id/branch (AC5, AC12, AC14)', () => {
    it('successfully reassigns branch and records audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/branch`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ branchId: branchB._id.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.branchId).toBe(branchB._id.toString());

      const updated = await Staff.findById(testStaff1._id);
      expect(updated.branchId.toString()).toBe(branchB._id.toString());

      // Verify Audit Event
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.STAFF_BRANCH_REASSIGNED,
        targetId: testStaff1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.metadata.previousBranchId).toBe(branchA._id.toString());
      expect(audit.metadata.newBranchId).toBe(branchB._id.toString());
    });

    it('allows unassigning branch by sending branchId: null', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/branch`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ branchId: null });

      expect(response.status).toBe(200);
      expect(response.body.data.branchId).toBeNull();
    });

    it('returns 404 when target branch does not exist', async () => {
      const nonExistentBranchId = '507f1f77bcf86cd799439088';
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/branch`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ branchId: nonExistentBranchId });

      expect(response.status).toBe(404);
      expect(response.body.error.message).toMatch(/branch not found/i);
    });
  });

  describe('PATCH /api/admin/staff/:id/status (AC6, AC12, AC14)', () => {
    it('deactivates an active staff account and records audit event', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isActive).toBe(false);

      const inDb = await Staff.findById(testStaff1._id);
      expect(inDb.isActive).toBe(false);

      // Verify Audit Event
      const audit = await AuditEvent.findOne({
        action: AUDIT_ACTION.USER_ACCOUNT_STATUS_TOGGLED,
        targetId: testStaff1._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.metadata.previousStatus).toBe(true);
      expect(audit.metadata.newStatus).toBe(false);
    });

    it('reactivates an inactive staff account', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff2._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isActive).toBe(true);

      const inDb = await Staff.findById(testStaff2._id);
      expect(inDb.isActive).toBe(true);
    });

    it('accepts string status "ACTIVE" or "INACTIVE"', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff2._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(response.status).toBe(200);
      expect(response.body.data.isActive).toBe(true);
    });

    it('rejects invalid status value with 422', async () => {
      const response = await request(app)
        .patch(`/api/admin/staff/${testStaff1._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: 'INVALID_STATUS' });

      expect(response.status).toBe(422);
    });
  });
});
