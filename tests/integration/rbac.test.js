const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const authenticate = require('../../src/middleware/authenticate');
const { authorizeRoles } = require('../../src/middleware/authorizeRoles');
const errorHandler = require('../../src/middleware/errorHandler');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Staff = require('../../src/models/staff.model');

const JWT_SECRET = 'controlled-ddp-009-test-secret';
const JWT_EXPIRES_IN = '1h';

const createTestApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/admin-test', authenticate, authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN), (_req, res) => {
    res.status(200).json({ success: true, message: 'admin access granted' });
  });

  app.get(
    '/clinical-modify',
    authenticate,
    authorizeRoles(ROLE_VALUES.OPTOMETRIST),
    (_req, res) => {
      res.status(200).json({ success: true, message: 'clinical modification allowed' });
    }
  );

  app.post(
    '/inventory-modify',
    authenticate,
    authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
    (_req, res) => {
      res.status(200).json({ success: true, message: 'inventory modification allowed' });
    }
  );

  app.get(
    '/multi-role-view',
    authenticate,
    authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.SYSTEM_ADMIN),
    (_req, res) => {
      res.status(200).json({ success: true, message: 'multi-role access granted' });
    }
  );

  app.use(errorHandler);
  return app;
};

let staffOptometrist;
let staffBranchManager;
let staffBranchAssistant;

const getStaffIdForRole = (role) => {
  if (role === ROLE_VALUES.OPTOMETRIST) return staffOptometrist?._id?.toString();
  if (role === ROLE_VALUES.BRANCH_MANAGER) return staffBranchManager?._id?.toString();
  if (role === ROLE_VALUES.BRANCH_ASSISTANT) return staffBranchAssistant?._id?.toString();
  return '507f1f77bcf86cd799439011';
};

const createToken = ({ userId, role, expiresIn = JWT_EXPIRES_IN } = {}) =>
  jwt.sign({ userId: userId || getStaffIdForRole(role), role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn,
  });

describe('RBAC integration tests', () => {
  let app;

  let originalJwtSecret;
  let originalJwtExpiresIn;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    originalJwtSecret = process.env.JWT_SECRET;
    originalJwtExpiresIn = process.env.JWT_EXPIRES_IN;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;
    await connectDatabase();

    const syntheticHash = '$2b$12$' + 'a'.repeat(53);
    [staffOptometrist, staffBranchManager, staffBranchAssistant] = await Promise.all([
      Staff.create({
        name: 'RBAC Optometrist',
        email: 'rbac.optom@darshana.local',
        phone: '0771112222',
        address: 'Main Street',
        role: ROLE_VALUES.OPTOMETRIST,
        passwordHash: syntheticHash,
        isActive: true,
      }),
      Staff.create({
        name: 'RBAC Manager',
        email: 'rbac.manager@darshana.local',
        phone: '0771112223',
        address: 'Main Street',
        role: ROLE_VALUES.BRANCH_MANAGER,
        passwordHash: syntheticHash,
        isActive: true,
      }),
      Staff.create({
        name: 'RBAC Assistant',
        email: 'rbac.assistant@darshana.local',
        phone: '0771112224',
        address: 'Main Street',
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        passwordHash: syntheticHash,
        isActive: true,
      }),
    ]);

    app = createTestApp();
  });

  afterAll(async () => {
    await Staff.deleteMany({});
    await disconnectDatabase();

    process.env.NODE_ENV = 'test';
    if (originalJwtSecret !== undefined) {
      process.env.JWT_SECRET = originalJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    if (originalJwtExpiresIn !== undefined) {
      process.env.JWT_EXPIRES_IN = originalJwtExpiresIn;
    } else {
      delete process.env.JWT_EXPIRES_IN;
    }
  });

  it('should reject a request with a missing JWT', async () => {
    // Act
    const response = await request(app).get('/admin-test');

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
  });

  it('should reject a malformed bearer token', async () => {
    // Act
    const response = await request(app).get('/admin-test').set('Authorization', 'Bearer');

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject an invalid JWT signature or claim payload', async () => {
    // Act
    const response = await request(app)
      .get('/admin-test')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ userId: 'invalid', role: 'ADMIN' }, JWT_SECRET, { algorithm: 'HS256' })}`
      );

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
  });

  it('should reject an expired JWT', async () => {
    // Arrange
    const expiredToken = createToken({
      role: ROLE_VALUES.CUSTOMER,
      expiresIn: -1,
    });

    // Act
    const response = await request(app)
      .get('/admin-test')
      .set('Authorization', `Bearer ${expiredToken}`);

    // Assert
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.body.error.message).toBe('Your token has expired! Please log in again.');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
  });

  it('should allow a valid JWT when the authenticated role is permitted', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.SYSTEM_ADMIN });

    // Act
    const response = await request(app).get('/admin-test').set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should deny a valid authenticated user whose role is not permitted', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    // Act
    const response = await request(app).get('/admin-test').set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Access forbidden');
    expect(JSON.stringify(response.body)).not.toContain('SYSTEM_ADMIN');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
  });

  it('should deny CUSTOMER access to the administrative test route', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    // Act
    const response = await request(app).get('/admin-test').set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(403);
  });

  it('should deny CUSTOMER access to the clinical modification route', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    // Act
    const response = await request(app)
      .get('/clinical-modify')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(403);
  });

  it('should deny non-OPTOMETRIST roles access to the clinical modification route', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    // Act
    const response = await request(app)
      .get('/clinical-modify')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(403);
  });

  it('should allow only OPTOMETRIST to access the clinical modification route', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.OPTOMETRIST });

    // Act
    const response = await request(app)
      .get('/clinical-modify')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should allow BRANCH_MANAGER to perform inventory stock modification', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.BRANCH_MANAGER });

    // Act
    const response = await request(app)
      .post('/inventory-modify')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should deny unauthorized roles inventory modification permission', async () => {
    const branchAssistantToken = createToken({ role: ROLE_VALUES.BRANCH_ASSISTANT });
    const customerToken = createToken({ role: ROLE_VALUES.CUSTOMER });

    const assistantResponse = await request(app)
      .post('/inventory-modify')
      .set('Authorization', `Bearer ${branchAssistantToken}`);
    const customerResponse = await request(app)
      .post('/inventory-modify')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(assistantResponse.status).toBe(403);
    expect(customerResponse.status).toBe(403);
  });

  it('should deny BRANCH_ASSISTANT access to unrelated privileged operations', async () => {
    const token = createToken({ role: ROLE_VALUES.BRANCH_ASSISTANT });

    const adminResponse = await request(app)
      .get('/admin-test')
      .set('Authorization', `Bearer ${token}`);
    const clinicalResponse = await request(app)
      .get('/clinical-modify')
      .set('Authorization', `Bearer ${token}`);
    const inventoryResponse = await request(app)
      .post('/inventory-modify')
      .set('Authorization', `Bearer ${token}`);

    expect(adminResponse.status).toBe(403);
    expect(clinicalResponse.status).toBe(403);
    expect(inventoryResponse.status).toBe(403);
  });

  it('should accept every explicitly allowed role for the multi-role endpoint', async () => {
    const branchResponse = await request(app)
      .get('/multi-role-view')
      .set('Authorization', `Bearer ${createToken({ role: ROLE_VALUES.BRANCH_MANAGER })}`);
    const adminResponse = await request(app)
      .get('/multi-role-view')
      .set('Authorization', `Bearer ${createToken({ role: ROLE_VALUES.SYSTEM_ADMIN })}`);

    expect(branchResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
  });

  it('should deny a role not listed in the multi-role endpoint', async () => {
    // Arrange
    const token = createToken({ role: ROLE_VALUES.CUSTOMER });

    // Act
    const response = await request(app)
      .get('/multi-role-view')
      .set('Authorization', `Bearer ${token}`);

    // Assert
    expect(response.status).toBe(403);
  });

  it('should return safe error payloads without exposing JWT, secret, stack traces, or extra identity data', async () => {
    const invalidToken = 'not-a-valid-jwt';
    const response = await request(app)
      .get('/admin-test')
      .set('Authorization', `Bearer ${invalidToken}`);

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain('not-a-valid-jwt');
    expect(JSON.stringify(response.body)).not.toContain(JWT_SECRET);
    expect(response.body.error.stack).toBeUndefined();
    expect(response.body.error.message).not.toContain('Authorization');
    expect(response.body.error.message).not.toContain('SECRET');
  });
});
