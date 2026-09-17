const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'customer-profile-test-secret';
const JWT_EXPIRES_IN = '1h';
const PASSWORD = 'StrongPass123!';

const createToken = ({ userId, role = ROLE_VALUES.CUSTOMER, expiresIn = JWT_EXPIRES_IN } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn,
  });

const createCustomer = async (overrides = {}) => {
  const base = {
    name: 'Customer A',
    email: 'customer.a@example.com',
    address: '12 Main Street, Colombo',
    phone: '+94711234567',
    passwordHash: await bcrypt.hash(PASSWORD, 12),
  };

  return Customer.create({
    ...base,
    ...overrides,
  });
};

describe('Customer profile self-service API', () => {
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
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  it('should return the authenticated customer profile with safe fields', async () => {
    const customer = await createCustomer();
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .get('/api/profile/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      id: customer._id.toString(),
      name: customer.name,
      email: customer.email,
      address: customer.address,
      phone: customer.phone,
      role: ROLE_VALUES.CUSTOMER,
    });
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('__v');
    expect(response.body.data).not.toHaveProperty('permissions');
  });

  it('should not allow a customer to retrieve another customer profile via a misleading query parameter', async () => {
    const customerA = await createCustomer({ name: 'Customer A', email: 'customer.a@example.com' });
    const customerB = await createCustomer({
      name: 'Customer B',
      email: 'customer.b@example.com',
      address: '22 Pine Road, Kandy',
      phone: '+94776543210',
    });

    const tokenA = createToken({ userId: customerA._id.toString() });

    const response = await request(app)
      .get('/api/profile/me?customerId=' + customerB._id.toString())
      .set('Authorization', `Bearer ${tokenA}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(customerA._id.toString());
    expect(response.body.data.id).not.toBe(customerB._id.toString());
  });

  it('should update only allowed fields and persist the change on the authenticated customer', async () => {
    const customer = await createCustomer({ email: 'customer.update@example.com' });
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Customer Name',
        phone: '+94770000000',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: customer._id.toString(),
      name: 'Updated Customer Name',
      phone: '+94770000000',
      email: customer.email,
      address: customer.address,
      role: ROLE_VALUES.CUSTOMER,
    });

    const storedCustomer = await Customer.findById(customer._id);
    expect(storedCustomer.name).toBe('Updated Customer Name');
    expect(storedCustomer.phone).toBe('+94770000000');
    expect(storedCustomer.address).toBe(customer.address);
  });

  it('should reject restricted identity fields in a profile update with 422', async () => {
    const customer = await createCustomer();
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: '507f1f77bcf86cd799439011' });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject an empty patch payload with 422', async () => {
    const customer = await createCustomer();
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
  });

  it('should reject a missing JWT or non-CUSTOMER role', async () => {
    const customer = await createCustomer();

    const noTokenResponse = await request(app).get('/api/profile/me');
    const staffToken = createToken({
      userId: customer._id.toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
    });
    const staffResponse = await request(app)
      .get('/api/profile/me')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(noTokenResponse.status).toBe(401);
    expect(staffResponse.status).toBe(403);
  });

  it('should return 404 when the customer profile record is missing for a valid customer JWT', async () => {
    const missingCustomerId = '507f1f77bcf86cd799439011';
    const token = createToken({ userId: missingCustomerId });

    const getResponse = await request(app)
      .get('/api/profile/me')
      .set('Authorization', `Bearer ${token}`);

    const patchResponse = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Missing Customer' });

    expect(getResponse.status).toBe(404);
    expect(patchResponse.status).toBe(404);
  });

  it('should reject duplicate email changes across customer, staff, and admin records', async () => {
    const customer = await createCustomer({ email: 'customer.original@example.com' });
    const otherCustomer = await createCustomer({
      name: 'Other Customer',
      email: 'customer.duplicate@example.com',
      address: '24 Another Avenue, Colombo',
      phone: '+94710000099',
    });
    const staff = await Staff.create({
      name: 'Staff User',
      email: 'staff@example.com',
      address: 'Staff Lane',
      phone: '+94710000001',
      branchId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.INVENTORY_MANAGER,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });
    const admin = await Admin.create({
      name: 'Admin User',
      email: 'admin@example.com',
      phone: '+94710000002',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });

    const token = createToken({ userId: customer._id.toString() });

    const customerConflict = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: otherCustomer.email });

    const staffConflict = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: staff.email });

    const adminConflict = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: admin.email });

    const sameEmailAllowed = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: customer.email.toUpperCase() });

    expect(customerConflict.status).toBe(409);
    expect(staffConflict.status).toBe(409);
    expect(adminConflict.status).toBe(409);
    expect(sameEmailAllowed.status).toBe(200);
  });

  it('should reject invalid field types and restricted payloads for patch requests', async () => {
    const customer = await createCustomer();
    const token = createToken({ userId: customer._id.toString() });

    const invalidEmail = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'bad-email' });

    const invalidPhone = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: 'abc' });

    const roleUpdate = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: ROLE_VALUES.SYSTEM_ADMIN });

    const unknownField = await request(app)
      .patch('/api/profile/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ loyaltyPoints: 150 });

    expect(invalidEmail.status).toBe(422);
    expect(invalidPhone.status).toBe(422);
    expect(roleUpdate.status).toBe(422);
    expect(unknownField.status).toBe(422);
  });
});
