/**
 * Performance Setup & Seeding Verification Script (AC3, AC4)
 *
 * Runs isolated MongoDB environment, seeds representative data,
 * verifies record counts and relationships, and reports clean status.
 */

const { setupPerfEnvironment, teardownPerfEnvironment } = require('./perfEnvironment');
const { seedPerformanceData } = require('./seedData');
const Branch = require('../../../src/models/branch.model');
const Customer = require('../../../src/models/customer.model');
const Staff = require('../../../src/models/staff.model');
const Admin = require('../../../src/models/admin.model');
const Doctor = require('../../../src/models/doctor.model');
const Inventory = require('../../../src/models/inventory.model');
const DoctorSession = require('../../../src/models/doctorSession.model');
const Appointment = require('../../../src/models/appointment.model');
const Prescription = require('../../../src/models/prescription.model');
const Order = require('../../../src/models/order.model');
const OrderItem = require('../../../src/models/orderItem.model');
const Payment = require('../../../src/models/payment.model');

async function verifyPerformanceSeed() {
  console.log('🚀 Initializing isolated safe performance environment...');
  const { uri } = await setupPerfEnvironment();
  console.log(`✅ In-memory database connected: ${uri}`);

  try {
    console.log('🌱 Seeding representative performance dataset (AC4)...');
    const manifest = await seedPerformanceData();

    // Verify counts in MongoDB
    const [
      branchCount,
      adminCount,
      staffCount,
      doctorCount,
      customerCount,
      inventoryCount,
      sessionCount,
      appointmentCount,
      rxCount,
      orderCount,
      orderItemCount,
      paymentCount,
    ] = await Promise.all([
      Branch.countDocuments(),
      Admin.countDocuments(),
      Staff.countDocuments(),
      Doctor.countDocuments(),
      Customer.countDocuments(),
      Inventory.countDocuments(),
      DoctorSession.countDocuments(),
      Appointment.countDocuments(),
      Prescription.countDocuments(),
      Order.countDocuments(),
      OrderItem.countDocuments(),
      Payment.countDocuments(),
    ]);

    console.log('\n======================================================');
    console.log('  REPRESENTATIVE TEST DATA VERIFICATION REPORT (AC4)  ');
    console.log('======================================================');
    console.table([
      {
        Entity: 'Branches',
        Count: branchCount,
        Expected: '>= 3',
        Status: branchCount >= 3 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Admins',
        Count: adminCount,
        Expected: '>= 1',
        Status: adminCount >= 1 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Staff',
        Count: staffCount,
        Expected: '>= 2',
        Status: staffCount >= 2 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Doctors',
        Count: doctorCount,
        Expected: '>= 1',
        Status: doctorCount >= 1 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Customers',
        Count: customerCount,
        Expected: '>= 10',
        Status: customerCount >= 10 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Inventory Items',
        Count: inventoryCount,
        Expected: '>= 50',
        Status: inventoryCount >= 50 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Doctor Sessions',
        Count: sessionCount,
        Expected: '>= 5',
        Status: sessionCount >= 5 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Appointments',
        Count: appointmentCount,
        Expected: '>= 15',
        Status: appointmentCount >= 15 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Prescriptions',
        Count: rxCount,
        Expected: '>= 15',
        Status: rxCount >= 15 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Orders',
        Count: orderCount,
        Expected: '>= 25',
        Status: orderCount >= 25 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Order Items',
        Count: orderItemCount,
        Expected: '>= 25',
        Status: orderItemCount >= 25 ? 'PASS' : 'FAIL',
      },
      {
        Entity: 'Payments',
        Count: paymentCount,
        Expected: '>= 25',
        Status: paymentCount >= 25 ? 'PASS' : 'FAIL',
      },
    ]);

    console.log('🔑 Generated Auth Tokens for Benchmarks:');
    console.log(` - Admin Token: ${manifest.tokens.adminToken ? 'Available (HS256)' : 'Missing'}`);
    console.log(
      ` - Staff Token: ${manifest.tokens.staffColomboToken ? 'Available (HS256)' : 'Missing'}`
    );
    console.log(
      ` - Customer Token: ${manifest.tokens.customer1Token ? 'Available (HS256)' : 'Missing'}`
    );

    const hasFailures = [
      branchCount < 3,
      adminCount < 1,
      staffCount < 2,
      doctorCount < 1,
      customerCount < 10,
      inventoryCount < 50,
      sessionCount < 5,
      appointmentCount < 15,
      rxCount < 15,
      orderCount < 25,
      orderItemCount < 25,
      paymentCount < 25,
      !manifest.tokens.adminToken,
      !manifest.tokens.staffColomboToken,
      !manifest.tokens.customer1Token,
    ].some(Boolean);

    if (hasFailures) {
      throw new Error('One or more seeded representative entities failed count verification.');
    }

    console.log('\n✅ All representative datasets validated successfully!');
  } finally {
    console.log('🧹 Tearing down performance test environment...');
    await teardownPerfEnvironment();
    console.log('✅ Teardown complete.\n');
  }
}

if (require.main === module) {
  verifyPerformanceSeed().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  });
}

module.exports = { verifyPerformanceSeed };
