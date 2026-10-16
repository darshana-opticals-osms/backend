const crypto = require('crypto');
const {
  TOKEN_EXPIRY_MINUTES,
  RESET_TOKEN_BYTE_LENGTH,
  ELIGIBLE_ROLES,
  GENERIC_FORGOT_PASSWORD_RESPONSE,
  generateResetToken,
  hashResetToken,
  isValidPassword,
  requestPasswordReset,
  resetPassword,
} = require('../../src/services/passwordReset.service');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const authService = require('../../src/services/auth.service');
const notificationService = require('../../src/services/notification.service');
const { ROLE_VALUES } = require('../../src/constants/roles');

jest.mock('../../src/models/customer.model');
jest.mock('../../src/models/staff.model');
jest.mock('../../src/models/admin.model');
jest.mock('../../src/services/auth.service');
jest.mock('../../src/services/notification.service');

describe('PasswordResetService (Issue #83)', () => {
  const originalEnv = process.env;

  const flushBackgroundDispatches = () => new Promise((resolve) => setTimeout(resolve, 50));

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await flushBackgroundDispatches();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Token Generation and Hashing (AC8, AC9, AC10)', () => {
    it('generates a 64-character hex token with sufficient entropy', () => {
      const token1 = generateResetToken();
      const token2 = generateResetToken();

      expect(typeof token1).toBe('string');
      expect(token1).toHaveLength(RESET_TOKEN_BYTE_LENGTH * 2);
      expect(token1).toMatch(/^[0-9a-f]{64}$/);
      expect(token1).not.toBe(token2);
    });

    it('hashes token with SHA-256 differing from the raw token', () => {
      const rawToken = 'a'.repeat(64);
      const hash = hashResetToken(rawToken);

      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64);
      expect(hash).not.toBe(rawToken);

      const expected = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(hash).toBe(expected);
    });

    it('uses 15 minutes as token expiry', () => {
      expect(TOKEN_EXPIRY_MINUTES).toBe(15);
    });

    it('defines eligible roles according to Issue #83 AC1', () => {
      expect(ELIGIBLE_ROLES).toEqual([
        ROLE_VALUES.CUSTOMER,
        ROLE_VALUES.BRANCH_MANAGER,
        ROLE_VALUES.BRANCH_ASSISTANT,
        ROLE_VALUES.OPTOMETRIST,
      ]);
    });
  });

  describe('Password Policy Validation (AC15)', () => {
    it('accepts compliant passwords with upper, lower, number and min 8 length', () => {
      expect(isValidPassword('ValidPass1')).toBe(true);
      expect(isValidPassword('SuperSecure99!')).toBe(true);
      expect(isValidPassword('Colombo2026')).toBe(true);
    });

    it('rejects passwords failing any policy requirement', () => {
      expect(isValidPassword('short1A')).toBe(false); // < 8
      expect(isValidPassword('alllowercase1')).toBe(false); // no upper
      expect(isValidPassword('ALLUPPERCASE1')).toBe(false); // no lower
      expect(isValidPassword('NoDigitsHere')).toBe(false); // no digit
      expect(isValidPassword('')).toBe(false);
      expect(isValidPassword(null)).toBe(false);
    });
  });

  describe('requestPasswordReset (AC1 - AC11, AC20 - AC24)', () => {
    it('returns generic response for unknown email without sending email or setting token', async () => {
      Customer.find.mockResolvedValue([]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);

      const result = await requestPasswordReset('unknown@example.com');

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(notificationService.sendPasswordResetNotification).not.toHaveBeenCalled();
    });

    it('returns generic response for Admin email without issuing reset token or email (AC2)', async () => {
      Customer.find.mockResolvedValue([]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(true);

      const result = await requestPasswordReset('admin@example.com');

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(notificationService.sendPasswordResetNotification).not.toHaveBeenCalled();
    });

    it('fails closed on ambiguous duplicate identities across Customer and Staff (AC7)', async () => {
      Customer.find.mockResolvedValue([{ role: ROLE_VALUES.CUSTOMER }]);
      Staff.find.mockResolvedValue([{ role: ROLE_VALUES.BRANCH_MANAGER }]);
      Admin.exists.mockResolvedValue(false);

      const result = await requestPasswordReset('duplicate@example.com');

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(notificationService.sendPasswordResetNotification).not.toHaveBeenCalled();
    });

    it('creates and saves hashed token on eligible Customer and dispatches notification', async () => {
      const mockCustomer = {
        email: 'customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        save: jest.fn().mockResolvedValue(true),
      };
      Customer.find.mockResolvedValue([mockCustomer]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);
      notificationService.sendPasswordResetNotification.mockResolvedValue({ delivered: true });

      const result = await requestPasswordReset('  CUSTOMER@EXAMPLE.COM  ', {
        awaitDispatch: true,
      });

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(mockCustomer.save).toHaveBeenCalledTimes(1);
      expect(mockCustomer.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(mockCustomer.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(notificationService.sendPasswordResetNotification).toHaveBeenCalledTimes(1);
      const callArgs = notificationService.sendPasswordResetNotification.mock.calls[0][0];
      expect(callArgs.to).toBe('customer@example.com');
      expect(callArgs.resetUrl).toContain('/reset-password?token=');
      expect(callArgs.minutesValid).toBe(15);
    });

    it('creates and saves hashed token on eligible Staff and dispatches notification', async () => {
      const mockStaff = {
        email: 'optom@example.com',
        role: ROLE_VALUES.OPTOMETRIST,
        save: jest.fn().mockResolvedValue(true),
      };
      Customer.find.mockResolvedValue([]);
      Staff.find.mockResolvedValue([mockStaff]);
      Admin.exists.mockResolvedValue(false);
      notificationService.sendPasswordResetNotification.mockResolvedValue({ delivered: true });

      const result = await requestPasswordReset('optom@example.com', { awaitDispatch: true });

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(mockStaff.save).toHaveBeenCalledTimes(1);
      expect(notificationService.sendPasswordResetNotification).toHaveBeenCalledTimes(1);
    });

    it('returns generic response even if notification dispatch fails (AC23)', async () => {
      const mockCustomer = {
        email: 'customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        save: jest.fn().mockResolvedValue(true),
      };
      Customer.find.mockResolvedValue([mockCustomer]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);
      notificationService.sendPasswordResetNotification.mockRejectedValue(
        new Error('SMTP connection timed out')
      );

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await requestPasswordReset('customer@example.com', { awaitDispatch: true });

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(warnSpy).toHaveBeenCalledWith(
        '[PasswordResetService] Password reset notification delivery encountered an operational failure.'
      );
      warnSpy.mockRestore();
    });

    it('handles token persistence failure safely without dispatching email (Review Finding 3)', async () => {
      const mockCustomer = {
        email: 'customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        save: jest.fn().mockRejectedValue(new Error('Mongo write error: connection lost')),
      };
      Customer.find.mockResolvedValue([mockCustomer]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await requestPasswordReset('customer@example.com', { awaitDispatch: true });

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(mockCustomer.save).toHaveBeenCalledTimes(1);
      // Review finding 3: Must NOT dispatch email if token persistence fails
      expect(notificationService.sendPasswordResetNotification).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist reset token state')
      );

      errorSpy.mockRestore();
    });

    it('returns generic response immediately even during slow notification dispatch (Review Finding 1)', async () => {
      const mockCustomer = {
        email: 'customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        save: jest.fn().mockResolvedValue(true),
      };
      Customer.find.mockResolvedValue([mockCustomer]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);

      // Simulate slow SMTP delivery that resolves asynchronously on next tick
      notificationService.sendPasswordResetNotification.mockImplementation(
        () => new Promise((resolve) => setImmediate(() => resolve({ delivered: true })))
      );

      const startTime = Date.now();
      const result = await requestPasswordReset('customer@example.com'); // default: non-blocking dispatch
      const duration = Date.now() - startTime;

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      // HTTP response returns immediately without waiting for slow SMTP
      expect(duration).toBeLessThan(100);
    });

    it('does not log untrusted error message if notification delivery throws sensitive error (Review Finding 2)', async () => {
      const mockCustomer = {
        email: 'customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        save: jest.fn().mockResolvedValue(true),
      };
      Customer.find.mockResolvedValue([mockCustomer]);
      Staff.find.mockResolvedValue([]);
      Admin.exists.mockResolvedValue(false);

      const sensitiveToken = 'leaked_raw_secret_token_abc';
      const sensitiveUrl = `http://localhost:3000/reset?token=${sensitiveToken}`;
      notificationService.sendPasswordResetNotification.mockRejectedValue(
        new Error(`SMTP network failure for ${sensitiveUrl}`)
      );

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await requestPasswordReset('customer@example.com', { awaitDispatch: true });

      expect(result).toEqual(GENERIC_FORGOT_PASSWORD_RESPONSE);
      expect(warnSpy).toHaveBeenCalled();
      const loggedText = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(loggedText).not.toContain(sensitiveToken);
      expect(loggedText).not.toContain(sensitiveUrl);
      expect(loggedText).toContain(
        'Password reset notification delivery encountered an operational failure'
      );

      warnSpy.mockRestore();
    });
  });

  describe('resetPassword (AC12, AC14 - AC19, AC27)', () => {
    it('throws BadRequestError if token is missing or empty', async () => {
      await expect(resetPassword({ token: '', newPassword: 'ValidPassword1' })).rejects.toThrow(
        'Invalid or expired password reset token.'
      );
      await expect(resetPassword({ token: null, newPassword: 'ValidPassword1' })).rejects.toThrow(
        'Invalid or expired password reset token.'
      );
    });

    it('throws ValidationError if new password violates policy', async () => {
      await expect(resetPassword({ token: 'sometoken', newPassword: 'weak' })).rejects.toThrow(
        'Password must be at least 8 characters long'
      );
    });

    it('successfully resets password on Customer atomically and clears reset fields', async () => {
      authService.hashPassword.mockResolvedValue('$2b$12$newBcryptHashValue');
      Customer.findOneAndUpdate.mockResolvedValue({ _id: 'cust-123' });

      const result = await resetPassword({
        token: 'validrawtoken123',
        newPassword: 'BrandNewPassword1',
      });

      expect(result.success).toBe(true);
      expect(authService.hashPassword).toHaveBeenCalledWith('BrandNewPassword1');
      expect(Customer.findOneAndUpdate).toHaveBeenCalledTimes(1);

      const [filter, update] = Customer.findOneAndUpdate.mock.calls[0];
      expect(filter.passwordResetTokenHash).toBe(hashResetToken('validrawtoken123'));
      expect(filter.passwordResetExpiresAt.$gt).toBeInstanceOf(Date);
      expect(update.$set.passwordHash).toBe('$2b$12$newBcryptHashValue');
      expect(update.$unset).toEqual({
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
      });
    });

    it('successfully resets password on Staff atomically if Customer not matched', async () => {
      authService.hashPassword.mockResolvedValue('$2b$12$newBcryptHashValue');
      Customer.findOneAndUpdate.mockResolvedValue(null);
      Staff.findOneAndUpdate.mockResolvedValue({ _id: 'staff-456' });

      const result = await resetPassword({
        token: 'validrawtoken123',
        newPassword: 'StaffNewPassword1',
      });

      expect(result.success).toBe(true);
      expect(Customer.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(Staff.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestError with RESET_TOKEN_INVALID_OR_EXPIRED if no matching active token exists', async () => {
      authService.hashPassword.mockResolvedValue('$2b$12$newBcryptHashValue');
      Customer.findOneAndUpdate.mockResolvedValue(null);
      Staff.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        resetPassword({
          token: 'expiredOrUsedToken',
          newPassword: 'BrandNewPassword1',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'RESET_TOKEN_INVALID_OR_EXPIRED',
      });
    });
  });
});
