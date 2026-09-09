const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const syntheticHash = '$2b$12$' + 'a'.repeat(53);

describe('Identity models', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await Promise.all([Customer.syncIndexes(), Staff.syncIndexes(), Admin.syncIndexes()]);
  });

  afterEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should create a valid customer record with normalized identity fields', async () => {
    const customer = await Customer.create({
      name: '  Alice Customer  ',
      email: '  ALICE.CUSTOMER@EXAMPLE.COM  ',
      address: '  12 Main Street, Colombo  ',
      phone: '+94711234567',
      passwordHash: syntheticHash,
    });

    expect(customer.name).toBe('Alice Customer');
    expect(customer.email).toBe('alice.customer@example.com');
    expect(customer.address).toBe('12 Main Street, Colombo');
    expect(customer.phone).toBe('+94711234567');
    expect(customer.role).toBe(ROLE_VALUES.CUSTOMER);
    expect(customer.passwordHash).toBe(syntheticHash);
  });

  it('should create a valid staff record with branch association and controlled role', async () => {
    const staff = await Staff.create({
      name: '  Bob Staff  ',
      email: '  bob.staff@EXAMPLE.com  ',
      phone: '+94719876543',
      address: '  8 Branch Road, Galle  ',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash: syntheticHash,
    });

    expect(staff.email).toBe('bob.staff@example.com');
    expect(staff.branchId).toBeTruthy();
    expect(staff.role).toBe(ROLE_VALUES.BRANCH_MANAGER);
    expect(staff.passwordHash).toBe(syntheticHash);
  });

  it('should create a valid admin record and distinguish it from customer/staff identities', async () => {
    const admin = await Admin.create({
      name: '  Admin User  ',
      email: '  admin.user@EXAMPLE.com  ',
      phone: '+94710000000',
      passwordHash: syntheticHash,
    });

    expect(admin.email).toBe('admin.user@example.com');
    expect(admin.role).toBe(ROLE_VALUES.SYSTEM_ADMIN);
    expect(admin.passwordHash).toBe(syntheticHash);
  });

  it('should reject duplicate emails within the same collection using the unique email index', async () => {
    await Customer.create({
      name: 'Dup Customer',
      email: 'dup@example.com',
      address: '123 Main Street',
      phone: '+94710000001',
      passwordHash: syntheticHash,
    });

    await expect(
      Customer.create({
        name: 'Other Customer',
        email: 'DUP@example.com',
        address: '456 Main Street',
        phone: '+94710000002',
        passwordHash: syntheticHash,
      })
    ).rejects.toThrow();
  });

  it('should reject staff records with a role outside the controlled role list', async () => {
    await expect(
      Staff.create({
        name: 'Invalid Staff',
        email: 'invalid.staff@example.com',
        phone: '+94710000003',
        address: 'Invalid Street',
        branchId: new mongoose.Types.ObjectId().toString(),
        role: 'super_hacker',
        passwordHash: syntheticHash,
      })
    ).rejects.toThrow();
  });

  it('should enforce required identity fields', async () => {
    await expect(
      Customer.create({
        email: 'missing.name@example.com',
        address: 'No Name St',
        phone: '+94710000004',
        passwordHash: syntheticHash,
      })
    ).rejects.toThrow();

    await expect(
      Staff.create({
        name: 'Missing Email Staff',
        phone: '+94710000005',
        address: 'No Email St',
        branchId: new mongoose.Types.ObjectId().toString(),
        role: ROLE_VALUES.OPTOMETRIST,
        passwordHash: syntheticHash,
      })
    ).rejects.toThrow();
  });

  it('should hide passwordHash from regular object serialization and default queries', async () => {
    const customer = await Customer.create({
      name: 'Protected Customer',
      email: 'protected@example.com',
      address: '99 Secret Street',
      phone: '+94710000006',
      passwordHash: syntheticHash,
    });

    const staff = await Staff.create({
      name: 'Protected Staff',
      email: 'protected.staff@example.com',
      phone: '+94710000007',
      address: '2 Protected Lane',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.INVENTORY_MANAGER,
      passwordHash: syntheticHash,
    });

    const admin = await Admin.create({
      name: 'Protected Admin',
      email: 'protected.admin@example.com',
      phone: '+94710000008',
      passwordHash: syntheticHash,
    });

    expect(customer.toJSON()).not.toHaveProperty('passwordHash');
    expect(staff.toJSON()).not.toHaveProperty('passwordHash');
    expect(admin.toJSON()).not.toHaveProperty('passwordHash');

    const customerFromDb = await Customer.findById(customer._id).lean();
    const staffFromDb = await Staff.findById(staff._id).lean();
    const adminFromDb = await Admin.findById(admin._id).lean();

    expect(customerFromDb).not.toHaveProperty('passwordHash');
    expect(staffFromDb).not.toHaveProperty('passwordHash');
    expect(adminFromDb).not.toHaveProperty('passwordHash');
  });
});
