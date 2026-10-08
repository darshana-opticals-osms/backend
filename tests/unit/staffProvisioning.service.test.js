const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const Staff = require('../../src/models/staff.model');
const authService = require('../../src/services/auth.service');
const {
  buildSafeStaffResponse,
  provisionStaff,
} = require('../../src/services/staffProvisioning.service');
const { ROLE_VALUES, STAFF_ROLE_VALUES } = require('../../src/constants/roles');

jest.mock('../../src/models/branch.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/staff.model', () => ({
  create: jest.fn(),
}));

jest.mock('../../src/services/auth.service', () => ({
  checkExistingIdentity: jest.fn(),
  hashPassword: jest.fn(),
}));

const PASSWORD = 'StrongPass123!';
const PASSWORD_HASH = '$2b$12$hashedPasswordValue';
const BRANCH_ID = '64d4a3ff3baf9d2b8a33d1a1';

const buildInput = (overrides = {}) => ({
  name: 'Jordan Staff',
  email: 'jordan.staff@example.com',
  phone: '+94711234567',
  address: '12 Main Street, Colombo',
  role: ROLE_VALUES.OPTOMETRIST,
  password: PASSWORD,
  ...overrides,
});

const buildCreatedStaff = (fields) => ({
  _id: new mongoose.Types.ObjectId(),
  ...fields,
});

describe('Staff provisioning service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authService.checkExistingIdentity.mockResolvedValue(null);
    authService.hashPassword.mockResolvedValue(PASSWORD_HASH);
    Staff.create.mockImplementation(async (fields) => buildCreatedStaff(fields));
  });

  it.each(STAFF_ROLE_VALUES)(
    'should provision an account using canonical staff role %s',
    async (role) => {
      const result = await provisionStaff(
        buildInput({
          email: '  JORDAN.STAFF@EXAMPLE.COM  ',
          role,
        })
      );

      expect(authService.checkExistingIdentity).toHaveBeenCalledWith('jordan.staff@example.com');
      expect(authService.hashPassword).toHaveBeenCalledWith(PASSWORD);
      expect(Staff.create).toHaveBeenCalledWith({
        name: 'Jordan Staff',
        email: 'jordan.staff@example.com',
        phone: '+94711234567',
        address: '12 Main Street, Colombo',
        role,
        branchId: null,
        passwordHash: PASSWORD_HASH,
      });
      expect(result).toMatchObject({
        id: expect.any(String),
        name: 'Jordan Staff',
        email: 'jordan.staff@example.com',
        role,
        branchId: null,
      });
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordHash');
      expect(Object.keys(Staff.create.mock.calls[0][0]).sort()).toEqual(
        ['address', 'branchId', 'email', 'name', 'passwordHash', 'phone', 'role'].sort()
      );
      expect(Staff.create.mock.calls[0][0]).not.toHaveProperty('password');
      expect(Staff.create.mock.calls[0][0].passwordHash).not.toBe(PASSWORD);
      expect(Branch.exists).not.toHaveBeenCalled();
    }
  );

  it.each([ROLE_VALUES.CUSTOMER, ROLE_VALUES.SYSTEM_ADMIN, 'UNKNOWN_ROLE'])(
    'should reject role %s before looking up identities or creating Staff',
    async (role) => {
      await expect(provisionStaff(buildInput({ role }))).rejects.toMatchObject({
        statusCode: 422,
        details: { field: 'role' },
      });

      expect(authService.checkExistingIdentity).not.toHaveBeenCalled();
      expect(authService.hashPassword).not.toHaveBeenCalled();
      expect(Staff.create).not.toHaveBeenCalled();
    }
  );

  it.each(['Customer', 'Staff', 'Admin'])(
    'should reject a duplicate email already used by a %s identity',
    async () => {
      authService.checkExistingIdentity.mockResolvedValue({ _id: 'existing-id' });

      await expect(
        provisionStaff(buildInput({ email: '  DUPLICATE@EXAMPLE.COM  ' }))
      ).rejects.toMatchObject({
        statusCode: 409,
      });

      expect(authService.checkExistingIdentity).toHaveBeenCalledWith('duplicate@example.com');
      expect(authService.hashPassword).not.toHaveBeenCalled();
      expect(Staff.create).not.toHaveBeenCalled();
    }
  );

  it.each([null, [], 'invalid-input'])(
    'should reject non-object provisioning data %p',
    async (input) => {
      await expect(provisionStaff(input)).rejects.toMatchObject({ statusCode: 422 });
      expect(Staff.create).not.toHaveBeenCalled();
    }
  );

  it('should reject unsupported fields instead of mass assigning them', async () => {
    await expect(
      provisionStaff(buildInput({ permissions: ['all'], isAdmin: true }))
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(authService.checkExistingIdentity).not.toHaveBeenCalled();
    expect(Staff.create).not.toHaveBeenCalled();
  });

  it.each(['not-an-object-id', '', null, 123])(
    'should reject malformed branch identifier %p',
    async (branchId) => {
      await expect(provisionStaff(buildInput({ branchId }))).rejects.toMatchObject({
        statusCode: 422,
        details: { field: 'branchId' },
      });

      expect(Branch.exists).not.toHaveBeenCalled();
      expect(Staff.create).not.toHaveBeenCalled();
    }
  );

  it('should reject a well-formed branch identifier when the Branch does not exist', async () => {
    Branch.exists.mockResolvedValue(null);

    await expect(provisionStaff(buildInput({ branchId: BRANCH_ID }))).rejects.toMatchObject({
      statusCode: 422,
      details: { field: 'branchId' },
    });

    expect(Branch.exists).toHaveBeenCalledWith({ _id: BRANCH_ID });
    expect(authService.checkExistingIdentity).not.toHaveBeenCalled();
    expect(Staff.create).not.toHaveBeenCalled();
  });

  it('should validate and persist an optional branch reference', async () => {
    Branch.exists.mockResolvedValue({ _id: BRANCH_ID });

    await provisionStaff(buildInput({ branchId: BRANCH_ID }));

    expect(Branch.exists).toHaveBeenCalledWith({ _id: BRANCH_ID });
    expect(Staff.create).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_ID }));
  });

  it('should use the safe DTO fallback id and omit secrets', () => {
    const response = buildSafeStaffResponse({
      id: 'staff-fallback-id',
      name: 'Jordan Staff',
      email: 'jordan.staff@example.com',
      phone: '+94711234567',
      address: '12 Main Street, Colombo',
      role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
      branchId: null,
      password: PASSWORD,
      passwordHash: PASSWORD_HASH,
    });

    expect(response).toEqual({
      id: 'staff-fallback-id',
      name: 'Jordan Staff',
      email: 'jordan.staff@example.com',
      phone: '+94711234567',
      address: '12 Main Street, Colombo',
      role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
      branchId: null,
    });
    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('passwordHash');
  });
});
