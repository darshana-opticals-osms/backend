const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const Branch = require('../models/branch.model');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const Inventory = require('../models/inventory.model');
const { createInventory } = require('../services/inventory.service');
const { SEED_BRANCHES } = require('./data/branches.data');
const { SEED_ADMINS, SEED_STAFF, SEED_CUSTOMERS } = require('./data/users.data');
const { SEED_INVENTORY_ITEMS } = require('./data/inventory.data');

const PRODUCTION_SAFETY_ERROR =
  'Production safety check triggered: Seeding database is prohibited in production environment.';

/**
 * Main Seed Runner Engine (AC1, AC2, AC9, AC11)
 *
 * @param {Object} options
 * @param {boolean} [options.reset=false] - Whether to wipe existing seed collections before seeding
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

  // AC2: Repeatable Execution - Reset strategy
  if (reset) {
    await Promise.all([
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
      Admin.deleteMany({}),
      Inventory.deleteMany({}),
    ]);
  }

  const branchMap = new Map();
  let branchesCreated = 0;
  let adminsCreated = 0;
  let staffCreated = 0;
  let customersCreated = 0;
  let inventoryCreated = 0;

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
      await Admin.create(adminData);
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
        passwordHash: staffData.passwordHash,
      });
      staffCreated += 1;
    }
  }

  // 4. Seed Customers (AC3, AC7)
  for (const customerData of SEED_CUSTOMERS) {
    const existing = await Customer.exists({ email: customerData.email });
    if (!existing) {
      await Customer.create(customerData);
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

  return {
    reset,
    branchesCreated,
    adminsCreated,
    staffCreated,
    customersCreated,
    inventoryCreated,
    totalBranches: await Branch.countDocuments({}),
    totalAdmins: await Admin.countDocuments({}),
    totalStaff: await Staff.countDocuments({}),
    totalCustomers: await Customer.countDocuments({}),
    totalInventory: await Inventory.countDocuments({}),
  };
}

module.exports = {
  PRODUCTION_SAFETY_ERROR,
  seedDatabase,
};
