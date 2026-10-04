const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Admin = require('../../src/models/admin.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const { ROLE_VALUES, STAFF_ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'controlled-ddp-067-test-secret';
const PASSWORD = 'StrongPass123!';
const VALID_BRANCH_ID = '64d4a3ff3baf9d2b8a33d1a1';

const createToken = (role) =>
  jwt.sign({ userId: '507f1f77bcf86cd799439011', role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

const buildPayload = (overrides = {}) => ({
  name: 'Jordan Staff',
  email: 'jordan.staff@example.com',
  phone: '+94711234567',
  address: '12 Main Street, Colombo',
  role: ROLE_VALUES.OPTOMETRIST,
  password: PASSWORD,
  ...overrides,
});

describe('POST /api/admin/staff', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([
      Admin.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      Admin.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
    ]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  it.each(STAFF_ROLE_VALUES)(
    'should provision a safe account for canonical staff role %s without a branch',
    async (role) => {
      const normalizedEmail = `staff.${role.toLowerCase()}@example.com`;
      const response = await request(app)
        .post('/api/admin/staff')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send(
          buildPayload({
            name: '  Jordan Staff  ',
            email: `  ${normalizedEmail.toUpperCase()}  `,
            role,
          })
        );

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        id: expect.any(String),
        name: 'Jordan Staff',
        email: normalizedEmail,
        phone: '+94711234567',
        address: '12 Main Street, Colombo',
        role,
        branchId: null,
      });
      expect(response.body.data).not.toHaveProperty('password');
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(response.body.data).not.toHaveProperty('token');

      const staff = await Staff.findOne({ email: normalizedEmail }).select('+passwordHash').lean();
      expect(staff).toBeTruthy();
      expect(staff.role).toBe(role);
      expect(staff.branchId).toBeNull();
      expect(staff.passwordHash).not.toBe(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, staff.passwordHash)).toBe(true);
      expect(Object.keys(staff).sort()).toEqual(
        [
          '__v',
          '_id',
          'address',
          'branchId',
          'createdAt',
          'email',
          'name',
          'passwordHash',
          'phone',
          'role',
          'updatedAt',
        ].sort()
      );
    }
  );

  it('should persist an optional branchId only when it identifies an existing Branch', async () => {
    const branch = await Branch.create({
      address: '100 Galle Road, Colombo 03',
      contactNumber: '+94 11 250 0000',
    });

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ email: 'branch.staff@example.com', branchId: branch._id.toString() }));

    expect(response.status).toBe(201);
    expect(response.body.data.branchId).toBe(branch._id.toString());
    const staff = await Staff.findOne({ email: 'branch.staff@example.com' });
    expect(staff.branchId.toString()).toBe(branch._id.toString());
  });

  it('should allow the provisioned Staff identity to use the existing login flow', async () => {
    const createResponse = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ email: 'staff.login@example.com', role: ROLE_VALUES.BRANCH_MANAGER }));

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: 'staff.login@example.com',
      password: PASSWORD,
    });

    expect(createResponse.status).toBe(201);
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.user).toMatchObject({
      id: createResponse.body.data.id,
      email: 'staff.login@example.com',
      role: ROLE_VALUES.BRANCH_MANAGER,
    });
    expect(loginResponse.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('should reject requests without authentication with 401', async () => {
    const response = await request(app).post('/api/admin/staff').send(buildPayload());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each([ROLE_VALUES.CUSTOMER, ...STAFF_ROLE_VALUES])(
    'should deny direct HTTP provisioning requests from %s with 403',
    async (role) => {
      const response = await request(app)
        .post('/api/admin/staff')
        .set('Authorization', `Bearer ${createToken(role)}`)
        .send(buildPayload());

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(await Staff.countDocuments()).toBe(0);
    }
  );

  it.each([
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.CUSTOMER,
    'ADMIN',
    'inventory_manager',
    'UNRECOGNIZED_ROLE',
  ])('should reject non-staff role value %s', async (role) => {
    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ role }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Staff.countDocuments()).toBe(0);
  });

  it.each([
    'passwordHash',
    'permissions',
    'isAdmin',
    'admin',
    'token',
    'jwt',
    'accessToken',
    'refreshToken',
    'authorization',
    'unknownField',
  ])('should reject unsupported or security-sensitive field %s', async (field) => {
    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ [field]: 'must-not-be-accepted' }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Staff.countDocuments()).toBe(0);
  });

  it.each(['not-an-object-id', '', null, 123])(
    'should reject malformed branchId value %p',
    async (branchId) => {
      const response = await request(app)
        .post('/api/admin/staff')
        .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
        .send(buildPayload({ branchId }));

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(await Staff.countDocuments()).toBe(0);
    }
  );

  it('should reject a well-formed branchId when no Branch exists', async () => {
    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ branchId: VALID_BRANCH_ID }));

    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('existing branch');
    expect(await Staff.countDocuments()).toBe(0);
  });

  it.each([
    [
      'Customer',
      async (email) =>
        Customer.create({
          name: 'Existing Customer',
          email,
          phone: '+94710000001',
          address: 'Customer Road',
          passwordHash: await bcrypt.hash(PASSWORD, 12),
        }),
    ],
    [
      'Staff',
      async (email) =>
        Staff.create({
          name: 'Existing Staff',
          email,
          phone: '+94710000002',
          address: 'Staff Road',
          role: ROLE_VALUES.OPTOMETRIST,
          passwordHash: await bcrypt.hash(PASSWORD, 12),
        }),
    ],
    [
      'Admin',
      async (email) =>
        Admin.create({
          name: 'Existing Admin',
          email,
          phone: '+94710000003',
          passwordHash: await bcrypt.hash(PASSWORD, 12),
        }),
    ],
  ])('should reject an email already used by a %s identity', async (_identity, seedIdentity) => {
    await seedIdentity('duplicate@example.com');

    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ email: '  DUPLICATE@EXAMPLE.COM  ' }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it.each([
    ['email', 'not-an-email'],
    ['phone', 'not-a-phone'],
    ['password', 'short'],
    ['name', '   '],
    ['address', '   '],
  ])('should reject invalid %s values with 422', async (field, value) => {
    const response = await request(app)
      .post('/api/admin/staff')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`)
      .send(buildPayload({ [field]: value }));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Staff.countDocuments()).toBe(0);
  });
});
