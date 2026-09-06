const request = require('supertest');
const express = require('express');
const { createApp } = require('../../src/app');
const errorHandler = require('../../src/middleware/errorHandler');
const { validate } = require('../../src/middleware/validate');
const catchAsync = require('../../src/utils/catchAsync');
const {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AppError,
} = require('../../src/errors/AppError');

describe('Centralized Request Validation and Error Handling Integration Tests (#17)', () => {
  let app;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Arrange
    app = createApp();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('AC1, AC2, AC3: Centralized Error Handler and Response Structure', () => {
    it('should return consistent error response given an AppError (400 Bad Request)', async () => {
      // Arrange
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/test-bad-request', (_req, _res, next) => {
        next(new BadRequestError('Custom bad request message'));
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-bad-request');

      // Assert
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: {
          message: 'Custom bad request message',
          code: 'BAD_REQUEST',
        },
      });
    });

    it('should return correct HTTP status codes given common error categories', async () => {
      // Arrange
      const testCases = [
        { err: new BadRequestError('Bad input'), expectedStatus: 400, expectedCode: 'BAD_REQUEST' },
        {
          err: new UnauthorizedError('Unauthorized access'),
          expectedStatus: 401,
          expectedCode: 'UNAUTHORIZED',
        },
        {
          err: new ForbiddenError('Forbidden area'),
          expectedStatus: 403,
          expectedCode: 'FORBIDDEN',
        },
        { err: new NotFoundError('Item missing'), expectedStatus: 404, expectedCode: 'NOT_FOUND' },
        {
          err: new ConflictError('Conflict occurred'),
          expectedStatus: 409,
          expectedCode: 'CONFLICT',
        },
        {
          err: new ValidationError('Invalid fields', [{ field: 'age', message: 'Must be number' }]),
          expectedStatus: 422,
          expectedCode: 'VALIDATION_ERROR',
        },
      ];

      for (const { err, expectedStatus, expectedCode } of testCases) {
        const testApp = express();
        testApp.use(express.json());
        testApp.get('/test-error', (_req, _res, next) => next(err));
        testApp.use(errorHandler);

        // Act
        const res = await request(testApp).get('/test-error');

        // Assert
        expect(res.status).toBe(expectedStatus);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(expectedCode);
      }
    });
  });

  describe('AC4, AC5, AC11: Request Validation Middleware', () => {
    it('should accept request and invoke handler given valid request payload', async () => {
      // Arrange
      const testApp = express();
      testApp.use(express.json());

      const sampleSchema = {
        body: {
          email: { required: true, isEmail: true },
          quantity: { required: true, type: 'number' },
        },
      };

      testApp.post('/test-validate', validate(sampleSchema), (req, res) => {
        res.status(200).json({ success: true, data: req.body });
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp)
        .post('/test-validate')
        .send({ email: 'user@example.com', quantity: 5 });

      // Assert
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('user@example.com');
    });

    it('should reject request with field-level error details given invalid payload', async () => {
      // Arrange
      const testApp = express();
      testApp.use(express.json());

      const sampleSchema = {
        body: {
          email: { required: true, isEmail: true },
          password: { required: true, minLength: 8 },
        },
      };

      testApp.post('/test-validate', validate(sampleSchema), (req, res) => {
        res.status(200).json({ success: true, data: req.body });
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp)
        .post('/test-validate')
        .send({ email: 'invalid-email', password: 'short' });

      // Assert
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { field: 'email', message: 'email must be a valid email address' },
        { field: 'password', message: 'password must be at least 8 characters long' },
      ]);
    });
  });

  describe('AC7: Unknown Route Handling (404)', () => {
    it('should return controlled 404 response given a request for an unhandled route', async () => {
      // Arrange & Act
      const res = await request(app).get('/api/unknown-non-existent-route');

      // Assert
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          message: 'Route not found: /api/unknown-non-existent-route',
          code: 'NOT_FOUND',
        },
      });
    });
  });

  describe('AC8 & AC9: Internal Error Protection vs Development Diagnostics', () => {
    it('should hide stack trace and return generic error message given a 500 exception in non-development environment', async () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const testApp = express();
      testApp.get('/test-crash', () => {
        throw new Error('Database password = secret123 in /var/db/config.js');
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-crash');

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Internal server error');
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.stack).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should include stack trace and error message given a 500 exception in development environment', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const testApp = express();
      testApp.get('/test-crash', () => {
        throw new Error('Debug information for dev');
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-crash');

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('Debug information for dev');
      expect(res.body.error.stack).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe('AC10: Async Controller Error Support', () => {
    it('should catch async exception and pass to error handler given an async controller wrapped with catchAsync', async () => {
      // Arrange
      const testApp = express();
      testApp.use(express.json());

      testApp.get(
        '/test-async-fail',
        catchAsync(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new AppError('Async failure occurred', 400, null, 'ASYNC_ERROR');
        })
      );
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-async-fail');

      // Assert
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: {
          message: 'Async failure occurred',
          code: 'ASYNC_ERROR',
        },
      });
    });
  });

  describe('ODM / Mongoose Error Conversion', () => {
    it('should convert Mongoose CastError to 400 Bad Request given invalid ID format', async () => {
      // Arrange
      const testApp = express();
      testApp.get('/test-cast', (_req, _res, next) => {
        const castErr = new Error('Cast to ObjectId failed');
        castErr.name = 'CastError';
        castErr.path = '_id';
        castErr.value = 'invalid-id';
        next(castErr);
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-cast');

      // Assert
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
      expect(res.body.error.message).toContain('Invalid _id: invalid-id');
    });

    it('should convert Mongoose duplicate key error (11000) to 409 Conflict given duplicate entity error', async () => {
      // Arrange
      const testApp = express();
      testApp.get('/test-duplicate', (_req, _res, next) => {
        const dupErr = new Error('E11000 duplicate key error');
        dupErr.code = 11000;
        dupErr.errmsg =
          'E11000 duplicate key error collection: test.users index: email_1 dup key: { email: "test@example.com" }';
        next(dupErr);
      });
      testApp.use(errorHandler);

      // Act
      const res = await request(testApp).get('/test-duplicate');

      // Assert
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_FIELD');
    });
  });
});
