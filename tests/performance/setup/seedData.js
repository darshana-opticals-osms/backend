/**
 * Representative Performance Test Data Fixture Seeder (AC4)
 *
 * Populates isolated non-production database with realistic distributions of:
 * - Branches (3 branches)
 * - Users across all RBAC roles (Admin, Staff, Doctor, Optometrist, Customers)
 * - Products and branch-level inventory items (50 items across multiple categories)
 * - Doctor Sessions and Appointments (5 sessions, 15 appointments)
 * - Clinical Prescriptions (15 records)
 * - Orders, OrderItems, and Payments (25 historical orders over 180 days)
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Branch = require('../../../src/models/branch.model');
const Admin = require('../../../src/models/admin.model');
const Staff = require('../../../src/models/staff.model');
const Customer = require('../../../src/models/customer.model');
const Doctor = require('../../../src/models/doctor.model');
const DoctorSession = require('../../../src/models/doctorSession.model');
const Appointment = require('../../../src/models/appointment.model');
const Inventory = require('../../../src/models/inventory.model');
const Prescription = require('../../../src/models/prescription.model');
const Order = require('../../../src/models/order.model');
const OrderItem = require('../../../src/models/orderItem.model');
const Payment = require('../../../src/models/payment.model');
const { ROLE_VALUES } = require('../../../src/constants/roles');
const { ORDER_STATUS_VALUES } = require('../../../src/constants/orderStatuses');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../../src/constants/payment');
const { APPOINTMENT_STATUS_VALUES } = require('../../../src/constants/appointmentStatuses');
const {
  ITEM_CLASSIFICATIONS,
  LOYALTY_ELIGIBILITY,
} = require('../../../src/constants/itemClassification');

const PERF_PASSWORD = 'PerfPassword123!';
const JWT_SECRET = 'osms-perf-isolated-jwt-secret-key-32chars-min!';

/**
 * Creates an authorized JWT token for testing.
 */
function createToken({ userId, role = ROLE_VALUES.CUSTOMER, branchId = null }) {
  return jwt.sign({ userId, role, branchId }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '4h',
  });
}

/**
 * Seeds representative test records for performance benchmarking.
 * @returns {Promise<Object>} Seeded entity manifest with tokens and test IDs
 */
async function seedPerformanceData() {
  const passwordHash = await bcrypt.hash(PERF_PASSWORD, 10);

  // 1. Clear existing collections to guarantee deterministic baseline
  await Promise.all([
    OrderItem.collection.deleteMany({}),
    Payment.deleteMany({}),
    Order.deleteMany({}),
    Appointment.deleteMany({}),
    DoctorSession.deleteMany({}),
    Prescription.deleteMany({}),
    Inventory.deleteMany({}),
    Doctor.deleteMany({}),
    Staff.deleteMany({}),
    Customer.deleteMany({}),
    Admin.deleteMany({}),
    Branch.deleteMany({}),
  ]);

  // 2. Branches
  const branches = await Branch.create([
    { codeName: 'COL-01', address: '100 Galle Road, Colombo 03', contactNumber: '+94112345671' },
    { codeName: 'GAM-02', address: '45 Kandy Road, Gampaha', contactNumber: '+94332211442' },
    { codeName: 'KAN-03', address: '88 Peradeniya Road, Kandy', contactNumber: '+94812233443' },
  ]);

  const [colomboBranch, gampahaBranch, kandyBranch] = branches;

  // 3. Administrative & Staff Accounts
  const admin = await Admin.create({
    name: 'Performance Admin',
    email: 'perf.admin@example.com',
    phone: '+94770000001',
    passwordHash,
  });

  const staffColombo = await Staff.create({
    name: 'Colombo Branch Manager',
    email: 'perf.manager.colombo@example.com',
    phone: '+94770000002',
    address: 'Colombo 03',
    role: ROLE_VALUES.BRANCH_MANAGER,
    branchId: colomboBranch._id,
    passwordHash,
  });

  const staffGampaha = await Staff.create({
    name: 'Gampaha Branch Assistant',
    email: 'perf.assistant.gampaha@example.com',
    phone: '+94770000003',
    address: 'Gampaha City',
    role: ROLE_VALUES.BRANCH_ASSISTANT,
    branchId: gampahaBranch._id,
    passwordHash,
  });

  const optometristColombo = await Staff.create({
    name: 'Colombo Optometrist Lead',
    email: 'perf.optometrist.colombo@example.com',
    phone: '+94770000005',
    address: 'Colombo 05',
    role: ROLE_VALUES.OPTOMETRIST,
    branchId: colomboBranch._id,
    passwordHash,
  });

  // Doctor entity
  const doctor = await Doctor.create({
    name: 'Dr. Nirmal Senanayake',
    specialization: 'Ophthalmologist',
    isActive: true,
  });

  // 4. Customers (10 representative accounts)
  const customerDocs = [];
  for (let i = 1; i <= 10; i++) {
    customerDocs.push({
      name: `Performance Customer ${i}`,
      email: `perf.customer${i}@example.com`,
      phone: `+947100000${i.toString().padStart(2, '0')}`,
      address: `${10 + i} High Level Road, Nugegoda`,
      passwordHash,
    });
  }
  const customers = await Customer.create(customerDocs);

  // 5. Products & Inventory (50 items distributed across branches)
  const categories = ['Frames', 'Lenses', 'Sunglasses', 'Contact Lenses', 'Accessories'];
  const brands = [
    'Ray-Ban',
    'Oakley',
    'Gucci',
    'Darshana Classic',
    'Zeiss',
    'Essilor',
    'Bausch + Lomb',
  ];
  const classifications = [
    ITEM_CLASSIFICATIONS.FRAME,
    ITEM_CLASSIFICATIONS.MERCHANDISE,
    ITEM_CLASSIFICATIONS.PRESCRIPTION_PRODUCT,
    ITEM_CLASSIFICATIONS.ACCESSORY,
  ];

  const inventoryDocs = [];
  let itemCounter = 1;

  for (const branch of branches) {
    for (let j = 1; j <= 17; j++) {
      const category = categories[(itemCounter + j) % categories.length];
      const brand = brands[(itemCounter + j) % brands.length];
      const itemClassification = classifications[(itemCounter + j) % classifications.length];
      const price = 2500 + ((itemCounter * 650) % 35000);
      const quantity = 5 + ((itemCounter * 7) % 40);

      inventoryDocs.push({
        branchId: branch._id,
        itemName: `${brand} ${category} Model-${itemCounter}`,
        category,
        brand,
        itemClassification,
        price,
        quantity,
      });
      itemCounter++;
    }
  }

  // Add 1 constrained item with quantity=1 specifically for checkout race condition testing
  inventoryDocs.push({
    branchId: colomboBranch._id,
    itemName: 'Ultra Rare Limited Frame (Contention Item)',
    category: 'Frames',
    brand: 'Darshana Prestige',
    itemClassification: ITEM_CLASSIFICATIONS.FRAME,
    price: 45000,
    quantity: 1,
  });

  const inventoryItems = await Inventory.create(inventoryDocs);

  // 6. Doctor Sessions and Appointments
  const doctorSessions = await DoctorSession.create([
    {
      doctorId: doctor._id,
      branchId: colomboBranch._id,
      startAt: new Date(Date.now() + 86400000 * 2), // 2 days ahead
      endAt: new Date(Date.now() + 86400000 * 2 + 14400000), // +4 hours
      capacity: 10,
      confirmedCount: 3,
    },
    {
      doctorId: doctor._id,
      branchId: gampahaBranch._id,
      startAt: new Date(Date.now() + 86400000 * 3),
      endAt: new Date(Date.now() + 86400000 * 3 + 14400000),
      capacity: 8,
      confirmedCount: 2,
    },
    {
      doctorId: doctor._id,
      branchId: kandyBranch._id,
      startAt: new Date(Date.now() + 86400000 * 5),
      endAt: new Date(Date.now() + 86400000 * 5 + 14400000),
      capacity: 12,
      confirmedCount: 5,
    },
    // Constrained session with capacity=1 for appointment race condition testing
    {
      doctorId: doctor._id,
      branchId: colomboBranch._id,
      startAt: new Date(Date.now() + 86400000 * 7),
      endAt: new Date(Date.now() + 86400000 * 7 + 7200000),
      capacity: 1,
      confirmedCount: 0,
    },
    {
      doctorId: doctor._id,
      branchId: colomboBranch._id,
      startAt: new Date(Date.now() - 86400000 * 10), // Past session
      endAt: new Date(Date.now() - 86400000 * 10 + 14400000),
      capacity: 10,
      confirmedCount: 5,
    },
  ]);

  // Appointments for the sessions
  const appointmentDocs = [];
  for (let i = 0; i < 15; i++) {
    const session = doctorSessions[i % (doctorSessions.length - 1)]; // exclude constrained session
    appointmentDocs.push({
      customerId: customers[i % customers.length]._id,
      doctorId: doctor._id,
      sessionId: session._id,
      branchId: session.branchId,
      dateTime: new Date(session.startAt.getTime() + i * 1800000),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
      position: (i % 5) + 1,
    });
  }
  const appointments = await Appointment.create(appointmentDocs);

  // 7. Clinical Prescriptions (15 records)
  const prescriptionDocs = [];
  for (let i = 0; i < 15; i++) {
    prescriptionDocs.push({
      customerId: customers[i % customers.length]._id,
      recordedBy: staffColombo._id,
      recordedAt: new Date(Date.now() - (i + 1) * 86400000 * 5),
      rightEye: { sphere: -1.75 + i * 0.25, cylinder: -0.5, axis: 90, add: 1.0 },
      leftEye: { sphere: -1.5 + i * 0.25, cylinder: -0.25, axis: 85, add: 1.0 },
      remarks: `Performance test prescription record #${i + 1}`,
      isArchived: false,
    });
  }
  const prescriptions = await Prescription.create(prescriptionDocs);

  // 8. Orders, OrderItems & Payments (25 historical orders spread over 180 days for reporting)
  const orders = [];
  const orderStatuses = [
    ORDER_STATUS_VALUES.COMPLETED,
    ORDER_STATUS_VALUES.COMPLETED,
    ORDER_STATUS_VALUES.PROCESSING,
    ORDER_STATUS_VALUES.READY_FOR_PICKUP,
  ];

  for (let i = 1; i <= 25; i++) {
    const customer = customers[i % customers.length];
    const branch = branches[i % branches.length];
    const item = inventoryItems[i % inventoryItems.length];
    const itemPrice = item.price || 5000;
    const orderDate = new Date(Date.now() - i * 6.5 * 86400000); // Distributed over ~160 days
    const status = orderStatuses[i % orderStatuses.length];

    const order = await Order.create({
      customerId: customer._id,
      branchId: branch._id,
      orderDate,
      orderAmount: itemPrice * 2,
      orderAddress: customer.address,
      status,
      statusUpdatedAt: orderDate,
      statusHistory: [
        {
          status: ORDER_STATUS_VALUES.ORDER_CREATED,
          changedAt: orderDate,
          changedBy: staffColombo._id,
          source: 'USER',
        },
        {
          status,
          changedAt: orderDate,
          changedBy: staffColombo._id,
          source: 'USER',
        },
      ],
    });

    const classification = item.itemClassification || ITEM_CLASSIFICATIONS.MERCHANDISE;
    const eligibility = LOYALTY_ELIGIBILITY[classification] || LOYALTY_ELIGIBILITY.MERCHANDISE;

    await OrderItem.create({
      orderId: order._id,
      inventoryId: item._id,
      fulfilledInventoryId: item._id,
      itemName: item.itemName,
      price: itemPrice,
      quantity: 2,
      classificationSnapshot: {
        source: 'Inventory',
        sourceInventoryId: item._id,
        category: item.category,
        itemClassification: classification,
        loyaltyEligibility: eligibility,
      },
    });

    await Payment.create({
      orderId: order._id,
      amount: itemPrice * 2,
      status: PAYMENT_STATUS.COMPLETED,
      method: PAYMENT_METHOD.ONLINE_GATEWAY,
      providerTransactionId: `PERF-PAY-${i.toString().padStart(4, '0')}`,
      createdAt: orderDate,
      updatedAt: orderDate,
    });

    orders.push(order);
  }

  // Generate Authoritative JWT Tokens for test manifest
  const tokens = {
    adminToken: createToken({ userId: admin._id, role: ROLE_VALUES.SYSTEM_ADMIN }),
    staffColomboToken: createToken({
      userId: staffColombo._id,
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: colomboBranch._id,
    }),
    staffGampahaToken: createToken({
      userId: staffGampaha._id,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      branchId: gampahaBranch._id,
    }),
    optometristToken: createToken({
      userId: optometristColombo._id,
      role: ROLE_VALUES.OPTOMETRIST,
      branchId: colomboBranch._id,
    }),
    customer1Token: createToken({ userId: customers[0]._id, role: ROLE_VALUES.CUSTOMER }),
    customer2Token: createToken({ userId: customers[1]._id, role: ROLE_VALUES.CUSTOMER }),
  };

  return {
    branches,
    admin,
    staff: [staffColombo, staffGampaha, optometristColombo],
    doctor,
    customers,
    inventoryItems,
    doctorSessions,
    appointments,
    prescriptions,
    orders,
    tokens,
    credentials: {
      password: PERF_PASSWORD,
      adminEmail: admin.email,
      staffEmail: staffColombo.email,
      customerEmail: customers[0].email,
    },
  };
}

module.exports = {
  seedPerformanceData,
  createToken,
  PERF_PASSWORD,
  JWT_SECRET,
};
