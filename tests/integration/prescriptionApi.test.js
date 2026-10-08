const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Prescription = require('../../src/models/prescription.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

// Shared bcrypt hash computed once for all test fixtures (avoids per-test hashing overhead)
let sharedPasswordHash;

// ─── Test JWT Configuration ───────────────────────────────────────────────────

const JWT_SECRET = 'prescription-api-test-secret';
const JWT_EXPIRES_IN = '1h';

/**
 * Mints a signed JWT for a given userId and role.
 * Mirrors the token structure used by the authenticate middleware.
 */
const createToken = ({ userId, role } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** Creates a minimal Customer document in the test DB. */
const createCustomer = async (overrides = {}) =>
  Customer.create({
    name: 'Test Customer',
    email: `customer-${Date.now()}-${Math.random()}@test.com`,
    phone: '+94711234567',
    passwordHash: sharedPasswordHash,
    role: ROLE_VALUES.CUSTOMER,
    ...overrides,
  });

/** Creates a minimal Staff document in the test DB. */
const createStaff = async (role = ROLE_VALUES.OPTOMETRIST, overrides = {}) =>
  Staff.create({
    name: 'Test Staff',
    email: `staff-${Date.now()}-${Math.random()}@test.com`,
    phone: '+94711234568',
    address: '1 Clinic Road, Colombo',
    role,
    passwordHash: sharedPasswordHash,
    ...overrides,
  });

/** Builds a valid prescription creation payload for a given customerId. */
const buildPrescriptionPayload = (customerId, overrides = {}) => ({
  customerId: customerId.toString(),
  rightEye: {
    distance: { sph: -1.25, cyl: -0.5, axis: 90, va: '6/6' },
    reading: { add: 1.0, nearVa: 'N8' },
  },
  leftEye: {
    distance: { sph: -1.5, cyl: -0.75, axis: 85, va: '6/9' },
    reading: { add: 1.0, nearVa: 'N8' },
  },
  remarks: 'Integration test prescription.',
  ...overrides,
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Prescription API', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;
    delete process.env.MONGODB_URI;

    // Compute a valid bcrypt hash once to avoid per-test hashing overhead
    sharedPasswordHash = await bcrypt.hash('TestPass123!', 12);

    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([Prescription.deleteMany({}), Customer.deleteMany({}), Staff.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Prescription.deleteMany({}), Customer.deleteMany({}), Staff.deleteMany({})]);
    await disconnectDatabase();

    process.env = originalEnv;
  });

  // ── POST /api/prescriptions — Optometrist Creation ───────────────────────────

  describe('POST /api/prescriptions', () => {
    it('should allow an Optometrist to create a prescription for an existing customer', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      // Assert — HTTP 201 and successful response shape
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('customerId');
      expect(response.body.data).toHaveProperty('recordedBy');
      expect(response.body.data).toHaveProperty('recordedAt');
    });

    it('should persist the prescription to the database with correct customerId', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      // Assert — verify DB persistence
      const stored = await Prescription.findOne({ customerId: customer._id });
      expect(stored).not.toBeNull();
      expect(stored.customerId.toString()).toBe(customer._id.toString());
    });

    it('should derive recordedBy from the authenticated Optometrist JWT, not from the request body', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const fakeRecordedById = new mongoose.Types.ObjectId().toString();

      // Act — client tries to inject a different recordedBy
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...buildPrescriptionPayload(customer._id),
          recordedBy: fakeRecordedById,
        });

      // Assert — request must be rejected because recordedBy is a forbidden client field
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);

      // DB must remain empty
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should store correct clinical values in the database', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      // Assert — verify stored clinical values
      const stored = await Prescription.findOne({ customerId: customer._id });
      expect(stored.rightEye.distance.sph).toBe(-1.25);
      expect(stored.rightEye.distance.axis).toBe(90);
      expect(stored.rightEye.distance.va).toBe('6/6');
      expect(stored.rightEye.reading.add).toBe(1.0);
      expect(stored.leftEye.distance.sph).toBe(-1.5);
    });

    it('should reject an unauthenticated prescription creation request', async () => {
      // Arrange
      const customer = await createCustomer();

      // Act — no Authorization header
      const response = await request(app)
        .post('/api/prescriptions')
        .send(buildPrescriptionPayload(customer._id));

      // Assert
      expect(response.status).toBe(401);
      expect(await Prescription.countDocuments({})).toBe(0);
    });
  });

  // ── POST /api/prescriptions — RBAC ───────────────────────────────────────────

  describe('POST /api/prescriptions — RBAC enforcement', () => {
    const unauthorizedRoles = [
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.BRANCH_MANAGER,
      ROLE_VALUES.INVENTORY_MANAGER,
      ROLE_VALUES.MANAGEMENT,
      ROLE_VALUES.SALES_ASSISTANT_CASHIER,
    ];

    it.each(unauthorizedRoles)('should reject prescription creation for role: %s', async (role) => {
      // Arrange
      const customer = await createCustomer();
      const userId = new mongoose.Types.ObjectId().toString();
      const token = createToken({ userId, role });

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      // Assert — RBAC 403
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(await Prescription.countDocuments({})).toBe(0);
    });
  });

  // ── POST /api/prescriptions — Validation ─────────────────────────────────────

  describe('POST /api/prescriptions — validation', () => {
    let optometrist;
    let customer;
    let token;

    beforeEach(async () => {
      optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      customer = await createCustomer();
      token = createToken({ userId: optometrist._id.toString(), role: ROLE_VALUES.OPTOMETRIST });
    });

    it('should reject a missing customerId', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({ rightEye: { distance: { sph: -1.0 } } });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject a malformed customerId', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload('not-a-valid-object-id'));

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject a non-existent customerId (valid ObjectId format)', async () => {
      const ghostId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(ghostId));

      expect(response.status).toBe(404);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject an axis value below 0', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            rightEye: { distance: { axis: -1 } },
          })
        );

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject an axis value above 180', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            leftEye: { distance: { axis: 181 } },
          })
        );

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should accept axis value of exactly 0 (boundary)', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            rightEye: { distance: { axis: 0 } },
          })
        );

      expect(response.status).toBe(201);
    });

    it('should accept axis value of exactly 180 (boundary)', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            rightEye: { distance: { axis: 180 } },
          })
        );

      expect(response.status).toBe(201);
    });

    it('should reject non-numeric axis', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            rightEye: { distance: { axis: 'ninety' } },
          })
        );

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject non-numeric sph', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            rightEye: { distance: { sph: 'minus-one' } },
          })
        );

      expect(response.status).toBe(422);
    });

    it('should reject an unsupported top-level field in the request body', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...buildPrescriptionPayload(customer._id),
          unsupportedField: 'should-be-rejected',
        });

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject a client-supplied recordedAt field', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...buildPrescriptionPayload(customer._id),
          recordedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });

    it('should reject a client-supplied isArchived field', async () => {
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...buildPrescriptionPayload(customer._id),
          isArchived: true,
        });

      expect(response.status).toBe(422);
      expect(await Prescription.countDocuments({})).toBe(0);
    });
  });

  // ── POST /api/prescriptions — Insert-Only History ────────────────────────────

  describe('POST /api/prescriptions — insert-only history', () => {
    it('should create two separate Prescription documents when recording a correction', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act — original prescription
      const original = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'Original prescription.' }));

      // Act — correction prescription
      const correction = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            remarks: 'Correction of original.',
            rightEye: { distance: { sph: -2.0, cyl: -0.75, axis: 95, va: '6/9' } },
          })
        );

      // Assert — both created successfully
      expect(original.status).toBe(201);
      expect(correction.status).toBe(201);

      // Assert — two distinct documents in the database
      const allDocs = await Prescription.find({ customerId: customer._id });
      expect(allDocs).toHaveLength(2);

      const ids = allDocs.map((d) => d._id.toString());
      expect(new Set(ids).size).toBe(2);
    });

    it('should preserve the original prescription unchanged after a correction', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act — create original
      const originalResponse = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'Original.' }));

      const originalId = originalResponse.body.data.id;

      // Act — create correction
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'Corrected.' }));

      // Assert — original document still intact in DB
      const originalInDb = await Prescription.findById(originalId);
      expect(originalInDb).not.toBeNull();
      expect(originalInDb.remarks).toBe('Original.');
    });

    it('should return both records in customer history after a correction', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const optToken = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const custToken = createToken({
        userId: customer._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      // Act — two prescriptions
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'First.' }));

      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'Second (correction).' }));

      // Act — customer retrieves own history
      const historyResponse = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${custToken}`);

      // Assert — both records present
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.data).toHaveLength(2);
    });
  });

  // ── GET /api/prescriptions/me — Customer History ─────────────────────────────

  describe('GET /api/prescriptions/me', () => {
    it("should return the authenticated customer's own prescription history", async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customerA = await createCustomer();
      const customerB = await createCustomer();

      const optToken = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const custAToken = createToken({
        userId: customerA._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      // Create 2 prescriptions for Customer A, 1 for Customer B
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customerA._id, { remarks: 'A - first.' }));

      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customerA._id, { remarks: 'A - second.' }));

      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customerB._id, { remarks: 'B - only.' }));

      // Act
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${custAToken}`);

      // Assert — only Customer A's records returned
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);

      const remarks = response.body.data.map((r) => r.remarks);
      expect(remarks).not.toContain('B - only.');
    });

    it('should return an empty array when the customer has no prescriptions', async () => {
      // Arrange
      const customer = await createCustomer();
      const token = createToken({ userId: customer._id.toString(), role: ROLE_VALUES.CUSTOMER });

      // Act
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${token}`);

      // Assert — 200 OK with empty array (not an error)
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('should return history ordered newest-first by recordedAt', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const optToken = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const custToken = createToken({
        userId: customer._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      // Create prescriptions with small delay to differentiate recordedAt
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'First (older).' }));

      // Brief pause to guarantee timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: 'Second (newer).' }));

      // Act
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${custToken}`);

      // Assert — newest first
      expect(response.status).toBe(200);
      const data = response.body.data;
      expect(data).toHaveLength(2);
      expect(new Date(data[0].recordedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(data[1].recordedAt).getTime()
      );
    });

    it('should reject unauthenticated access to prescription history', async () => {
      const response = await request(app).get('/api/prescriptions/me');
      expect(response.status).toBe(401);
    });

    it('should reject Optometrist access to the customer history endpoint', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${token}`);

      // Assert — OPTOMETRIST is not CUSTOMER
      expect(response.status).toBe(403);
    });
  });

  // ── GET /api/prescriptions/me — Cross-Customer Security ──────────────────────

  describe('GET /api/prescriptions/me — cross-customer security', () => {
    it("should prevent Customer A from accessing Customer B's prescription data", async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customerA = await createCustomer();
      const customerB = await createCustomer();

      const optToken = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const custAToken = createToken({
        userId: customerA._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      // Create prescription only for Customer B
      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(buildPrescriptionPayload(customerB._id, { remarks: 'B clinical data.' }));

      // Act — Customer A requests own history
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${custAToken}`);

      // Assert — Customer A sees empty array, NOT Customer B's data
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);

      const bodyText = JSON.stringify(response.body);
      expect(bodyText).not.toContain('B clinical data.');
    });

    it('should not expose sensitive clinical fields in the cross-customer check', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customerA = await createCustomer();
      const customerB = await createCustomer();

      const optToken = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const custAToken = createToken({
        userId: customerA._id.toString(),
        role: ROLE_VALUES.CUSTOMER,
      });

      await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${optToken}`)
        .send(
          buildPrescriptionPayload(customerB._id, {
            remarks: 'SECRET clinical data for B.',
          })
        );

      // Act
      const response = await request(app)
        .get('/api/prescriptions/me')
        .set('Authorization', `Bearer ${custAToken}`);

      // Assert — none of Customer B's clinical information is in the response
      const bodyText = JSON.stringify(response.body);
      expect(bodyText).not.toContain('SECRET clinical data for B.');
      expect(bodyText).not.toContain(customerB._id.toString());
    });
  });

  // ── GET /api/prescriptions/customer/:customerId — Optometrist Read ────────────

  describe('GET /api/prescriptions/customer/:customerId', () => {
    it("should allow an Optometrist to retrieve a customer's prescription history", async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      await Prescription.create({
        customerId: customer._id,
        recordedBy: optometrist._id,
        remarks: 'Optometrist view test.',
      });

      // Act
      const response = await request(app)
        .get(`/api/prescriptions/customer/${customer._id}`)
        .set('Authorization', `Bearer ${token}`);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('should reject a non-existent customerId with 404', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });
      const ghostId = new mongoose.Types.ObjectId();

      // Act
      const response = await request(app)
        .get(`/api/prescriptions/customer/${ghostId}`)
        .set('Authorization', `Bearer ${token}`);

      // Assert
      expect(response.status).toBe(404);
    });

    it('should reject a malformed customerId param with 422', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .get('/api/prescriptions/customer/not-a-valid-id')
        .set('Authorization', `Bearer ${token}`);

      // Assert
      expect(response.status).toBe(422);
    });

    it('should reject a CUSTOMER trying to access the optometrist-scoped endpoint', async () => {
      // Arrange
      const customer = await createCustomer();
      const token = createToken({ userId: customer._id.toString(), role: ROLE_VALUES.CUSTOMER });

      // Act
      const response = await request(app)
        .get(`/api/prescriptions/customer/${customer._id}`)
        .set('Authorization', `Bearer ${token}`);

      // Assert
      expect(response.status).toBe(403);
    });

    it('should reject unauthenticated access to the optometrist endpoint', async () => {
      const someId = new mongoose.Types.ObjectId();
      const response = await request(app).get(`/api/prescriptions/customer/${someId}`);
      expect(response.status).toBe(401);
    });

    // ── AC18 Negative RBAC: All non-Optometrist staff roles must be rejected ──
    //
    // Reviewer comment (AC18): The endpoint authorizes only by OPTOMETRIST role
    // and returns any customer's prescription history. Global Optometrist access
    // is the approved clinical workflow per FR-002 / FR-013 (DDP-050): an
    // Optometrist must be able to view any patient's prescription history to
    // provide continuity of care across branches. No additional patient-consent
    // or per-branch scope restriction is defined in the current requirements.
    //
    // These tests confirm that every OTHER staff role and unauthenticated
    // requests are denied (403/401), proving access is not unrestricted.

    it.each([
      [ROLE_VALUES.CUSTOMER],
      [ROLE_VALUES.SALES_ASSISTANT_CASHIER],
      [ROLE_VALUES.BRANCH_MANAGER],
      [ROLE_VALUES.INVENTORY_MANAGER],
      [ROLE_VALUES.MANAGEMENT],
      [ROLE_VALUES.SYSTEM_ADMIN],
    ])(
      'should return 403 FORBIDDEN for role %s — not authorized to read customer prescription history (AC18)',
      async (forbiddenRole) => {
        // Arrange
        const customer = await createCustomer();
        // Mint a token for the forbidden role (userId does not need to resolve to a real document
        // — RBAC fires before any DB lookup).
        const token = createToken({
          userId: new mongoose.Types.ObjectId().toString(),
          role: forbiddenRole,
        });

        // Act
        const response = await request(app)
          .get(`/api/prescriptions/customer/${customer._id}`)
          .set('Authorization', `Bearer ${token}`);

        // Assert
        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    );
  });

  // ── Error Response Safety ─────────────────────────────────────────────────────

  describe('Error response safety', () => {
    it('should not expose stack traces, database credentials, or secrets in error responses', async () => {
      // Arrange — invalid request to trigger a validation error
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId: 'bad-id' });

      const bodyText = JSON.stringify(response.body);

      // Assert — safe error response
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.stack).toBeUndefined();
      expect(bodyText).not.toContain(JWT_SECRET);
      expect(bodyText).not.toContain('mongodb://');
      expect(bodyText).not.toContain('mongodb+srv://');
    });

    it('should not expose sensitive clinical data in validation error responses', async () => {
      // Arrange — send a payload with invalid axis but valid clinical data
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const sensitiveRemarks = 'SENSITIVE_PATIENT_DATA_XYZ';

      // Act — invalid axis should reject the request
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            remarks: sensitiveRemarks,
            rightEye: { distance: { axis: 999 } },
          })
        );

      // Assert — clinical remarks must not leak into the error response body
      expect(response.status).toBe(422);
      const bodyText = JSON.stringify(response.body);
      expect(bodyText).not.toContain(sensitiveRemarks);
    });
  });

  // ── Safe Response Shape ───────────────────────────────────────────────────────

  describe('Safe response shape', () => {
    it('should not expose passwordHash or internal staff fields in the prescription response', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      const bodyText = JSON.stringify(response.body);

      // Assert — no internal staff fields in response
      expect(response.status).toBe(201);
      expect(bodyText).not.toContain('passwordHash');
      expect(bodyText).not.toContain('email');

      // recordedBy must expose only id and name
      const { recordedBy } = response.body.data;
      expect(recordedBy).toHaveProperty('id');
      expect(recordedBy).not.toHaveProperty('passwordHash');
      expect(recordedBy).not.toHaveProperty('email');
    });

    it('should expose approved clinical fields in the response', async () => {
      // Arrange
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id));

      const { data } = response.body;

      // Assert
      expect(data).toHaveProperty('rightEye');
      expect(data).toHaveProperty('leftEye');
      expect(data).toHaveProperty('remarks');
      expect(data).toHaveProperty('isArchived');
      expect(data).toHaveProperty('recordedAt');
      expect(data.rightEye).toHaveProperty('distance');
      expect(data.rightEye).toHaveProperty('reading');
    });
  });

  // ── Logging Safety (AC23 / Issue #51) ────────────────────────────────────────
  //
  // Issue #51 requires that clinical prescription data (eye measurements,
  // remarks, customerId) is NEVER written to application logs during normal
  // request processing, validation failures, or error handling.
  //
  // The errorHandler only logs to console.error for 5xx unexpected errors;
  // 4xx operational errors are intentionally silent. These tests spy on
  // console.error to verify that sensitive clinical values do not appear
  // in any log output triggered by the prescription endpoints.

  describe('Logging safety — clinical data must not be written to logs (AC23, Issue #51)', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should not log clinical remarks to console.error when a validation error is triggered (AC23)', async () => {
      // Arrange — send a request with valid clinical remarks but an invalid axis,
      // which triggers a route-layer ValidationError (422 operational error).
      // Operational errors (4xx) must NOT be written to console.error at all.
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const sensitiveRemarks = 'CONFIDENTIAL_CLINICAL_REMARKS_LOG_TEST_7a9f';

      // Act — invalid axis will cause a 422 validation error
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(
          buildPrescriptionPayload(customer._id, {
            remarks: sensitiveRemarks,
            rightEye: { distance: { axis: 999 } },
          })
        );

      // Assert HTTP response is correct error
      expect(response.status).toBe(422);

      // Assert no clinical data was logged — join all console.error call args
      const allLoggedText = consoleSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');

      expect(allLoggedText).not.toContain(sensitiveRemarks);
      expect(allLoggedText).not.toContain(customer._id.toString());
    });

    it('should not log clinical eye measurements to console.error during validation failure (AC23)', async () => {
      // Arrange — remarks contains a recognizable sentinel value
      const optometrist = await createStaff(ROLE_VALUES.OPTOMETRIST);
      const customer = await createCustomer();
      const token = createToken({
        userId: optometrist._id.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const sentinelRemarks = 'SENTINEL_EYE_MEAS_LOG_SAFETY_TEST_3c8e';

      // Act — send completely invalid body fields to trigger multiple validation errors
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId: customer._id.toString(),
          remarks: sentinelRemarks,
          rightEye: { distance: { sph: 'not-a-number', axis: -999 } },
          unknownField: 'should-be-rejected',
        });

      // Assert HTTP error returned
      expect(response.status).toBe(422);

      // Assert clinical data not logged
      const allLoggedText = consoleSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');

      expect(allLoggedText).not.toContain(sentinelRemarks);
      expect(allLoggedText).not.toContain('SENTINEL_EYE_MEAS');
    });

    it('should not log clinical remarks to console.error when optometrist lookup fails (AC23)', async () => {
      // Arrange — authenticated optometrist userId does not exist in the Staff collection,
      // so the service-layer validateStaffExists throws a 404 NotFoundError (still operational).
      const customer = await createCustomer();
      const phantomStaffId = new mongoose.Types.ObjectId();
      const token = createToken({
        userId: phantomStaffId.toString(),
        role: ROLE_VALUES.OPTOMETRIST,
      });

      const sensitiveRemarks = 'PHANTOM_STAFF_CLINICAL_LOG_SAFETY_b2d1';

      // Act
      const response = await request(app)
        .post('/api/prescriptions')
        .set('Authorization', `Bearer ${token}`)
        .send(buildPrescriptionPayload(customer._id, { remarks: sensitiveRemarks }));

      // Assert HTTP response is a 404 Not Found (operational)
      expect(response.status).toBe(404);

      // Assert sensitive data was not logged
      const allLoggedText = consoleSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');

      expect(allLoggedText).not.toContain(sensitiveRemarks);
    });
  });
});
