const request = require('supertest');
const { createApp } = require('../../src/app');
const { loadConfig } = require('../../src/config/env');

describe('GET /api/health', () => {
  let app;

  beforeEach(() => {
    // Arrange
    app = createApp();
  });

  it('should return 200 with healthy service status given a health check request', async () => {
    // Act
    const response = await request(app).get('/api/health');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'osms-backend',
    });
  });

  it('should throw an error given invalid PORT environment configuration', () => {
    // Act & Assert
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(
      'Configuration validation failed: PORT must be a valid TCP port.'
    );
  });
});
