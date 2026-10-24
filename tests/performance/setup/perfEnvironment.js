/**
 * Isolated Safe Test Environment Bootstrapper (AC3)
 *
 * Guarantees zero connection to production/staging and provisions an
 * ephemeral MongoDB Memory Server with Replica Set support for transactions.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
let mongoServer = null;
let testApp = null;
let originalEnv = null;

// Apply safe performance test environment variables before any module loads
process.env.NODE_ENV = 'test';
process.env.PORT = '5050';
process.env.JWT_SECRET = 'osms-perf-isolated-jwt-secret-key-32chars-min!';
process.env.JWT_EXPIRES_IN = '2h';
process.env.PASSWORD_SALT_ROUNDS = '10';
process.env.RATE_LIMIT_MAX = '5000';
process.env.AUTH_RATE_LIMIT_MAX = '5000';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';

const PERF_ENV_DEFAULTS = {
  NODE_ENV: 'test',
  PORT: '5050',
  JWT_SECRET: 'osms-perf-isolated-jwt-secret-key-32chars-min!',
  JWT_EXPIRES_IN: '2h',
  PASSWORD_SALT_ROUNDS: '10',
  RATE_LIMIT_MAX: '5000',
  AUTH_RATE_LIMIT_MAX: '5000',
  RATE_LIMIT_WINDOW_MS: '60000',
  AUTH_RATE_LIMIT_WINDOW_MS: '60000',
};

/**
 * Initializes an isolated performance test environment.
 * @returns {Promise<{ app: Express.Application, connection: mongoose.Connection, uri: string }>}
 */
async function setupPerfEnvironment() {
  // AC3 Safety Safeguard
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
    throw new Error(
      `CRITICAL SAFETY VIOLATION: Performance suite must never run against ${process.env.NODE_ENV} environment.`
    );
  }

  originalEnv = { ...process.env };

  // Apply safe performance test environment variables
  for (const [key, value] of Object.entries(PERF_ENV_DEFAULTS)) {
    process.env[key] = value;
  }

  // Clear module cache for security/rateLimiter so new rate limits take effect
  const securityPath = require.resolve('../../../src/config/security');
  const rateLimiterPath = require.resolve('../../../src/middleware/rateLimiter');
  const appPath = require.resolve('../../../src/app');
  delete require.cache[securityPath];
  delete require.cache[rateLimiterPath];
  delete require.cache[appPath];

  const { createApp } = require('../../../src/app');
  for (const [key, value] of Object.entries(PERF_ENV_DEFAULTS)) {
    process.env[key] = value;
  }

  // Ensure no unintended production database URI is inherited
  delete process.env.MONGODB_URI;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (process.env.PERF_MONGODB_URI) {
    console.log(`[PerfEnv] Connecting to provided test database: ${process.env.PERF_MONGODB_URI}`);
    await mongoose.connect(process.env.PERF_MONGODB_URI);
    testApp = createApp();
    return {
      app: testApp,
      connection: mongoose.connection,
      uri: process.env.PERF_MONGODB_URI,
    };
  }

  console.log('[PerfEnv] Starting ephemeral MongoDB replica set in memory...');
  mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
  const uri = mongoServer.getUri();
  console.log(`[PerfEnv] MongoMemoryServer spun up at ${uri}, initiating replica set...`);

  await mongoose.connect(uri, { directConnection: true });
  await mongoose.connection.db.admin().command({
    replSetInitiate: {
      _id: 'rs0',
      members: [{ _id: 0, host: new URL(uri).host }],
    },
  });
  await mongoose.disconnect();

  const replUri = `${uri}?replicaSet=rs0`;
  await mongoose.connect(replUri, { serverSelectionTimeoutMS: 15000 });
  console.log('[PerfEnv] Connected to replica set successfully.');

  testApp = createApp();

  return {
    app: testApp,
    connection: mongoose.connection,
    uri,
  };
}

/**
 * Gracefully tears down the performance environment.
 */
async function teardownPerfEnvironment() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }

  if (originalEnv) {
    process.env = originalEnv;
  }
}

module.exports = {
  setupPerfEnvironment,
  teardownPerfEnvironment,
  PERF_ENV_DEFAULTS,
};
