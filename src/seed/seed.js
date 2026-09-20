const { connectDatabase } = require('../config/database');
const Branch = require('../models/branch.model');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const Inventory = require('../models/inventory.model');
const Prescription = require('../models/prescription.model');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Appointment = require('../models/appointment.model');
const Payment = require('../models/payment.model');
const { createInventory } = require('../services/inventory.service');
const { hashPassword } = require('../services/auth.service');
const { SEED_BRANCHES } = require('./data/branches.data');
const {
  SEED_ADMINS,
  SEED_STAFF,
  SEED_CUSTOMERS,
  DEV_DEFAULT_PASSWORD,
} = require('./data/users.data');
const { SEED_INVENTORY_ITEMS } = require('./data/inventory.data');
const { SEED_PRESCRIPTIONS } = require('./data/prescriptions.data');

const PRODUCTION_SAFETY_ERROR =
  'Production safety check triggered: Seeding database is prohibited in production environment.';

/**
 * Main Seed Runner Engine (AC1, AC2, AC9, AC11)
 *
 * @param {Object} options
 * @param {boolean} [options.reset=false] - Whether to wipe existing seed and dependent collections before seeding
 * @param {mongoose.Connection} [options.connection=null] - Optional existing database connection
 * @returns {Promise<Object>} Seed summary report
 */
async function seedDatabase({ reset = false, connection = null } = {}) {
  // AC9: Environment Protection Safeguard
  if (process.env.NODE_ENV === 'production') {
    throw new Error(PRODUCTION_SAFETY_ERROR);
  }

  let dbConnection = connection;
  if (!dbConnection || dbConnection.readyState !== 1) {
    dbConnection = await connectDatabase();
  }

  // AC2: Repeatable Execution - Reset strategy with cascading dependency cleanup
  if (reset) {
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
  }

  const branchMap = new Map();
  let branchesCreated = 0;
  let adminsCreated = 0;
  let staffCreated = 0;
  let customersCreated = 0;
  let inventoryCreated = 0;
  let prescriptionsCreated = 0;

  // Compute password hash using application central auth service hashing helper
  const devPasswordHash = await hashPassword(DEV_DEFAULT_PASSWORD);

  // 1. Seed Branches (AC5)
  for (const branchData of SEED_BRANCHES) {
    let branch = await Branch.findOne({ address: branchData.address });
    if (!branch) {
      branch = await Branch.create({
        address: branchData.address,
        contactNumber: branchData.contactNumber,
      });
      branchesCreated += 1;
    }
    branchMap.set(branchData.codeName, branch._id);
  }

  // 2. Seed Admins (AC4, AC7)
  for (const adminData of SEED_ADMINS) {
    const existing = await Admin.exists({ email: adminData.email });
    if (!existing) {
      await Admin.create({
        ...adminData,
        passwordHash: devPasswordHash,
      });
      adminsCreated += 1;
    }
  }

  // 3. Seed Staff (AC4, AC7)
  for (const staffData of SEED_STAFF) {
    const existing = await Staff.exists({ email: staffData.email });
    if (!existing) {
      const branchId = branchMap.get(staffData.branchCodeName) || null;
      await Staff.create({
        name: staffData.name,
        email: staffData.email,
        phone: staffData.phone,
        address: staffData.address,
        role: staffData.role,
        branchId,
        passwordHash: devPasswordHash,
      });
      staffCreated += 1;
    }
  }

  // 4. Seed Customers (AC3, AC7)
  for (const customerData of SEED_CUSTOMERS) {
    const existing = await Customer.exists({ email: customerData.email });
    if (!existing) {
      await Customer.create({
        ...customerData,
        passwordHash: devPasswordHash,
      });
      customersCreated += 1;
    }
  }

  // 5. Seed Inventory (AC6, AC11)
  for (const itemData of SEED_INVENTORY_ITEMS) {
    const branchId = branchMap.get(itemData.branchCodeName);
    if (!branchId) {
      continue;
    }

    const existing = await Inventory.exists({
      branchId,
      itemName: itemData.itemName,
    });

    if (!existing) {
      await createInventory({
        branchId,
        itemName: itemData.itemName,
        category: itemData.category,
        brand: itemData.brand,
        price: itemData.price,
        quantity: itemData.quantity,
      });
      inventoryCreated += 1;
    }
  }

  // 6. Seed Prescriptions (ADR-001, FR-002, FR-013)
  for (const rxData of SEED_PRESCRIPTIONS) {
    const customer = await Customer.findOne({ email: rxData.customerEmail });
    const staff = await Staff.findOne({ email: rxData.staffEmail });
    if (!customer || !staff) {
      continue;
    }

    const existing = await Prescription.exists({
      customerId: customer._id,
      recordedAt: rxData.recordedAt,
    });

    if (!existing) {
      await Prescription.create({
        customerId: customer._id,
        recordedBy: staff._id,
        recordedAt: rxData.recordedAt,
        rightEye: rxData.rightEye,
        leftEye: rxData.leftEye,
        remarks: rxData.remarks,
        isArchived: rxData.isArchived,
      });
      prescriptionsCreated += 1;
    }
  }

  return {
    reset,
    branchesCreated,
    adminsCreated,
    staffCreated,
    customersCreated,
    inventoryCreated,
    prescriptionsCreated,
    totalBranches: await Branch.countDocuments({}),
    totalAdmins: await Admin.countDocuments({}),
    totalStaff: await Staff.countDocuments({}),
    totalCustomers: await Customer.countDocuments({}),
    totalInventory: await Inventory.countDocuments({}),
    totalPrescriptions: await Prescription.countDocuments({}),
  };
}

module.exports = {
  PRODUCTION_SAFETY_ERROR,
  seedDatabase,
};
