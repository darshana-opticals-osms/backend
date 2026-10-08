const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Prescription = require('../../src/models/prescription.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'customer-lookup-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

// Standard 60-character bcrypt hash for tests
const TEST_BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEF12345678901234567890123';

const createToken = ({
  userId = '507f1f77bcf86cd799439011',
  role = ROLE_VALUES.OPTOMETRIST,
} = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

const createCustomer = async (overrides = {}) =>
  Customer.create({
    name: 'Kamal Perera',
    email: 'kamal@example.com',
    passwordHash: TEST_BCRYPT_HASH,
    phone: '0771234567',
    address: '123 Main St, Colombo',
    role: ROLE_VALUES.CUSTOMER,
    ...overrides,
  });

describe('Customer Lookup API (GET /api/customers/lookup)', () => {
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
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Prescription.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Prescription.deleteMany({})]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  describe('Authentication & Authorization (AC1, AC2, AC3, AC5)', () => {
    it('should return 401 UNAUTHORIZED when no authorization header is sent (AC5)', async () => {
      const res = await request(app).get('/api/customers/lookup?q=kamal');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 UNAUTHORIZED when an invalid token is sent', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=kamal')
        .set('Authorization', 'Bearer invalid.jwt.token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow access to users with OPTOMETRIST role (AC2)', async () => {
      await createCustomer();
      const optometristToken = createToken({ role: ROLE_VALUES.OPTOMETRIST });

      const res = await request(app)
        .get('/api/customers/lookup?q=kamal')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it.each([
      [ROLE_VALUES.CUSTOMER],
      [ROLE_VALUES.SALES_ASSISTANT_CASHIER],
      [ROLE_VALUES.MANAGEMENT],
      [ROLE_VALUES.BRANCH_MANAGER],
      [ROLE_VALUES.INVENTORY_MANAGER],
      [ROLE_VALUES.SYSTEM_ADMIN],
    ])('should deny access (403 FORBIDDEN) to role %s (AC2)', async (unauthorizedRole) => {
      const token = createToken({ role: unauthorizedRole });

      const res = await request(app)
        .get('/api/customers/lookup?q=kamal')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Query Validation (AC9, AC10, AC11)', () => {
    let optometristToken;

    beforeEach(() => {
      optometristToken = createToken({ role: ROLE_VALUES.OPTOMETRIST });
    });

    it('should return 422 VALIDATION_ERROR when query parameter q is missing', async () => {
      const res = await request(app)
        .get('/api/customers/lookup')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 VALIDATION_ERROR when q is an empty string', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 VALIDATION_ERROR when q is whitespace only', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=%20%20')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 VALIDATION_ERROR when q is less than 2 characters (e.g. 1 char)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=a')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 VALIDATION_ERROR when q exceeds 100 characters', async () => {
      const longQuery = 'a'.repeat(101);
      const res = await request(app)
        .get(`/api/customers/lookup?q=${longQuery}`)
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should succeed with 200 when q is exactly 2 characters (minimum boundary)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=ka')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Search & Data Minimization (AC6, AC12-AC27)', () => {
    let optometristToken;

    beforeEach(async () => {
      optometristToken = createToken({ role: ROLE_VALUES.OPTOMETRIST });

      await Customer.create([
        {
          name: 'Amara Gunawardena',
          email: 'amara@optical.lk',
          passwordHash: TEST_BCRYPT_HASH,
          phone: '0711111111',
          address: 'Galle Road, Colombo 03',
          role: ROLE_VALUES.CUSTOMER,
        },
        {
          name: 'Bimal Silva',
          email: 'bimal@optical.lk',
          passwordHash: TEST_BCRYPT_HASH,
          phone: '0722222222',
          address: 'Kandy Road, Kiribathgoda',
          role: ROLE_VALUES.CUSTOMER,
        },
        {
          name: 'Kamal Fernando',
          email: 'kamal.f@gmail.com',
          passwordHash: TEST_BCRYPT_HASH,
          phone: '0773333333',
          address: 'High Level Rd, Nugegoda',
          role: ROLE_VALUES.CUSTOMER,
        },
        {
          name: 'Sunil Perera',
          email: 'sunil@optical.lk',
          passwordHash: TEST_BCRYPT_HASH,
          phone: '0771234567',
          address: 'Main St, Negombo',
          role: ROLE_VALUES.CUSTOMER,
        },
      ]);
    });

    it('should search customers by name case-insensitively (AC6, AC12)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=KAMAL')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Kamal Fernando');
    });

    it('should search customers by email case-insensitively (AC6, AC13)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=BIMAL@OPTICAL.LK')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Bimal Silva');
    });

    it('should search customers by phone number (AC6, AC14)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=0773333333')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Kamal Fernando');
    });

    it('should return empty data array when no customers match (AC23)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=nonexistentquery')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('should return ONLY safe identification fields (id, name, email, phone) (AC15-AC22)', async () => {
      const res = await request(app)
        .get('/api/customers/lookup?q=amara')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);

      const customer = res.body.data[0];
      const keys = Object.keys(customer).sort();

      expect(keys).toEqual(['email', 'id', 'name', 'phone']);
      expect(customer).not.toHaveProperty('_id');
      expect(customer).not.toHaveProperty('passwordHash');
      expect(customer).not.toHaveProperty('address');
      expect(customer).not.toHaveProperty('role');
      expect(customer).not.toHaveProperty('prescriptions');
      expect(customer).not.toHaveProperty('orders');
      expect(customer).not.toHaveProperty('payments');
      expect(customer).not.toHaveProperty('createdAt');
      expect(customer).not.toHaveProperty('updatedAt');
      expect(customer).not.toHaveProperty('__v');
    });

    it('should safely handle regex metacharacters in query (AC11)', async () => {
      await Customer.create({
        name: 'Special (User)+Test',
        email: 'special.user@test.lk',
        passwordHash: TEST_BCRYPT_HASH,
        phone: '0770000000',
        address: 'Special Addr',
        role: ROLE_VALUES.CUSTOMER,
      });

      const queryStr = encodeURIComponent('(User)+Test');
      const res = await request(app)
        .get(`/api/customers/lookup?q=${queryStr}`)
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Special (User)+Test');
    });

    it('should apply maximum limit of 10 and order by name ASC (AC25, AC26)', async () => {
      await Customer.deleteMany({});
      const customersToCreate = [];
      for (let i = 1; i <= 15; i++) {
        const char = String.fromCharCode(65 + (i % 26)); // A, B, C...
        customersToCreate.push({
          name: `TestCustomer ${char}${i.toString().padStart(2, '0')}`,
          email: `test${i}@example.com`,
          passwordHash: TEST_BCRYPT_HASH,
          phone: `077${i.toString().padStart(7, '0')}`,
          address: 'Addr',
          role: ROLE_VALUES.CUSTOMER,
        });
      }
      await Customer.create(customersToCreate);

      const res = await request(app)
        .get('/api/customers/lookup?q=TestCustomer')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(10);
      expect(res.body.data).toHaveLength(10);

      // Verify alphabetical order by name
      const names = res.body.data.map((c) => c.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });
  });

  describe('DDP-050 Compatibility Integration (Customer Lookup -> Prescription Creation)', () => {
    it('should perform Customer lookup as an OPTOMETRIST, use returned customer id in POST /api/prescriptions, and verify association', async () => {
      // 1. Arrange: Create Optometrist staff and Customer in DB
      const optometristStaff = await Staff.create({
        name: 'Dr. Nirmal Senaratne',
        email: 'dr.nirmal@optical.lk',
        phone: '+94771122334',
        address: 'Colombo Eye Clinic',
        role: ROLE_VALUES.OPTOMETRIST,
        passwordHash: TEST_BCRYPT_HASH,
      });

      const customerDoc = await Customer.create({
        name: 'Saman Kumara',
        email: 'saman.k@example.com',
        phone: '0779988776',
        address: '45 Lake Road, Maharagama',
        role: ROLE_VALUES.CUSTOMER,
        passwordHash: TEST_BCRYPT_HASH,
      });

      const optometristToken = jwt.sign(
        { userId: optometristStaff._id.toString(), role: ROLE_VALUES.OPTOMETRIST },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN }
      );

      // 2. Act Step 1: Perform Customer lookup as OPTOMETRIST
      const lookupResponse = await request(app)
        .get('/api/customers/lookup?q=Saman')
        .set('Authorization', `Bearer ${optometristToken}`);

      expect(lookupResponse.status).toBe(200);
      expect(lookupResponse.body.success).toBe(true);
      expect(lookupResponse.body.data).toHaveLength(1);

      const foundCustomer = lookupResponse.body.data[0];
      expect(foundCustomer.id).toBe(customerDoc._id.toString());
      expect(foundCustomer.name).toBe('Saman Kumara');

      // 3. Act Step 2: Use returned customer id in POST /api/prescriptions
      const prescriptionPayload = {
        customerId: foundCustomer.id,
        rightEye: {
          distance: { sph: -2.25, cyl: -0.5, axis: 90, va: '6/6' },
          reading: { add: 1.25, nearVa: 'N6' },
        },
        leftEye: {
          distance: { sph: -2.0, cyl: -0.75, axis: 85, va: '6/6' },
          reading: { add: 1.25, nearVa: 'N6' },
        },
        remarks: 'DDP-050 Integration test prescription.',
      };

      const prescriptionResponse = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optometristToken}`)
        .send(prescriptionPayload);

      // 4. Assert: Prescription creation succeeds and references the looked-up Customer id
      expect(prescriptionResponse.status).toBe(201);
      expect(prescriptionResponse.body.success).toBe(true);
      expect(prescriptionResponse.body.data).toHaveProperty('id');
      expect(prescriptionResponse.body.data.customerId).toBe(foundCustomer.id);
      expect(prescriptionResponse.body.data.recordedBy.id).toBe(optometristStaff._id.toString());

      // 5. Verify database persistence and association
      const savedPrescription = await Prescription.findOne({ customerId: foundCustomer.id });
      expect(savedPrescription).not.toBeNull();
      expect(savedPrescription.customerId.toString()).toBe(foundCustomer.id);
      expect(savedPrescription.recordedBy.toString()).toBe(optometristStaff._id.toString());
      expect(savedPrescription.rightEye.distance.sph).toBe(-2.25);
      expect(savedPrescription.remarks).toBe('DDP-050 Integration test prescription.');
    });
  });
});
