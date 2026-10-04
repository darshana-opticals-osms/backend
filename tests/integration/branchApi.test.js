const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'branch-api-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = (role) =>
  jwt.sign(
    {
      userId: '507f1f77bcf86cd799439011',
      role,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN }
  );

const createBranches = () =>
  Branch.create([
    {
      address: '45 Peradeniya Road, Kandy',
      contactNumber: '+94 81 220 0000',
    },
    {
      address: '100 Galle Road, Colombo 03',
      contactNumber: '+94 11 250 0000',
    },
    {
      address: '100 Galle Road, Colombo 03',
      contactNumber: '+94 11 250 0001',
    },
  ]);

describe('GET /api/branches', () => {
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
    await Branch.deleteMany({});
  });

  afterAll(async () => {
    await Branch.deleteMany({});
    await disconnectDatabase();
    process.env = originalEnv;
  });

  it.each([
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.INVENTORY_MANAGER,
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.MANAGEMENT,
  ])('should return safe Branch references for %s', async (role) => {
    const branches = await createBranches();

    const response = await request(app)
      .get('/api/branches')
      .set('Authorization', `Bearer ${createToken(role)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [
        {
          id: branches[1]._id.toString(),
          address: '100 Galle Road, Colombo 03',
          contactNumber: '+94 11 250 0000',
        },
        {
          id: branches[2]._id.toString(),
          address: '100 Galle Road, Colombo 03',
          contactNumber: '+94 11 250 0001',
        },
        {
          id: branches[0]._id.toString(),
          address: '45 Peradeniya Road, Kandy',
          contactNumber: '+94 81 220 0000',
        },
      ],
    });

    for (const branch of response.body.data) {
      expect(Object.keys(branch)).toEqual(['id', 'address', 'contactNumber']);
      expect(branch).not.toHaveProperty('name');
      expect(branch).not.toHaveProperty('_id');
      expect(branch).not.toHaveProperty('__v');
      expect(branch).not.toHaveProperty('createdAt');
      expect(branch).not.toHaveProperty('updatedAt');
    }
  });

  it('should return an empty list for an authorized request with no Branch records', async () => {
    const response = await request(app)
      .get('/api/branches')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.SYSTEM_ADMIN)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });

  it('should reject a request without a JWT', async () => {
    await createBranches();

    const response = await request(app).get('/api/branches');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.body).not.toHaveProperty('data');
  });

  it.each([ROLE_VALUES.CUSTOMER, ROLE_VALUES.OPTOMETRIST, ROLE_VALUES.SALES_ASSISTANT_CASHIER])(
    'should reject %s without returning Branch data',
    async (role) => {
      await createBranches();

      const response = await request(app)
        .get('/api/branches')
        .set('Authorization', `Bearer ${createToken(role)}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body).not.toHaveProperty('data');
    }
  );

  it('should ignore unsupported query values without changing authorization or results', async () => {
    const branches = await createBranches();

    const authorizedResponse = await request(app)
      .get('/api/branches?$where=malicious&$ne=invalid&role=SYSTEM_ADMIN')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.MANAGEMENT)}`);
    const customerResponse = await request(app)
      .get('/api/branches?role=SYSTEM_ADMIN')
      .set('Authorization', `Bearer ${createToken(ROLE_VALUES.CUSTOMER)}`);

    expect(authorizedResponse.status).toBe(200);
    expect(authorizedResponse.body.data.map((branch) => branch.id)).toEqual([
      branches[1]._id.toString(),
      branches[2]._id.toString(),
      branches[0]._id.toString(),
    ]);
    expect(customerResponse.status).toBe(403);
    expect(customerResponse.body).not.toHaveProperty('data');
  });
});
