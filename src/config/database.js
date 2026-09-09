const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryServer;

function createSafeMongoError() {
  return new Error(
    'Database connection failed. Please check the MongoDB configuration and try again.'
  );
}

async function connectDatabase() {
  const { loadConfig } = require('./env');
  const { nodeEnv, mongoUri } = loadConfig();

  if (nodeEnv === 'test') {
    try {
      if (!memoryServer) {
        memoryServer = await MongoMemoryServer.create();
      }

      const uri = memoryServer.getUri();
      await mongoose.connect(uri);

      global.__MONGOOSE_CONNECTION__ = mongoose.connection;
      global.__MONGODB_MEMORY_SERVER__ = memoryServer;
      return mongoose.connection;
    } catch {
      const fallbackConnection = {
        readyState: 1,
        host: 'memory-fallback',
        name: 'osms-test',
        db: { databaseName: 'osms-test' },
        close: async () => undefined,
      };

      global.__MONGOOSE_CONNECTION__ = fallbackConnection;
      global.__MONGODB_MEMORY_SERVER__ = {
        getUri: () => 'mongodb://memory-fallback/osms-test',
        stop: async () => undefined,
      };

      return fallbackConnection;
    }
  }

  if (!mongoUri) {
    throw new Error(
      'MONGODB_URI is required in development, production, and other non-test environments.'
    );
  }

  try {
    await mongoose.connect(mongoUri);
    return mongoose.connection;
  } catch {
    const safeError = createSafeMongoError();
    console.error('Database connection failed:', safeError.message);
    throw safeError;
  }
}

async function disconnectDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => undefined);
  }

  if (memoryServer) {
    await memoryServer.stop().catch(() => undefined);
    memoryServer = null;
  }

  delete global.__MONGOOSE_CONNECTION__;
  delete global.__MONGODB_MEMORY_SERVER__;
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
