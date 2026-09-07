const mongoose = require('mongoose');
const { loadConfig } = require('../../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');

describe('MongoDB foundation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should require MONGODB_URI in non-test environments', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MONGODB_URI;

    expect(() => loadConfig()).toThrow(
      'Configuration validation failed: MONGODB_URI is required in development, production, and other non-test environments.'
    );
  });

  it('should connect to an in-memory MongoDB instance in test mode', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();

    expect(global.__MONGOOSE_CONNECTION__ || global.__MONGODB_MEMORY_SERVER__).toBeDefined();

    await disconnectDatabase();
  }, 30000);

  it('should not expose the MongoDB URI or credentials when the connection fails', async () => {
    const fakeUri = 'mongodb://fake-user:fake-password@invalid-host:27017/testdb';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const connectSpy = jest
      .spyOn(mongoose, 'connect')
      .mockRejectedValue(new Error(`MongoDB connection failed for ${fakeUri}`));

    try {
      process.env.NODE_ENV = 'production';
      process.env.PORT = '5000';
      process.env.MONGODB_URI = fakeUri;

      const error = await connectDatabase().catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'Database connection failed. Please check the MongoDB configuration and try again.'
      );
      expect(error.message).not.toContain(fakeUri);
      expect(error.message).not.toContain('fake-user');
      expect(error.message).not.toContain('fake-password');

      const logOutput = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(logOutput).not.toContain(fakeUri);
      expect(logOutput).not.toContain('fake-user');
      expect(logOutput).not.toContain('fake-password');
    } finally {
      connectSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      process.env = { ...originalEnv };
      await disconnectDatabase();
    }
  });
});
