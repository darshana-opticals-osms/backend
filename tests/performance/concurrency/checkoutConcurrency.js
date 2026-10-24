/**
 * Checkout & Stock Transactional Concurrency Suite (AC9)
 *
 * Verifies that concurrent checkout requests preserve 100% ACID transactional integrity:
 * - Zero overselling
 * - Zero negative stock drift
 * - Exactly available stock is sold, and concurrent overflow requests are rejected
 */

const request = require('supertest');
const Cart = require('../../../src/models/cart.model');
const Order = require('../../../src/models/order.model');
const OrderItem = require('../../../src/models/orderItem.model');
const Inventory = require('../../../src/models/inventory.model');
const Branch = require('../../../src/models/branch.model');
const Customer = require('../../../src/models/customer.model');
const { createToken, PERF_PASSWORD } = require('../setup/seedData');
const { ROLE_VALUES } = require('../../../src/constants/roles');
const bcrypt = require('bcrypt');

/**
 * Runs the checkout concurrency test suite.
 * @param {Express.Application} app
 * @returns {Promise<Object>} Test outcome metrics
 */
async function runCheckoutConcurrencyTests(app) {
  console.log('\n🔒 [AC9] Running Checkout & Stock Concurrency Integrity Suite...');

  const results = {
    testName: 'AC9: Checkout Race Condition & Stock Integrity',
    scenarios: [],
    allPassed: true,
  };

  const branch = await Branch.findOne({ codeName: 'GAMPAHA_CENTRAL' });
  if (!branch) {
    throw new Error('Required branch GAMPAHA_CENTRAL not found.');
  }

  const passwordHash = await bcrypt.hash(PERF_PASSWORD, 10);

  // Scenario 1: Extreme Stock Contention (1 item remaining, 5 concurrent checkout requests)
  console.log('  ▸ Scenario 1: 5 concurrent checkouts competing for 1 remaining stock item...');
  const singleItem = await Inventory.create({
    branchId: branch._id,
    itemName: `Contention Item Single-${Date.now()}`,
    category: 'Frames',
    brand: 'Prestige Race',
    itemClassification: 'MERCHANDISE',
    price: 15000,
    quantity: 1, // EXACTLY 1 item in stock
  });

  // Create 5 test customers with populated carts
  const testCustomers = [];
  const tokens = [];

  for (let i = 1; i <= 5; i++) {
    const customer = await Customer.create({
      name: `Race Customer ${i}`,
      email: `checkout.race.${i}.${Date.now()}@example.com`,
      phone: `+947199990${i}`,
      address: `${i} Test Street, Gampaha`,
      passwordHash,
    });
    testCustomers.push(customer);

    await Cart.create({
      customerId: customer._id,
      items: [{ inventoryId: singleItem._id, quantity: 1 }],
    });

    tokens.push(createToken({ userId: customer._id, role: ROLE_VALUES.CUSTOMER }));
  }

  const startTime1 = process.hrtime.bigint();

  // Dispatch all 5 checkouts concurrently
  const responses1 = await Promise.all(
    tokens.map((token) =>
      request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send()
    )
  );

  const durationMs1 = Number(process.hrtime.bigint() - startTime1) / 1e6;

  const successfulCheckouts1 = responses1.filter((r) => r.status === 201);
  const rejectedCheckouts1 = responses1.filter((r) => r.status === 409 || r.status === 400);

  // Verify database side-effects
  const updatedItem1 = await Inventory.findById(singleItem._id).lean();
  const createdOrders1 = await Order.find({
    customerId: { $in: testCustomers.map((c) => c._id) },
  }).lean();
  const createdOrderItems1 = await OrderItem.find({
    inventoryId: singleItem._id,
  }).lean();

  const scenario1Passed =
    successfulCheckouts1.length === 1 &&
    rejectedCheckouts1.length === 4 &&
    updatedItem1.quantity === 0 &&
    createdOrders1.length === 1 &&
    createdOrderItems1.length === 1;

  if (!scenario1Passed) {
    results.allPassed = false;
  }

  const scenario1Report = {
    scenario: 'Single item contention (Stock = 1, Concurrency = 5)',
    durationMs: Number(durationMs1.toFixed(2)),
    expectedSuccess: 1,
    actualSuccess: successfulCheckouts1.length,
    expectedRejections: 4,
    actualRejections: rejectedCheckouts1.length,
    finalStock: updatedItem1.quantity,
    ordersCreated: createdOrders1.length,
    orderItemsPersisted: createdOrderItems1.length,
    passed: scenario1Passed,
  };
  results.scenarios.push(scenario1Report);

  console.log(`    Result: ${scenario1Passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    - Successful Orders: ${successfulCheckouts1.length} (Expected: 1)`);
  console.log(
    `    - Rejected (Insufficient Stock / Conflict): ${rejectedCheckouts1.length} (Expected: 4)`
  );
  console.log(`    - Final Stock in DB: ${updatedItem1.quantity} (Expected: 0, Negative Drift: 0)`);

  // Scenario 2: Multi-Stock Contention (Stock = 2, 4 concurrent checkout requests)
  console.log('  ▸ Scenario 2: 4 concurrent checkouts competing for 2 stock items...');
  const doubleItem = await Inventory.create({
    branchId: branch._id,
    itemName: `Contention Item Double-${Date.now()}`,
    category: 'Sunglasses',
    brand: 'Prestige Race Double',
    itemClassification: 'MERCHANDISE',
    price: 8500,
    quantity: 2, // EXACTLY 2 items in stock
  });

  const testCustomers2 = [];
  const tokens2 = [];

  for (let i = 1; i <= 4; i++) {
    const customer = await Customer.create({
      name: `Race Customer Duo ${i}`,
      email: `checkout.race.duo.${i}.${Date.now()}@example.com`,
      phone: `+947188880${i}`,
      address: `${i} Duo Street, Gampaha`,
      passwordHash,
    });
    testCustomers2.push(customer);

    await Cart.create({
      customerId: customer._id,
      items: [{ inventoryId: doubleItem._id, quantity: 1 }],
    });

    tokens2.push(createToken({ userId: customer._id, role: ROLE_VALUES.CUSTOMER }));
  }

  const startTime2 = process.hrtime.bigint();

  const responses2 = await Promise.all(
    tokens2.map((token) =>
      request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send()
    )
  );

  const durationMs2 = Number(process.hrtime.bigint() - startTime2) / 1e6;

  const successfulCheckouts2 = responses2.filter((r) => r.status === 201);
  const rejectedCheckouts2 = responses2.filter((r) => r.status === 409 || r.status === 400);

  const updatedItem2 = await Inventory.findById(doubleItem._id).lean();
  const createdOrders2 = await Order.find({
    customerId: { $in: testCustomers2.map((c) => c._id) },
  }).lean();

  const scenario2Passed =
    successfulCheckouts2.length === 2 &&
    rejectedCheckouts2.length === 2 &&
    updatedItem2.quantity === 0 &&
    createdOrders2.length === 2;

  if (!scenario2Passed) {
    results.allPassed = false;
  }

  const scenario2Report = {
    scenario: 'Two items contention (Stock = 2, Concurrency = 4)',
    durationMs: Number(durationMs2.toFixed(2)),
    expectedSuccess: 2,
    actualSuccess: successfulCheckouts2.length,
    expectedRejections: 2,
    actualRejections: rejectedCheckouts2.length,
    finalStock: updatedItem2.quantity,
    ordersCreated: createdOrders2.length,
    passed: scenario2Passed,
  };
  results.scenarios.push(scenario2Report);

  console.log(`    Result: ${scenario2Passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    - Successful Orders: ${successfulCheckouts2.length} (Expected: 2)`);
  console.log(`    - Rejected: ${rejectedCheckouts2.length} (Expected: 2)`);
  console.log(`    - Final Stock in DB: ${updatedItem2.quantity} (Expected: 0)\n`);

  return results;
}

module.exports = { runCheckoutConcurrencyTests };
