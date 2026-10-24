/**
 * Failure and Recovery Behavior Verification Suite (AC12)
 *
 * Verifies that the OSMS backend degrades safely under representative failure scenarios:
 * - Malformed / Injection inputs fail safely without process crashes
 * - Expired & invalid authentication tokens are rejected without secret leaks
 * - Oversized payloads are cleanly rejected
 * - Error envelopes are client-safe and never leak database internals or stack traces
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../setup/seedData');

/**
 * Runs the failure and resilience test suite.
 * @param {Express.Application} app
 * @returns {Promise<Object>} Test outcome metrics
 */
async function runFaultRecoveryTests(app) {
  console.log('\n🛡️  [AC12] Running Failure and Recovery Behavior Suite...');

  const results = {
    testName: 'AC12: Failure & Recovery Behavior Verification',
    scenarios: [],
    allPassed: true,
  };

  // Case 1: Malformed & NoSQL Injection Request Input
  console.log('  ▸ Case 1: Testing NoSQL injection & malformed payload rejection...');
  const injectionResponse = await request(app)
    .post('/api/auth/login')
    .send({
      email: { $gt: '' }, // NoSQL injection attempt
      password: 'password123',
    });

  const injectionSafe = injectionResponse.status === 422 || injectionResponse.status === 400;
  const noStackLeak1 = !JSON.stringify(injectionResponse.body).includes('node_modules');

  const case1Passed = injectionSafe && noStackLeak1;
  if (!case1Passed) results.allPassed = false;

  results.scenarios.push({
    case: 'NoSQL injection attack prevention',
    statusReturned: injectionResponse.status,
    safeResponse: injectionSafe,
    noStackLeak: noStackLeak1,
    passed: case1Passed,
  });
  console.log(
    `    Result: ${case1Passed ? '✅ PASS' : '❌ FAIL'} (Status: ${injectionResponse.status})`
  );

  // Case 2: Expired JWT Token Handling
  console.log('  ▸ Case 2: Testing expired JWT token rejection...');
  const expiredToken = jwt.sign(
    { userId: '507f1f77bcf86cd799439011', role: 'CUSTOMER' },
    JWT_SECRET,
    { expiresIn: '-10s' } // Expired 10 seconds ago
  );

  const expiredResponse = await request(app)
    .get('/api/profile/me')
    .set('Authorization', `Bearer ${expiredToken}`);

  const expiredHandled = expiredResponse.status === 401;
  const noSecretLeak2 =
    !JSON.stringify(expiredResponse.body).includes(JWT_SECRET) &&
    !JSON.stringify(expiredResponse.body).includes('secret');

  const case2Passed = expiredHandled && noSecretLeak2;
  if (!case2Passed) results.allPassed = false;

  results.scenarios.push({
    case: 'Expired JWT token safe rejection',
    statusReturned: expiredResponse.status,
    safeResponse: expiredHandled,
    noSecretLeak: noSecretLeak2,
    passed: case2Passed,
  });
  console.log(
    `    Result: ${case2Passed ? '✅ PASS' : '❌ FAIL'} (Status: ${expiredResponse.status})`
  );

  // Case 3: Tampered JWT Token Handling
  console.log('  ▸ Case 3: Testing tampered / invalid signature JWT token...');
  const tamperedToken = expiredToken.slice(0, -6) + 'abcdef';

  const tamperedResponse = await request(app)
    .get('/api/profile/me')
    .set('Authorization', `Bearer ${tamperedToken}`);

  const tamperedHandled = tamperedResponse.status === 401;
  const case3Passed = tamperedHandled;
  if (!case3Passed) results.allPassed = false;

  results.scenarios.push({
    case: 'Tampered JWT signature rejection',
    statusReturned: tamperedResponse.status,
    passed: case3Passed,
  });
  console.log(
    `    Result: ${case3Passed ? '✅ PASS' : '❌ FAIL'} (Status: ${tamperedResponse.status})`
  );

  // Case 4: Oversized Request Body Protection
  console.log('  ▸ Case 4: Testing oversized payload rejection...');
  const oversizedPayload = 'A'.repeat(1024 * 1024 * 12); // 12 MB payload (exceeds limit)

  const oversizedResponse = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send(`{"data":"${oversizedPayload}"}`);

  const oversizedHandled = oversizedResponse.status === 413;
  const case4Passed = oversizedHandled;
  if (!case4Passed) results.allPassed = false;

  results.scenarios.push({
    case: 'Oversized payload body limit enforcement',
    statusReturned: oversizedResponse.status,
    passed: case4Passed,
  });
  console.log(
    `    Result: ${case4Passed ? '✅ PASS' : '❌ FAIL'} (Status: ${oversizedResponse.status})`
  );

  // Case 5: Client-Safe Standard Error Envelope (RFC 7807 compliance)
  console.log('  ▸ Case 5: Verifying client-safe error response contract...');
  const notFoundResponse = await request(app).get('/api/non-existent-route-for-testing');

  const hasSafeContract =
    notFoundResponse.status === 404 &&
    notFoundResponse.body &&
    notFoundResponse.body.success === false &&
    typeof notFoundResponse.body.error === 'object';

  const noInternalDump =
    !JSON.stringify(notFoundResponse.body).includes('mongodb://') &&
    !JSON.stringify(notFoundResponse.body).includes('stack');

  const case5Passed = hasSafeContract && noInternalDump;
  if (!case5Passed) results.allPassed = false;

  results.scenarios.push({
    case: 'Client-safe error contract & zero internal information leakage',
    statusReturned: notFoundResponse.status,
    envelopeValid: hasSafeContract,
    zeroLeaks: noInternalDump,
    passed: case5Passed,
  });
  console.log(
    `    Result: ${case5Passed ? '✅ PASS' : '❌ FAIL'} (Status: ${notFoundResponse.status})\n`
  );

  return results;
}

module.exports = { runFaultRecoveryTests };
