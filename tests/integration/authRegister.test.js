const bcrypt = require('bcrypt');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const validBcryptHash = bcrypt.hashSync('placeholderPassword', 12);

describe('POST /api/auth/register', () => {
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await disconnectDatabase();
  });

  it('should create a customer account and return a safe response given valid registration data', async () => {
    // Arrange
    const payload = {
      name: '  Alice Customer  ',
      email: '  ALICE.CUSTOMER@EXAMPLE.COM  ',
      address: '  12 Main Street, Colombo  ',
      phone: '+94711234567',
      password: 'StrongPass123!',
    };

    // Act
    const response = await request(app).post('/api/auth/register').send(payload);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'Alice Customer',
      email: 'alice.customer@example.com',
      address: '12 Main Street, Colombo',
      phone: '+94711234567',
      role: ROLE_VALUES.CUSTOMER,
    });
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('token');
    expect(response.body.data).not.toHaveProperty('jwt');

    const customer = await Customer.findOne({ email: 'alice.customer@example.com' })
      .select('+passwordHash')
      .lean();
    expect(customer).toBeTruthy();
    expect(customer.role).toBe(ROLE_VALUES.CUSTOMER);
    expect(customer.passwordHash).toBeTruthy();
    expect(customer.passwordHash).not.toBe(payload.password);
    expect(customer.passwordHash.startsWith('$2')).toBe(true);
    expect(response.body.data).not.toHaveProperty('token');
    expect(response.body.data).not.toHaveProperty('accessToken');
    expect(response.body.data).not.toHaveProperty('refreshToken');
    expect(response.body.data).not.toHaveProperty('jwt');

    const isMatch = await bcrypt.compare(payload.password, customer.passwordHash);
    expect(isMatch).toBe(true);
    expect(customer.passwordHash).not.toBe(payload.password);
  });

  it('should create a customer account successfully when optional address field is omitted', async () => {
    // Arrange
    const payloadWithoutAddress = {
      name: 'Bob Customer',
      email: 'bob.noaddress@example.com',
      phone: '+94719876543',
      password: 'StrongPass123!',
    };

    // Act
    const response = await request(app).post('/api/auth/register').send(payloadWithoutAddress);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      name: 'Bob Customer',
      email: 'bob.noaddress@example.com',
      address: '',
      phone: '+94719876543',
      role: ROLE_VALUES.CUSTOMER,
    });

    const customer = await Customer.findOne({ email: 'bob.noaddress@example.com' }).lean();
    expect(customer).toBeTruthy();
    expect(customer.address).toBe('');
  });

  it('should reject duplicate customer emails with 409 conflict', async () => {
    // Arrange
    const payload = {
      name: 'Existing Customer',
      email: 'existing@example.com',
      address: '123 Market Street',
      phone: '+94710000001',
      password: 'StrongPass123!',
    };
    await Customer.create({
      ...payload,
      email: 'existing@example.com',
      passwordHash: validBcryptHash,
    });

    // Act
    const response = await request(app).post('/api/auth/register').send(payload);

    // Assert
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain('already exists');
    expect(response.body).not.toHaveProperty('data');
    expect(response.body.error).not.toHaveProperty('password');
    expect(response.body.error).not.toHaveProperty('passwordHash');
    expect(await Customer.countDocuments({ email: 'existing@example.com' })).toBe(1);
  });

  it('should reject case-insensitive duplicate customer emails with 409 conflict', async () => {
    // Arrange
    const payload = {
      name: 'Customer Case Test',
      email: 'CUSTOMER@EXAMPLE.COM',
      address: '123 Market Street',
      phone: '+94710000011',
      password: 'StrongPass123!',
    };
    await Customer.create({
      name: 'Existing Customer',
      email: 'customer@example.com',
      address: '123 Market Street',
      phone: '+94710000012',
      passwordHash: validBcryptHash,
    });

    // Act
    const response = await request(app).post('/api/auth/register').send(payload);

    // Assert
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain('already exists');
    expect(response.body.error).not.toHaveProperty('password');
    expect(response.body.error).not.toHaveProperty('passwordHash');
    expect(await Customer.countDocuments({ email: 'customer@example.com' })).toBe(1);
  });

  it('should reject whitespace-variant duplicate customer emails with 409 conflict', async () => {
    // Arrange
    const payload = {
      name: 'Customer Whitespace Test',
      email: '  customer@example.com  ',
      address: '456 Market Street',
      phone: '+94710000013',
      password: 'StrongPass123!',
    };
    await Customer.create({
      name: 'Existing Customer',
      email: 'customer@example.com',
      address: '123 Market Street',
      phone: '+94710000014',
      passwordHash: validBcryptHash,
    });

    // Act
    const response = await request(app).post('/api/auth/register').send(payload);

    // Assert
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain('already exists');
    expect(response.body.error).not.toHaveProperty('password');
    expect(response.body.error).not.toHaveProperty('passwordHash');
    expect(await Customer.countDocuments({ email: 'customer@example.com' })).toBe(1);
  });

  it('should reject duplicate staff emails with 409 conflict', async () => {
    // Arrange
    await Staff.create({
      name: 'Staff User',
      email: 'staff@example.com',
      phone: '+94710000002',
      address: 'Branch Road',
      branchId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash: validBcryptHash,
    });

    // Act
    const response = await request(app).post('/api/auth/register').send({
      name: 'New Customer',
      email: 'staff@example.com',
      address: '123 Market Street',
      phone: '+94710000003',
      password: 'StrongPass123!',
    });

    // Assert
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('already exists');
  });

  it('should reject duplicate admin emails with 409 conflict', async () => {
    // Arrange
    await Admin.create({
      name: 'Admin User',
      email: 'admin@example.com',
      phone: '+94710000004',
      passwordHash: validBcryptHash,
    });

    // Act
    const response = await request(app).post('/api/auth/register').send({
      name: 'New Customer',
      email: 'admin@example.com',
      address: '123 Market Street',
      phone: '+94710000005',
      password: 'StrongPass123!',
    });

    // Assert
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('already exists');
  });

  it('should reject attempts to submit a privileged role field', async () => {
    // Act
    const response = await request(app).post('/api/auth/register').send({
      name: 'Customer',
      email: 'role.test@example.com',
      address: 'Test Street',
      phone: '+94710000006',
      password: 'StrongPass123!',
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    // Assert
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('Role');
    expect(await Customer.countDocuments({ email: 'role.test@example.com' })).toBe(0);
  });

  it('should reject attempts to submit passwordHash or other disallowed fields', async () => {
    // Act
    const response = await request(app).post('/api/auth/register').send({
      name: 'Customer',
      email: 'hash.test@example.com',
      address: 'Test Street',
      phone: '+94710000007',
      password: 'StrongPass123!',
      passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    });

    // Assert
    expect(response.status).toBe(422);
    expect(await Customer.countDocuments({ email: 'hash.test@example.com' })).toBe(0);
  });

  it('should reject invalid payloads and create no customer record', async () => {
    // Act
    const response = await request(app).post('/api/auth/register').send({
      name: '',
      email: 'bad-email',
      address: 'Test Street',
      phone: 'abc',
      password: 'short',
    });

    // Assert
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Customer.countDocuments()).toBe(0);
  });
});
