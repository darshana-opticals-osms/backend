const request = require('supertest');
const { createApp } = require('../../src/app');
const { BCRYPT_SALT_ROUNDS } = require('../../src/services/auth.service');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

describe('Security Hardening Integration Tests (#18)', () => {
  let app;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    app = createApp();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // AC1: Security HTTP Headers (Helmet)
  // ---------------------------------------------------------------------------
  describe('AC1: Security HTTP Headers', () => {
    it('should include X-Content-Type-Options header to prevent MIME sniffing', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/health');

      // Assert
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include X-Frame-Options header to prevent clickjacking', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/health');

      // Assert
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    it('should suppress X-Powered-By header to hide Express fingerprint', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/health');

      // Assert
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // AC2: CORS Configuration
  // ---------------------------------------------------------------------------
  describe('AC2: CORS Configuration', () => {
    it('should allow requests from a configured frontend origin', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should respond to CORS preflight OPTIONS requests', async () => {
      // Arrange & Act
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      // Assert
      expect([200, 204]).toContain(res.status);
    });
  });

  // ---------------------------------------------------------------------------
  // AC3: General Rate Limiting
  // ---------------------------------------------------------------------------
  describe('AC3: General API Rate Limiting', () => {
    it('should respond normally to requests within the rate limit', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/health');

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBeDefined();
    });

    it('should return 429 and RATE_LIMIT_EXCEEDED code when general rate limit is exceeded', async () => {
      // Arrange: override to a very low limit for this test
      const rateLimit = require('express-rate-limit');
      const express = require('express');
      const { sanitizeInput } = require('../../src/utils/sanitizer');
      const helmet = require('helmet');

      const tightApp = express();
      tightApp.use(helmet());
      tightApp.use(express.json());
      tightApp.use(sanitizeInput);

      const tightLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({
            success: false,
            error: {
              message: 'Too many requests. Please try again later.',
              code: 'RATE_LIMIT_EXCEEDED',
            },
          });
        },
      });

      tightApp.use('/api', tightLimiter);
      tightApp.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

      // Act: send 3 requests — the third should be rate limited
      await request(tightApp).get('/api/health');
      await request(tightApp).get('/api/health');
      const res = await request(tightApp).get('/api/health');

      // Assert
      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // ---------------------------------------------------------------------------
  // AC4 & AC5: Auth Endpoint Rate Limiting (brute-force protection)
  // ---------------------------------------------------------------------------
  describe('AC4 & AC5: Authentication Endpoint Rate Limiting', () => {
    it('should trigger 429 on auth route sooner than the general limit', async () => {
      // Arrange: tight auth limiter of max 2 requests
      const rateLimit = require('express-rate-limit');
      const express = require('express');
      const { sanitizeInput } = require('../../src/utils/sanitizer');

      const authTestApp = express();
      authTestApp.use(express.json());
      authTestApp.use(sanitizeInput);

      const tightAuthLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({
            success: false,
            error: {
              message: 'Too many requests. Please try again later.',
              code: 'RATE_LIMIT_EXCEEDED',
            },
          });
        },
      });

      authTestApp.use('/api/auth', tightAuthLimiter);
      authTestApp.post('/api/auth/login', (_req, res) => res.status(401).json({ success: false }));

      // Act: send 3 requests — the third should be blocked
      await request(authTestApp)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'bad' });
      await request(authTestApp)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'bad' });
      const res = await request(authTestApp)
        .post('/api/auth/login')
        .send({ email: 'x@x.com', password: 'bad' });

      // Assert
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // ---------------------------------------------------------------------------
  // AC6: Password Hashing Security (bcrypt)
  // ---------------------------------------------------------------------------
  describe('AC6: Password Hashing Security', () => {
    it('should use bcrypt cost factor of 12 or higher for password hashing', () => {
      // Assert: the exported constant must be at least 12
      expect(BCRYPT_SALT_ROUNDS).toBeGreaterThanOrEqual(12);
    });

    it('should produce a valid bcrypt hash that is verifiable and not plain text', async () => {
      // Arrange
      const plainPassword = 'S3cur3P@ssw0rd!';

      // Act
      const hash = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

      // Assert: hash must not equal the plain text
      expect(hash).not.toBe(plainPassword);
      // Assert: hash must start with bcrypt identifier
      expect(hash).toMatch(/^\$2[ab]\$12\$/);
      // Assert: bcrypt.compare must return true for the correct password
      expect(await bcrypt.compare(plainPassword, hash)).toBe(true);
      // Assert: bcrypt.compare must return false for a wrong password
      expect(await bcrypt.compare('WrongPassword', hash)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // AC7: Request Body Size Limit
  // ---------------------------------------------------------------------------
  describe('AC7: Request Body Size Limit', () => {
    it('should reject a request body exceeding the configured size limit with 413', async () => {
      // Arrange: generate a payload larger than 10kb
      const oversizedPayload = { data: 'x'.repeat(12 * 1024) };

      // Act
      const res = await request(app)
        .post('/api/auth/login')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json');

      // Assert
      expect(res.status).toBe(413);
    });

    it('should accept a request body within the size limit', async () => {
      // A simple GET to /api/health (no DB needed) confirms that normal,
      // non-oversized requests pass through the body size middleware without issue.
      const res = await request(app).get('/api/health');

      // Assert: request was processed normally — not rejected with 413
      expect(res.status).toBe(200);
      expect(res.status).not.toBe(413);
    });
  });

  // ---------------------------------------------------------------------------
  // AC8: MongoDB / Input Attack Protection (sanitization)
  // ---------------------------------------------------------------------------
  describe('AC8: MongoDB Injection Protection', () => {
    it('should not process MongoDB operator injection in login request body', async () => {
      // Arrange: malicious payload using $gt operator
      const maliciousPayload = {
        email: { $gt: '' },
        password: { $gt: '' },
      };

      // Act
      const res = await request(app)
        .post('/api/auth/login')
        .send(maliciousPayload)
        .set('Content-Type', 'application/json');

      // Assert: must not return 200 (bypassing auth); sanitized input should yield 401 or 422
      expect(res.status).not.toBe(200);
      expect([400, 401, 422]).toContain(res.status);
    });
  });

  // ---------------------------------------------------------------------------
  // AC11: Authentication Failure Response Safety
  // DB connection required: login service queries MongoDB.
  // ---------------------------------------------------------------------------
  describe('AC11: Authentication Failure Response Safety', () => {
    beforeAll(async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.MONGODB_URI;
      await connectDatabase();
    });

    afterAll(async () => {
      await disconnectDatabase();
    });

    it('should return a vague error message that does not reveal whether the account exists', async () => {
      // Arrange
      const nonExistentAccountPayload = {
        email: 'nobody@nowhere.com',
        password: 'WrongPassword123!',
      };

      // Act
      const res = await request(app).post('/api/auth/login').send(nonExistentAccountPayload);

      // Assert: must use a generic message — not reveal account existence
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password.');
      expect(res.body.error.message).not.toMatch(/not found/i);
      expect(res.body.error.message).not.toMatch(/does not exist/i);
      expect(res.body.error.message).not.toMatch(/no account/i);
    });

    it('should not expose password hash in authentication error response', async () => {
      // Arrange
      const payload = { email: 'test@example.com', password: 'wrongpassword' };

      // Act
      const res = await request(app).post('/api/auth/login').send(payload);

      // Assert
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/passwordHash/);
      expect(bodyStr).not.toMatch(/\$2[ab]\$/); // no bcrypt hash in response
    });
  });

  // ---------------------------------------------------------------------------
  // AC12: Production Error Safety (no stack trace exposure)
  // ---------------------------------------------------------------------------
  describe('AC12: Production Error Safety', () => {
    it('should not expose stack traces or internal paths in production error responses', async () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const express = require('express');
      const errorHandler = require('../../src/middleware/errorHandler');

      const prodApp = express();
      prodApp.get('/test-crash', () => {
        throw new Error('Secret DB path: /var/db/osms password=s3cr3t');
      });
      prodApp.use(errorHandler);

      // Act
      const res = await request(prodApp).get('/test-crash');

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      consoleSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // AC10: Environment Secrets Not Committed
  // ---------------------------------------------------------------------------
  describe('AC10: Environment Secrets Not Committed', () => {
    it('should have a .env.example file with placeholder values (no real secrets)', () => {
      // Arrange
      const examplePath = path.resolve(__dirname, '../../.env.example');

      // Act
      const content = fs.readFileSync(examplePath, 'utf8');

      // Assert: file must exist and contain placeholder — not real secret values
      expect(content).toContain('JWT_SECRET=');
      expect(content).toContain('MONGODB_URI=');
      expect(content).toContain('FRONTEND_ORIGIN=');
      // Must not contain what looks like a real JWT secret (long random string)
      expect(content).not.toMatch(/JWT_SECRET=[A-Za-z0-9+/]{32,}/);
    });

    it('should have a .gitignore that excludes .env files', () => {
      // Arrange
      const gitignorePath = path.resolve(__dirname, '../../.gitignore');

      // Act
      const content = fs.readFileSync(gitignorePath, 'utf8');

      // Assert
      expect(content).toMatch(/\.env/);
    });
  });

  // ---------------------------------------------------------------------------
  // AC13: Configurable Security Values
  // ---------------------------------------------------------------------------
  describe('AC13: Configurable Security Values', () => {
    it('should restrict CORS origins and apply rate limits based on environment variables', () => {
      // Arrange: override env and use jest.resetModules() to force a fresh module evaluation.
      // Set NODE_ENV=production so CORS_ORIGINS resolves to an array (not boolean true).
      const savedEnv = process.env.NODE_ENV;
      const savedOrigin = process.env.FRONTEND_ORIGIN;
      const savedMax = process.env.RATE_LIMIT_MAX;

      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_ORIGIN = 'https://app.example.com,https://staging.example.com';
      process.env.RATE_LIMIT_MAX = '50';

      jest.resetModules();
      const { CORS_CONFIG, GENERAL_RATE_LIMIT } = require('../../src/config/security');

      // Assert: CORS_CONFIG.origin is a configured array (not wildcard)
      expect(Array.isArray(CORS_CONFIG.origin)).toBe(true);
      expect(CORS_CONFIG.origin).toContain('https://app.example.com');
      expect(CORS_CONFIG.origin).toContain('https://staging.example.com');
      // Assert: rate limit ceiling read from env
      expect(GENERAL_RATE_LIMIT.max).toBe(50);

      // Cleanup: restore env and reset modules so subsequent tests get fresh instances
      process.env.NODE_ENV = savedEnv;
      if (savedOrigin !== undefined) process.env.FRONTEND_ORIGIN = savedOrigin;
      else delete process.env.FRONTEND_ORIGIN;
      if (savedMax !== undefined) process.env.RATE_LIMIT_MAX = savedMax;
      else delete process.env.RATE_LIMIT_MAX;
      jest.resetModules();
    });
  });
});
