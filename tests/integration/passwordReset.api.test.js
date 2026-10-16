process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt = require('bcrypt');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const notificationService = require('../../src/services/notification.service');
const { ROLE_VALUES } = require('../../src/constants/roles');

describe('Password Recovery API Integration (Issue #83)', () => {
  let app;
  let originalEnv;
  let sendEmailSpy;

  const INITIAL_PASSWORD = 'InitialPassword123!';
  const NEW_PASSWORD = 'NewSecurePassword456!';

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT_MAX = '500';
    process.env.JWT_SECRET = 'test-secret-jwt-key-for-password-reset-83';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    delete process.env.MONGODB_URI;

    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    sendEmailSpy = jest.spyOn(notificationService, 'sendPasswordResetNotification');
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  const seedCustomer = async (overrides = {}) => {
    const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 10);
    return Customer.create({
      name: 'Alice Customer',
      email: 'alice.customer@example.com',
      phone: '+94711111111',
      address: '10 Galle Road, Colombo',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash,
      ...overrides,
    });
  };

  const seedStaff = async (role = ROLE_VALUES.OPTOMETRIST, overrides = {}) => {
    const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 10);
    return Staff.create({
      name: 'Bob Staff',
      email: 'bob.staff@example.com',
      phone: '+94712222222',
      address: '20 Kandy Road, Colombo',
      role,
      passwordHash,
      ...overrides,
    });
  };

  const seedAdmin = async (overrides = {}) => {
    const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 10);
    return Admin.create({
      name: 'System Admin',
      email: 'admin.super@example.com',
      phone: '+94713333333',
      role: ROLE_VALUES.SYSTEM_ADMIN,
      passwordHash,
      ...overrides,
    });
  };

  // Helper to extract raw token from notification spy call
  const extractDispatchedToken = () => {
    if (sendEmailSpy.mock.calls.length === 0) return null;
    const lastCall = sendEmailSpy.mock.calls[sendEmailSpy.mock.calls.length - 1][0];
    const match = lastCall.resetUrl.match(/[?&]token=([^&]+)/);
    return match ? match[1] : null;
  };

  // ===========================================================================
  // 1. FORGOT PASSWORD ENDPOINT (AC1 - AC11, AC20 - AC26)
  // ===========================================================================
  describe('POST /api/auth/forgot-password', () => {
    it('returns generic anti-enumeration response for registered Customer and persists token hash (AC1, AC3, AC4, AC8, AC9, AC10)', async () => {
      await seedCustomer();

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message:
          'If an eligible account exists for this email, a password reset link has been sent.',
      });

      // Verify email was dispatched with raw token
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      const rawToken = extractDispatchedToken();
      expect(rawToken).toBeTruthy();
      expect(rawToken).toHaveLength(64);

      // Verify DB stores only hash and expiry, never raw token (AC9, AC13)
      const customerDoc = await Customer.findOne({ email: 'alice.customer@example.com' }).select(
        '+passwordResetTokenHash +passwordResetExpiresAt'
      );
      expect(customerDoc.passwordResetTokenHash).toBeDefined();
      expect(customerDoc.passwordResetTokenHash).not.toBe(rawToken);
      expect(customerDoc.passwordResetExpiresAt).toBeInstanceOf(Date);
      expect(customerDoc.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns identical generic success for registered Staff (AC1, AC4, AC6)', async () => {
      await seedStaff(ROLE_VALUES.BRANCH_MANAGER);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'bob.staff@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('If an eligible account exists');
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      const staffDoc = await Staff.findOne({ email: 'bob.staff@example.com' }).select(
        '+passwordResetTokenHash +passwordResetExpiresAt'
      );
      expect(staffDoc.passwordResetTokenHash).toBeDefined();
    });

    it('returns identical generic success for SYSTEM_ADMIN without issuing token or email (AC2, AC6)', async () => {
      await seedAdmin();

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'admin.super@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message:
          'If an eligible account exists for this email, a password reset link has been sent.',
      });

      // Email must not be sent for admin (AC2)
      expect(sendEmailSpy).not.toHaveBeenCalled();

      // No token fields persisted on admin
      const adminDoc = await Admin.findOne({ email: 'admin.super@example.com' });
      expect(adminDoc.passwordResetTokenHash).toBeUndefined();
    });

    it('returns identical generic success for non-existent email without sending email (AC4 Anti-Enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent.user@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message:
          'If an eligible account exists for this email, a password reset link has been sent.',
      });
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('normalizes email (trim and lowercase) before lookup (AC5)', async () => {
      await seedCustomer({ email: 'case.sensitive@example.com' });

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: '  CASE.SENSITIVE@EXAMPLE.COM  ' });

      expect(res.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy.mock.calls[0][0].to).toBe('case.sensitive@example.com');
    });

    it('rejects malformed email with 422 ValidationError', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'invalid-email-address' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported fields in request body with 422 ValidationError', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'user@example.com', unsupportedField: 'attack' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('fails closed when ambiguous duplicate identities exist across collections (AC7)', async () => {
      const duplicateEmail = 'duplicate.identity@example.com';
      await seedCustomer({ email: duplicateEmail });
      await seedStaff(ROLE_VALUES.BRANCH_ASSISTANT, { email: duplicateEmail });

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: duplicateEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Fails closed: does not send reset link (AC7)
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('replaces a previous unused reset token when a new request is made (AC11)', async () => {
      await seedCustomer();

      // First request
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const firstRawToken = extractDispatchedToken();

      const docAfterFirst = await Customer.findOne({ email: 'alice.customer@example.com' }).select(
        '+passwordResetTokenHash'
      );
      const firstHash = docAfterFirst.passwordResetTokenHash;

      // Second request
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const secondRawToken = extractDispatchedToken();

      const docAfterSecond = await Customer.findOne({ email: 'alice.customer@example.com' }).select(
        '+passwordResetTokenHash'
      );
      const secondHash = docAfterSecond.passwordResetTokenHash;

      expect(secondRawToken).not.toBe(firstRawToken);
      expect(secondHash).not.toBe(firstHash);

      // First token should now fail to reset
      const resetAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: firstRawToken, newPassword: NEW_PASSWORD });
      expect(resetAttempt.status).toBe(400);
      expect(resetAttempt.body.error.code).toBe('RESET_TOKEN_INVALID_OR_EXPIRED');

      // Second token succeeds
      const secondResetAttempt = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: secondRawToken, newPassword: NEW_PASSWORD });
      expect(secondResetAttempt.status).toBe(200);
    });

    it('returns generic response even if email notification dispatch fails (AC23)', async () => {
      await seedCustomer();
      sendEmailSpy.mockRejectedValue(new Error('SMTP Connection Refused'));

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('If an eligible account exists');
    });
  });

  // ===========================================================================
  // 2. RESET PASSWORD ENDPOINT (AC12, AC14 - AC19, AC27)
  // ===========================================================================
  describe('POST /api/auth/reset-password', () => {
    it('successfully resets Customer password, clears token state, and allows login with new password (AC12, AC14, AC17, AC19, AC27)', async () => {
      await seedCustomer();

      // Request forgot password
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const rawToken = extractDispatchedToken();

      // Submit reset password
      const resetRes = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        newPassword: NEW_PASSWORD,
      });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body).toEqual({
        success: true,
        message: 'Password has been successfully reset. You can now log in with your new password.',
      });

      // Verify token hash and expiry are completely cleared from DB (AC12)
      const customerDoc = await Customer.findOne({ email: 'alice.customer@example.com' }).select(
        '+passwordResetTokenHash +passwordResetExpiresAt'
      );
      expect(customerDoc.passwordResetTokenHash).toBeFalsy();
      expect(customerDoc.passwordResetExpiresAt).toBeFalsy();

      // Login with old password fails (AC27)
      const oldLoginRes = await request(app).post('/api/auth/login').send({
        email: 'alice.customer@example.com',
        password: INITIAL_PASSWORD,
      });
      expect(oldLoginRes.status).toBe(401);

      // Login with new password succeeds (AC27)
      const newLoginRes = await request(app).post('/api/auth/login').send({
        email: 'alice.customer@example.com',
        password: NEW_PASSWORD,
      });
      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.body.data.token).toBeDefined();
      expect(newLoginRes.body.data.user.email).toBe('alice.customer@example.com');
    });

    it('successfully resets Staff password and allows login with new password (AC1, AC14, AC27)', async () => {
      await seedStaff(ROLE_VALUES.OPTOMETRIST);

      await request(app).post('/api/auth/forgot-password').send({ email: 'bob.staff@example.com' });
      const rawToken = extractDispatchedToken();

      const resetRes = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        newPassword: NEW_PASSWORD,
      });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Login with new password succeeds for staff
      const loginRes = await request(app).post('/api/auth/login').send({
        email: 'bob.staff@example.com',
        password: NEW_PASSWORD,
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.user.role).toBe(ROLE_VALUES.OPTOMETRIST);
    });

    it('rejects already-used reset token (single-use token AC12, AC18)', async () => {
      await seedCustomer();

      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const rawToken = extractDispatchedToken();

      // First use succeeds
      const firstUse = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        newPassword: NEW_PASSWORD,
      });
      expect(firstUse.status).toBe(200);

      // Second use with same token fails
      const secondUse = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        newPassword: 'AnotherNewPassword999!',
      });
      expect(secondUse.status).toBe(400);
      expect(secondUse.body.error.code).toBe('RESET_TOKEN_INVALID_OR_EXPIRED');
    });

    it('rejects expired reset token (AC10, AC18)', async () => {
      await seedCustomer();

      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const rawToken = extractDispatchedToken();

      // Expire token in database
      await Customer.updateOne(
        { email: 'alice.customer@example.com' },
        { passwordResetExpiresAt: new Date(Date.now() - 1000) }
      );

      const res = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RESET_TOKEN_INVALID_OR_EXPIRED');
    });

    it('rejects unknown or invalid reset token with safe error code (AC18)', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        token: 'unknown-token-that-does-not-exist',
        newPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RESET_TOKEN_INVALID_OR_EXPIRED');
    });

    it('rejects password violating complexity policy with 422 (AC15)', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        token: 'anytoken',
        newPassword: 'weak',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects confirmPassword as unsupported payload field (AC16)', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        token: 'anytoken',
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('guarantees concurrency protection: only one concurrent reset succeeds (AC12, AC19)', async () => {
      await seedCustomer();

      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'alice.customer@example.com' });
      const rawToken = extractDispatchedToken();

      // Dispatch 2 concurrent requests using the same token
      const [res1, res2] = await Promise.all([
        request(app).post('/api/auth/reset-password').send({
          token: rawToken,
          newPassword: 'ConcurrentPass1!',
        }),
        request(app).post('/api/auth/reset-password').send({
          token: rawToken,
          newPassword: 'ConcurrentPass2!',
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]);

      const failedRes = res1.status === 400 ? res1 : res2;
      expect(failedRes.body.error.code).toBe('RESET_TOKEN_INVALID_OR_EXPIRED');
    });
  });
});
