const request = require('supertest');

const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config/env');

describe('OSMS backend foundation', () => {
  test('GET /api/health returns a healthy service response', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'osms-backend',
    });
  });

  test('invalid PORT configuration fails safely with a meaningful error', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(
      'Configuration validation failed: PORT must be a valid TCP port.'
    );
  });
});
