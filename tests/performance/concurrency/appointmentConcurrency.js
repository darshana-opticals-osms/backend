/**
 * Appointment Booking Concurrency & Slot Capacity Suite (AC10)
 *
 * Verifies that concurrent booking requests respect doctor session capacity:
 * - Exactly available capacity is booked
 * - Conflicting concurrent requests are rejected
 * - Zero overbooking beyond session capacity
 * - Sequential appointment positions assigned atomically
 */

const request = require('supertest');
const Branch = require('../../../src/models/branch.model');
const Doctor = require('../../../src/models/doctor.model');
const DoctorSession = require('../../../src/models/doctorSession.model');
const Appointment = require('../../../src/models/appointment.model');
const Customer = require('../../../src/models/customer.model');
const { createToken, PERF_PASSWORD } = require('../setup/seedData');
const { ROLE_VALUES } = require('../../../src/constants/roles');
const bcrypt = require('bcrypt');

/**
 * Runs the appointment concurrency test suite.
 * @param {Express.Application} app
 * @returns {Promise<Object>} Test outcome metrics
 */
async function runAppointmentConcurrencyTests(app) {
  console.log('\n📅 [AC10] Running Appointment Slot Capacity Concurrency Suite...');

  const results = {
    testName: 'AC10: Appointment Slot Contention & Capacity Integrity',
    scenarios: [],
    allPassed: true,
  };

  const branch = await Branch.findOne({ codeName: 'GAMPAHA_CENTRAL' });
  if (!branch) {
    throw new Error('Required branch GAMPAHA_CENTRAL not found.');
  }

  let doctor = await Doctor.findOne({ isActive: true });
  if (!doctor) {
    doctor = await Doctor.create({
      name: 'Dr. Concurrency Specialist',
      specialization: 'Ophthalmology',
      isActive: true,
    });
  }

  const passwordHash = await bcrypt.hash(PERF_PASSWORD, 10);

  // Scenario 1: Extreme Slot Contention (Capacity = 1, 5 concurrent bookings)
  console.log('  ▸ Scenario 1: 5 concurrent bookings competing for 1 session slot...');
  const startAt1 = new Date(Date.now() + 86400000 * 3); // 3 days ahead (> 24h lead time)
  const endAt1 = new Date(startAt1.getTime() + 7200000);

  const sessionSingle = await DoctorSession.create({
    doctorId: doctor._id,
    branchId: branch._id,
    startAt: startAt1,
    endAt: endAt1,
    capacity: 1, // EXACTLY 1 slot
    confirmedCount: 0,
  });

  const testCustomers1 = [];
  const tokens1 = [];

  for (let i = 1; i <= 5; i++) {
    const customer = await Customer.create({
      name: `Booking Race Customer ${i}`,
      email: `appt.race.${i}.${Date.now()}@example.com`,
      phone: `+947155550${i}`,
      address: `${i} Clinic Road, Gampaha`,
      passwordHash,
    });
    testCustomers1.push(customer);
    tokens1.push(createToken({ userId: customer._id, role: ROLE_VALUES.CUSTOMER }));
  }

  const startTime1 = process.hrtime.bigint();

  const responses1 = await Promise.all(
    tokens1.map((token) =>
      request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send({ sessionId: sessionSingle._id.toString() })
    )
  );

  const durationMs1 = Number(process.hrtime.bigint() - startTime1) / 1e6;

  const successfulBookings1 = responses1.filter((r) => r.status === 201);
  const rejectedBookings1 = responses1.filter((r) => r.status === 400 || r.status === 409);

  // Database verification
  const updatedSession1 = await DoctorSession.findById(sessionSingle._id).lean();
  const createdAppointments1 = await Appointment.find({
    sessionId: sessionSingle._id,
    status: 'CONFIRMED',
  }).lean();

  const scenario1Passed =
    successfulBookings1.length === 1 &&
    rejectedBookings1.length === 4 &&
    updatedSession1.confirmedCount === 1 &&
    createdAppointments1.length === 1 &&
    createdAppointments1[0].position === 1;

  if (!scenario1Passed) {
    results.allPassed = false;
  }

  const scenario1Report = {
    scenario: 'Single slot contention (Capacity = 1, Concurrency = 5)',
    durationMs: Number(durationMs1.toFixed(2)),
    expectedSuccess: 1,
    actualSuccess: successfulBookings1.length,
    expectedRejections: 4,
    actualRejections: rejectedBookings1.length,
    finalConfirmedCount: updatedSession1.confirmedCount,
    appointmentsPersisted: createdAppointments1.length,
    passed: scenario1Passed,
  };
  results.scenarios.push(scenario1Report);

  console.log(`    Result: ${scenario1Passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    - Successful Bookings: ${successfulBookings1.length} (Expected: 1)`);
  console.log(`    - Rejected Bookings: ${rejectedBookings1.length} (Expected: 4)`);
  console.log(
    `    - Session Confirmed Count: ${updatedSession1.confirmedCount} (Expected: 1, Capacity: 1)`
  );

  // Scenario 2: Two Slot Contention (Capacity = 2, 4 concurrent bookings)
  console.log('  ▸ Scenario 2: 4 concurrent bookings competing for 2 session slots...');
  const startAt2 = new Date(Date.now() + 86400000 * 4);
  const endAt2 = new Date(startAt2.getTime() + 7200000);

  const sessionDouble = await DoctorSession.create({
    doctorId: doctor._id,
    branchId: branch._id,
    startAt: startAt2,
    endAt: endAt2,
    capacity: 2, // EXACTLY 2 slots
    confirmedCount: 0,
  });

  const testCustomers2 = [];
  const tokens2 = [];

  for (let i = 1; i <= 4; i++) {
    const customer = await Customer.create({
      name: `Booking Race Duo ${i}`,
      email: `appt.race.duo.${i}.${Date.now()}@example.com`,
      phone: `+947144440${i}`,
      address: `${i} Hospital Road, Gampaha`,
      passwordHash,
    });
    testCustomers2.push(customer);
    tokens2.push(createToken({ userId: customer._id, role: ROLE_VALUES.CUSTOMER }));
  }

  const startTime2 = process.hrtime.bigint();

  const responses2 = await Promise.all(
    tokens2.map((token) =>
      request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${token}`)
        .send({ sessionId: sessionDouble._id.toString() })
    )
  );

  const durationMs2 = Number(process.hrtime.bigint() - startTime2) / 1e6;

  const successfulBookings2 = responses2.filter((r) => r.status === 201);
  const rejectedBookings2 = responses2.filter((r) => r.status === 400 || r.status === 409);

  const updatedSession2 = await DoctorSession.findById(sessionDouble._id).lean();
  const createdAppointments2 = await Appointment.find({
    sessionId: sessionDouble._id,
    status: 'CONFIRMED',
  })
    .sort({ position: 1 })
    .lean();

  const positions = createdAppointments2.map((a) => a.position);
  const distinctPositions = new Set(positions);

  const scenario2Passed =
    successfulBookings2.length === 2 &&
    rejectedBookings2.length === 2 &&
    updatedSession2.confirmedCount === 2 &&
    createdAppointments2.length === 2 &&
    distinctPositions.size === 2 &&
    positions[0] === 1 &&
    positions[1] === 2;

  if (!scenario2Passed) {
    results.allPassed = false;
  }

  const scenario2Report = {
    scenario: 'Two slots contention (Capacity = 2, Concurrency = 4)',
    durationMs: Number(durationMs2.toFixed(2)),
    expectedSuccess: 2,
    actualSuccess: successfulBookings2.length,
    expectedRejections: 2,
    actualRejections: rejectedBookings2.length,
    finalConfirmedCount: updatedSession2.confirmedCount,
    appointmentsPersisted: createdAppointments2.length,
    assignedPositions: positions,
    passed: scenario2Passed,
  };
  results.scenarios.push(scenario2Report);

  console.log(`    Result: ${scenario2Passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`    - Successful Bookings: ${successfulBookings2.length} (Expected: 2)`);
  console.log(`    - Rejected Bookings: ${rejectedBookings2.length} (Expected: 2)`);
  console.log(`    - Assigned Positions: [${positions.join(', ')}] (Expected: [1, 2])`);
  console.log(`    - Final Confirmed Count: ${updatedSession2.confirmedCount} (Expected: 2)\n`);

  return results;
}

module.exports = { runAppointmentConcurrencyTests };
