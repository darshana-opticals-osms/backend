/**
 * Isolated Safe Test Environment Bootstrapper (AC3)
 *
 * Guarantees zero connection to production/staging and provisions an
 * ephemeral MongoDB Memory Server with Replica Set support for transactions.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// -----------------------------------------------------------------------------
// PRE-FLIGHT CRITICAL ENVIRONMENT SAFETY VALIDATION
// Must run BEFORE any process.env mutations to guarantee existing environment
// variables (NODE_ENV, MONGODB_URI) are not masked.
// -----------------------------------------------------------------------------
function assertSafeInitialEnvironment() {
  const currentEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (currentEnv === 'production' || currentEnv === 'staging') {
    throw new Error(
      `CRITICAL SAFETY VIOLATION: Performance testing suite must never execute in ${currentEnv} environment (NODE_ENV="${process.env.NODE_ENV}"). Aborting immediately to prevent data loss or service disruption.`
    );
  }

  const inheritedUri = (process.env.MONGODB_URI || '').trim().toLowerCase();
  if (
    inheritedUri.includes('mongodb+srv') ||
    inheritedUri.includes('cluster0') ||
    inheritedUri.includes('production') ||
    inheritedUri.includes('staging') ||
    inheritedUri.includes('darshana-opticals-db')
  ) {
    throw new Error(
      'CRITICAL SAFETY VIOLATION: Detected production or staging database URI in MONGODB_URI environment variable. Performance suite refuses to execute against shared or live databases.'
    );
  }
}

// Execute initial environment check immediately upon module load
assertSafeInitialEnvironment();

let mongoServer = null;
let testApp = null;
let originalEnv = null;

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
 * Validates externally supplied performance database URIs.
 * Guarantees that only strictly isolated, local test databases are permitted.
 * @param {string} uriString
 */
function validateExternalPerfUri(uriString) {
  if (!uriString) return;

  if (process.env.ALLOW_EXTERNAL_PERF_DB !== 'true') {
    throw new Error(
      `CRITICAL SAFETY VIOLATION: External PERF_MONGODB_URI was provided ("${uriString}"), but ALLOW_EXTERNAL_PERF_DB is not set to 'true'. External databases are rejected by default to prevent accidental data destruction. Use ephemeral MongoMemoryServer or set ALLOW_EXTERNAL_PERF_DB=true with a dedicated isolated test DB.`
    );
  }

  let parsed;
  try {
    parsed = new URL(uriString);
  } catch {
    throw new Error(`CRITICAL SAFETY VIOLATION: Invalid PERF_MONGODB_URI format: ${uriString}`);
  }

  const isLoopback =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (!isLoopback) {
    throw new Error(
      `CRITICAL SAFETY VIOLATION: External performance database must strictly point to a local loopback interface (localhost / 127.0.0.1). Remote host "${parsed.hostname}" is forbidden.`
    );
  }

  const dbPath = (parsed.pathname || '').replace(/^\//, '').toLowerCase();
  const hasSafeDbName = dbPath.includes('test') || dbPath.includes('perf');
  if (!hasSafeDbName) {
    throw new Error(
      `CRITICAL SAFETY VIOLATION: External performance database name ("${dbPath}") must explicitly contain "test" or "perf" to guarantee isolation.`
    );
  }

  const lowerUri = uriString.toLowerCase();
  if (
    lowerUri.includes('mongodb+srv') ||
    lowerUri.includes('cluster0') ||
    lowerUri.includes('production') ||
    lowerUri.includes('staging') ||
    lowerUri.includes('darshana-opticals-db')
  ) {
    throw new Error(
      'CRITICAL SAFETY VIOLATION: External performance database URI matches forbidden production/staging keywords.'
    );
  }
}

/**
 * Initializes an isolated performance test environment.
 * @returns {Promise<{ app: Express.Application, connection: mongoose.Connection, uri: string }>}
 */
async function setupPerfEnvironment() {
  assertSafeInitialEnvironment();

  originalEnv = { ...process.env };

  // Apply safe performance test environment variables
  for (const [key, value] of Object.entries(PERF_ENV_DEFAULTS)) {
    process.env[key] = value;
  }

  // Clear module cache for security/rateLimiter so performance rate limits take effect
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
    validateExternalPerfUri(process.env.PERF_MONGODB_URI);
    console.log(
      `[PerfEnv] Connecting to verified external test database: ${process.env.PERF_MONGODB_URI}`
    );
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
  assertSafeInitialEnvironment,
  validateExternalPerfUri,
};
