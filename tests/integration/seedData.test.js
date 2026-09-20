const bcrypt = require('bcrypt');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const Inventory = require('../../src/models/inventory.model');
const Prescription = require('../../src/models/prescription.model');
const Order = require('../../src/models/order.model');
const OrderItem = require('../../src/models/orderItem.model');
const Appointment = require('../../src/models/appointment.model');
const Payment = require('../../src/models/payment.model');
const { seedDatabase, PRODUCTION_SAFETY_ERROR } = require('../../src/seed/seed');
const { DEV_DEFAULT_PASSWORD } = require('../../src/seed/data/users.data');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { APPOINTMENT_STATUS_VALUES } = require('../../src/constants/appointmentStatuses');

describe('Seed Data Mechanism (Integration & Validation tests)', () => {
  let originalEnv;

  beforeAll(async () => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();
    await Promise.all([
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Order.deleteMany({}),
      Appointment.deleteMany({}),
      Prescription.deleteMany({}),
      Inventory.deleteMany({}),
      Staff.deleteMany({}),
      Customer.deleteMany({}),
      Admin.deleteMany({}),
      Branch.deleteMany({}),
    ]);
  });

  beforeEach(async () => {
    await Promise.all([
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Order.deleteMany({}),
      Appointment.deleteMany({}),
      Prescription.deleteMany({}),
      Inventory.deleteMany({}),
      Staff.deleteMany({}),
      Customer.deleteMany({}),
      Admin.deleteMany({}),
      Branch.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      OrderItem.deleteMany({}),
      Payment.deleteMany({}),
      Order.deleteMany({}),
      Appointment.deleteMany({}),
      Prescription.deleteMany({}),
      Inventory.deleteMany({}),
      Staff.deleteMany({}),
      Customer.deleteMany({}),
      Admin.deleteMany({}),
      Branch.deleteMany({}),
    ]);
    await disconnectDatabase();
    process.env.NODE_ENV = originalEnv;
  });

  it('should execute seed operation successfully against test database (AC1)', async () => {
    const summary = await seedDatabase();

    expect(summary.branchesCreated).toBeGreaterThan(0);
    expect(summary.adminsCreated).toBeGreaterThan(0);
    expect(summary.staffCreated).toBeGreaterThan(0);
    expect(summary.customersCreated).toBeGreaterThan(0);
    expect(summary.inventoryCreated).toBeGreaterThan(0);
    expect(summary.prescriptionsCreated).toBeGreaterThan(0);
  });

  it('should seed representative Customer accounts with valid bcrypt hashes (AC3, AC7, AC8)', async () => {
    await seedDatabase();

    const customers = await Customer.find().select('+passwordHash');
    expect(customers.length).toBeGreaterThanOrEqual(3);

    for (const customer of customers) {
      expect(customer.name).toBeDefined();
      expect(customer.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(customer.role).toBe(ROLE_VALUES.CUSTOMER);
      expect(customer.passwordHash).toMatch(/^\$2[ab]\$12\$/);

      const isValidPassword = await bcrypt.compare(DEV_DEFAULT_PASSWORD, customer.passwordHash);
      expect(isValidPassword).toBe(true);
    }
  });

  it('should seed representative Staff and Admin accounts with valid roles (AC4, AC7, AC8)', async () => {
    await seedDatabase();

    const admins = await Admin.find().select('+passwordHash');
    expect(admins.length).toBeGreaterThanOrEqual(1);
    expect(admins[0].role).toBe(ROLE_VALUES.SYSTEM_ADMIN);
    expect(admins[0].passwordHash).toMatch(/^\$2[ab]\$12\$/);

    const staffMembers = await Staff.find().select('+passwordHash');
    expect(staffMembers.length).toBeGreaterThanOrEqual(4);

    const staffRoles = staffMembers.map((s) => s.role);
    expect(staffRoles).toContain(ROLE_VALUES.BRANCH_MANAGER);
    expect(staffRoles).toContain(ROLE_VALUES.INVENTORY_MANAGER);
    expect(staffRoles).toContain(ROLE_VALUES.OPTOMETRIST);
    expect(staffRoles).toContain(ROLE_VALUES.SALES_ASSISTANT_CASHIER);

    for (const staff of staffMembers) {
      expect(staff.branchId).toBeDefined();
      expect(staff.passwordHash).toMatch(/^\$2[ab]\$12\$/);
    }
  });

  it('should seed Branch records (AC5)', async () => {
    await seedDatabase();

    const branches = await Branch.find();
    expect(branches.length).toBeGreaterThanOrEqual(3);

    for (const branch of branches) {
      expect(branch.address).toBeDefined();
      expect(branch.contactNumber).toBeDefined();
    }
  });

  it('should seed Inventory records linked to valid branches supporting catalog filtering (AC6)', async () => {
    await seedDatabase();

    const inventoryItems = await Inventory.find().populate('branchId');
    expect(inventoryItems.length).toBeGreaterThanOrEqual(10);

    const categories = new Set(inventoryItems.map((item) => item.category));
    expect(categories.has('Sunglasses')).toBe(true);
    expect(categories.has('Sports')).toBe(true);
    expect(categories.has('Men')).toBe(true);
    expect(categories.has('Women')).toBe(true);

    const brands = new Set(inventoryItems.map((item) => item.brand));
    expect(brands.has('Ray-Ban')).toBe(true);
    expect(brands.has('Oakley')).toBe(true);

    for (const item of inventoryItems) {
      expect(item.price).toBeGreaterThanOrEqual(0);
      expect(item.quantity).toBeGreaterThanOrEqual(0);
      expect(item.branchId).toBeDefined();
      expect(item.branchId._id).toBeDefined();
    }
  });

  it('should seed Clinical Prescriptions according to ADR-001 (FR-002, FR-013)', async () => {
    await seedDatabase();

    const prescriptions = await Prescription.find().populate('customerId').populate('recordedBy');
    expect(prescriptions.length).toBeGreaterThanOrEqual(3);

    const kamalCustomer = await Customer.findOne({ email: 'kamal.customer@example.com' });
    const kamalPrescriptions = await Prescription.find({ customerId: kamalCustomer._id }).sort({
      recordedAt: -1,
    });

    // Tests prescription history support (FR-002)
    expect(kamalPrescriptions.length).toBe(2);

    for (const rx of prescriptions) {
      expect(rx.customerId).toBeDefined();
      expect(rx.recordedBy).toBeDefined();
      expect(rx.recordedBy.role).toBe(ROLE_VALUES.OPTOMETRIST);
      expect(rx.rightEye.distance).toBeDefined();
      expect(rx.rightEye.reading).toBeDefined();
      expect(rx.leftEye.distance).toBeDefined();
      expect(rx.leftEye.reading).toBeDefined();
      expect(typeof rx.remarks).toBe('string');
      expect(typeof rx.isArchived).toBe('boolean');
    }
  });

  it('should be repeatable without creating uncontrolled duplicate records on consecutive runs (AC2)', async () => {
    await seedDatabase();
    const countAfterFirstRun = {
      branches: await Branch.countDocuments(),
      customers: await Customer.countDocuments(),
      staff: await Staff.countDocuments(),
      admins: await Admin.countDocuments(),
      inventory: await Inventory.countDocuments(),
      prescriptions: await Prescription.countDocuments(),
    };

    const secondRun = await seedDatabase();
    const countAfterSecondRun = {
      branches: await Branch.countDocuments(),
      customers: await Customer.countDocuments(),
      staff: await Staff.countDocuments(),
      admins: await Admin.countDocuments(),
      inventory: await Inventory.countDocuments(),
      prescriptions: await Prescription.countDocuments(),
    };

    expect(secondRun.branchesCreated).toBe(0);
    expect(secondRun.customersCreated).toBe(0);
    expect(secondRun.staffCreated).toBe(0);
    expect(secondRun.adminsCreated).toBe(0);
    expect(secondRun.inventoryCreated).toBe(0);
    expect(secondRun.prescriptionsCreated).toBe(0);
    expect(countAfterSecondRun).toEqual(countAfterFirstRun);
  });

  it('should wipe dependent collections and reseed clean data when reset option is enabled (AC2)', async () => {
    await seedDatabase();

    const customer = await Customer.findOne();
    const staff = await Staff.findOne();

    // Create dependent records (Order, Appointment) to test reset cleanup
    await Order.create({
      customerId: customer._id,
      orderDate: new Date(),
      orderAmount: 15000,
    });
    await Appointment.create({
      customerId: customer._id,
      staffId: staff._id,
      dateTime: new Date(),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    });

    expect(await Order.countDocuments()).toBe(1);
    expect(await Appointment.countDocuments()).toBe(1);

    const summary = await seedDatabase({ reset: true });

    expect(summary.reset).toBe(true);
    expect(await Order.countDocuments()).toBe(0);
    expect(await Appointment.countDocuments()).toBe(0);
    expect(await Branch.countDocuments()).toBe(3);
  });

  it('should reject seeding when NODE_ENV is production (AC9)', async () => {
    process.env.NODE_ENV = 'production';

    await expect(seedDatabase()).rejects.toThrow(PRODUCTION_SAFETY_ERROR);

    process.env.NODE_ENV = 'test';
  });

  it('should ensure all seeded documents satisfy Mongoose schema validation (AC11)', async () => {
    await seedDatabase();

    const [branches, customers, staffMembers, admins, inventoryItems, prescriptions] =
      await Promise.all([
        Branch.find(),
        Customer.find(),
        Staff.find(),
        Admin.find(),
        Inventory.find(),
        Prescription.find(),
      ]);

    for (const b of branches) await expect(b.validate()).resolves.toBeUndefined();
    for (const c of customers) await expect(c.validate()).resolves.toBeUndefined();
    for (const s of staffMembers) await expect(s.validate()).resolves.toBeUndefined();
    for (const a of admins) await expect(a.validate()).resolves.toBeUndefined();
    for (const i of inventoryItems) await expect(i.validate()).resolves.toBeUndefined();
    for (const p of prescriptions) await expect(p.validate()).resolves.toBeUndefined();
  });
});
