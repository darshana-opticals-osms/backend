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

  it('should create a valid customer record with the canonical CUSTOMER role', async () => {
    // Arrange
    const customerPayload = {
      name: '  Alice Customer  ',
      email: '  ALICE.CUSTOMER@EXAMPLE.COM  ',
      address: '  12 Main Street, Colombo  ',
      phone: '+94711234567',
      passwordHash: syntheticHash,
    };

    // Act
    const customer = await Customer.create(customerPayload);

    // Assert
    expect(customer.name).toBe('Alice Customer');
    expect(customer.email).toBe('alice.customer@example.com');
    expect(customer.address).toBe('12 Main Street, Colombo');
    expect(customer.phone).toBe('+94711234567');
    expect(customer.role).toBe(ROLE_VALUES.CUSTOMER);
    expect(customer.passwordHash).toBe(syntheticHash);
  });

  it('should create a valid staff record with a canonical staff role', async () => {
    // Arrange
    const staffPayload = {
      name: '  Bob Staff  ',
      email: '  bob.staff@EXAMPLE.com  ',
      phone: '+94719876543',
      address: '  8 Branch Road, Galle  ',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash: syntheticHash,
    };

    // Act
    const staff = await Staff.create(staffPayload);

    // Assert
    expect(staff.email).toBe('bob.staff@example.com');
    expect(staff.branchId).toBeTruthy();
    expect(staff.role).toBe(ROLE_VALUES.BRANCH_MANAGER);
    expect(staff.passwordHash).toBe(syntheticHash);
  });

  it('should create a valid admin record with the canonical SYSTEM_ADMIN role', async () => {
    // Arrange
    const adminPayload = {
      name: '  Admin User  ',
      email: '  admin.user@EXAMPLE.com  ',
      phone: '+94710000000',
      passwordHash: syntheticHash,
    };

    // Act
    const admin = await Admin.create(adminPayload);

    // Assert
    expect(admin.email).toBe('admin.user@example.com');
    expect(admin.role).toBe(ROLE_VALUES.SYSTEM_ADMIN);
    expect(admin.passwordHash).toBe(syntheticHash);
  });

  it('should create a valid SALES_ASSISTANT_CASHIER staff record', async () => {
    // Arrange
    const staffPayload = {
      name: 'Cashier Staff',
      email: 'cashier.staff@example.com',
      phone: '+94710000001',
      address: '7 Counter Lane',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
      passwordHash: syntheticHash,
    };

    // Act
    const staff = await Staff.create(staffPayload);

    // Assert
    expect(staff.role).toBe(ROLE_VALUES.SALES_ASSISTANT_CASHIER);
    expect(staff.passwordHash).toBe(syntheticHash);
  });

  it('should normalize email addresses and trim identity values', async () => {
    // Arrange
    const customerPayload = {
      name: '  Customer User  ',
      email: '  CUSTOMER.USER@EXAMPLE.COM  ',
      address: '  99 Main Street  ',
      phone: '+94710000002',
      passwordHash: syntheticHash,
    };

    // Act
    const customer = await Customer.create(customerPayload);

    // Assert
    expect(customer.name).toBe('Customer User');
    expect(customer.email).toBe('customer.user@example.com');
    expect(customer.address).toBe('99 Main Street');
  });

  it('should reject duplicate emails within the same collection', async () => {
    // Arrange
    const originalCustomer = {
      name: 'Dup Customer',
      email: 'dup@example.com',
      address: '123 Main Street',
      phone: '+94710000003',
      passwordHash: syntheticHash,
    };

    // Act
    await Customer.create(originalCustomer);

    // Assert
    await expect(
      Customer.create({
        ...originalCustomer,
        name: 'Other Customer',
        email: 'DUP@example.com',
        phone: '+94710000004',
      })
    ).rejects.toThrow();
  });

  it('should reject an arbitrary role outside the approved staff role list', async () => {
    // Arrange
    const invalidStaff = {
      name: 'Invalid Staff',
      email: 'invalid.staff@example.com',
      phone: '+94710000005',
      address: 'Invalid Street',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: 'super_hacker',
      passwordHash: syntheticHash,
    };

    // Act / Assert
    await expect(Staff.create(invalidStaff)).rejects.toThrow();
  });

  it('should enforce required identity fields', async () => {
    // Arrange
    const missingNameCustomer = {
      email: 'missing.name@example.com',
      address: 'No Name St',
      phone: '+94710000006',
      passwordHash: syntheticHash,
    };
    const missingEmailStaff = {
      name: 'Missing Email Staff',
      phone: '+94710000007',
      address: 'No Email St',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.OPTOMETRIST,
      passwordHash: syntheticHash,
    };

    // Act / Assert
    await expect(Customer.create(missingNameCustomer)).rejects.toThrow();
    await expect(Staff.create(missingEmailStaff)).rejects.toThrow();
  });

  it('should hide passwordHash from serialization and default queries', async () => {
    // Arrange
    const customer = await Customer.create({
      name: 'Protected Customer',
      email: 'protected@example.com',
      address: '99 Secret Street',
      phone: '+94710000008',
      passwordHash: syntheticHash,
    });
    const staff = await Staff.create({
      name: 'Protected Staff',
      email: 'protected.staff@example.com',
      phone: '+94710000009',
      address: '2 Protected Lane',
      branchId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.INVENTORY_MANAGER,
      passwordHash: syntheticHash,
    });
    const admin = await Admin.create({
      name: 'Protected Admin',
      email: 'protected.admin@example.com',
      phone: '+94710000010',
      passwordHash: syntheticHash,
    });

    // Act
    const customerFromDb = await Customer.findById(customer._id).lean();
    const staffFromDb = await Staff.findById(staff._id).lean();
    const adminFromDb = await Admin.findById(admin._id).lean();

    // Assert
    expect(customer.toJSON()).not.toHaveProperty('passwordHash');
    expect(staff.toJSON()).not.toHaveProperty('passwordHash');
    expect(admin.toJSON()).not.toHaveProperty('passwordHash');
    expect(customerFromDb).not.toHaveProperty('passwordHash');
    expect(staffFromDb).not.toHaveProperty('passwordHash');
    expect(adminFromDb).not.toHaveProperty('passwordHash');

    const customerWithHash = await Customer.findById(customer._id).select('+passwordHash');
    expect(customerWithHash.passwordHash).toBe(syntheticHash);
  });
});
