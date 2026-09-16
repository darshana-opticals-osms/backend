const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../../src/app');
const authenticate = require('../../src/middleware/authenticate');
const errorHandler = require('../../src/middleware/errorHandler');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'controlled-ddp-008-test-secret';
const JWT_EXPIRES_IN = '1h';
const PASSWORD = 'LoginPass123!';

const createProtectedApp = () => {
  const protectedApp = express();
  protectedApp.get('/protected-test', authenticate, (req, res) => {
    res.status(200).json({ success: true, auth: req.auth });
  });
  protectedApp.use(errorHandler);
  return protectedApp;
};

describe('POST /api/auth/login', () => {
  let app;
  let protectedApp;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;
    await connectDatabase();
    app = createApp();
    protectedApp = createProtectedApp();
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  const customerPayload = {
    name: 'Login Customer',
    email: 'login.customer@example.com',
    address: '12 Main Street',
    phone: '+94711234567',
    passwordHash: null,
  };

  const seedCustomer = async (email = customerPayload.email) => {
    await Customer.create({
      ...customerPayload,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });
  };

  it('should authenticate a customer with normalized email and return JWT claims safely', async () => {
    // Arrange
    await seedCustomer();

    // Act
    const response = await request(app).post('/api/auth/login').send({
      email: '  LOGIN.CUSTOMER@EXAMPLE.COM  ',
      password: PASSWORD,
    });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      name: 'Login Customer',
      email: customerPayload.email,
      role: ROLE_VALUES.CUSTOMER,
    });
    expect(response.body.data.user).not.toHaveProperty('password');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');

    const tokenPayload = jwt.verify(response.body.data.token, JWT_SECRET, {
      algorithms: ['HS256'],
    });
    expect(tokenPayload).toMatchObject({
      userId: expect.any(String),
      role: ROLE_VALUES.CUSTOMER,
    });
    expect(tokenPayload).toHaveProperty('exp');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('should authenticate staff and admin identities using their canonical roles', async () => {
    // Arrange
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await Staff.create({
      name: 'Staff Login',
      email: 'staff.login@example.com',
      address: 'Branch Road',
      phone: '+94710000001',
      branchId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash,
    });
    await Admin.create({
      name: 'Admin Login',
      email: 'admin.login@example.com',
      phone: '+94710000002',
      passwordHash,
    });

    // Act
    const staffResponse = await request(app).post('/api/auth/login').send({
      email: 'staff.login@example.com',
      password: PASSWORD,
    });
    const adminResponse = await request(app).post('/api/auth/login').send({
      email: 'admin.login@example.com',
      password: PASSWORD,
    });

    // Assert
    expect(staffResponse.status).toBe(200);
    expect(staffResponse.body.data.user.role).toBe(ROLE_VALUES.BRANCH_MANAGER);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.data.user.role).toBe(ROLE_VALUES.SYSTEM_ADMIN);
  });

  it('should reject wrong passwords with a generic 401 and no JWT', async () => {
    // Arrange
    await seedCustomer();

    // Act
    const response = await request(app).post('/api/auth/login').send({
      email: customerPayload.email,
      password: 'WrongPassword',
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: {
        message: 'Invalid email or password.',
        code: 'UNAUTHORIZED',
      },
    });
    expect(response.body.data).toBeUndefined();
  });

  it('should reject unknown emails with the same generic authentication failure', async () => {
    // Act
    const response = await request(app).post('/api/auth/login').send({
      email: 'unknown@example.com',
      password: PASSWORD,
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid email or password.');
    expect(response.body.error.message).not.toContain('not found');
    expect(response.body.data).toBeUndefined();
  });

  it('should fail closed without a JWT when multiple identity collections match', async () => {
    // Arrange
    await seedCustomer('duplicate.identity@example.com');
    await Staff.create({
      name: 'Duplicate Staff',
      email: 'duplicate.identity@example.com',
      address: 'Branch Road',
      phone: '+94710000003',
      branchId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.INVENTORY_MANAGER,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });

    // Act
    const response = await request(app).post('/api/auth/login').send({
      email: 'duplicate.identity@example.com',
      password: PASSWORD,
    });

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Invalid email or password.');
    expect(response.body).not.toHaveProperty('data');
    expect(response.body.error.message).not.toContain('customer');
    expect(response.body.error.message).not.toContain('staff');
  });

  it('should reject invalid login fields without applying registration password rules', async () => {
    // Arrange
    await seedCustomer();

    // Act
    const missingPassword = await request(app).post('/api/auth/login').send({
      email: customerPayload.email,
    });
    const unexpectedField = await request(app).post('/api/auth/login').send({
      email: customerPayload.email,
      password: PASSWORD,
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    // Assert
    expect(missingPassword.status).toBe(422);
    expect(unexpectedField.status).toBe(422);
  });

  it('should allow a valid Bearer JWT to access a protected test route', async () => {
    // Arrange
    const token = jwt.sign(
      { userId: '507f1f77bcf86cd799439011', role: ROLE_VALUES.CUSTOMER },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN }
    );

    // Act
    const response = await request(protectedApp)
      .get('/protected-test')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.auth).toEqual({
      userId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.CUSTOMER,
    });
  });

  it.each([
    ['missing token', undefined],
    ['malformed bearer token', 'Bearer'],
    ['invalid token', 'Bearer not-a-jwt'],
  ])('should reject %s on a protected route', async (_description, authorization) => {
    // Act
    const requestBuilder = request(protectedApp).get('/protected-test');
    if (authorization) requestBuilder.set('Authorization', authorization);
    const response = await requestBuilder;

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject an expired JWT without exposing verification details', async () => {
    // Arrange
    const expiredToken = jwt.sign(
      { userId: '507f1f77bcf86cd799439011', role: ROLE_VALUES.CUSTOMER },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: -1 }
    );

    // Act
    const response = await request(protectedApp)
      .get('/protected-test')
      .set('Authorization', `Bearer ${expiredToken}`);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.body.error.message).toBe('Your token has expired! Please log in again.');
    expect(response.body.error.stack).toBeUndefined();
  });
});
