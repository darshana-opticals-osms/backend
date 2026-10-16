const crypto = require('crypto');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ROLE_VALUES } = require('../constants/roles');
const { BadRequestError, ValidationError } = require('../errors/AppError');
const { hashPassword } = require('./auth.service');
const notificationService = require('./notification.service');

const TOKEN_EXPIRY_MINUTES = 15;
const RESET_TOKEN_BYTE_LENGTH = 32;

const ELIGIBLE_ROLES = [
  ROLE_VALUES.CUSTOMER,
  ROLE_VALUES.BRANCH_MANAGER,
  ROLE_VALUES.BRANCH_ASSISTANT,
  ROLE_VALUES.OPTOMETRIST,
];

const GENERIC_FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: 'If an eligible account exists for this email, a password reset link has been sent.',
};

const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Generates a cryptographically secure random token.
 * Complies with Issue #83 AC8.
 *
 * @returns {string} Raw token in hex format (64 characters, 256-bit entropy)
 */
function generateResetToken() {
  return crypto.randomBytes(RESET_TOKEN_BYTE_LENGTH).toString('hex');
}

/**
 * Computes a one-way SHA-256 hash of a raw reset token.
 * Complies with Issue #83 AC9.
 *
 * @param {string} rawToken
 * @returns {string} SHA-256 hex digest
 */
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Validates a new password against Staff/Customer security policy.
 * Complies with Issue #83 AC15:
 * - at least 8 characters
 * - at least one uppercase letter
 * - at least one lowercase letter
 * - at least one number
 *
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_POLICY_REGEX.test(password);
}

/**
 * Handles password reset request for a registered email.
 * Complies with Issue #83 AC1 - AC11, AC20 - AC24:
 * - Generic anti-enumeration response for all valid email inputs (AC4)
 * - Excludes Admin identities from reset issuance (AC2, AC6)
 * - Fails closed on ambiguous/multiple matches without revealing account state (AC7)
 * - Stores only one active SHA-256 token hash and 15-minute expiry (AC9, AC10, AC11)
 * - Dispatches safe reset link via existing notification infrastructure (AC20 - AC24)
 * - Never returns or logs raw reset token or passwords (AC24)
 *
 * @param {string} emailInput - Raw email from request
 * @param {object} [options]
 * @param {object} [options.notificationOptions] - Optional transporter/notification overrides
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function requestPasswordReset(emailInput, options = {}) {
  if (!emailInput || typeof emailInput !== 'string') {
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  const normalizedEmail = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  // Search eligible Customer and Staff identities (and check Admin exclusion)
  const [customerMatches, staffMatches] = await Promise.all([
    Customer.find({ email: normalizedEmail }),
    Staff.find({ email: normalizedEmail }),
    Admin.exists({ email: normalizedEmail }),
  ]);

  const totalEligibleMatches = customerMatches.length + staffMatches.length;

  // AC7: Ambiguous legacy/corrupted identity fails closed.
  // Do not guess the target identity, do not send reset email, keep public response generic.
  if (totalEligibleMatches > 1) {
    console.warn(
      '[PasswordResetService] Ambiguous multiple eligible matches detected for email; aborting reset link dispatch fail-closed.'
    );
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  // AC2 & AC6: If no eligible Customer or Staff matches found (including Admin-only or non-existent),
  // return identical generic success without dispatching email.
  if (totalEligibleMatches === 0) {
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  const targetDoc = customerMatches[0] || staffMatches[0];

  // Verify role eligibility
  if (!targetDoc || !ELIGIBLE_ROLES.includes(targetDoc.role)) {
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  // Generate cryptographically secure token & compute SHA-256 hash (AC8, AC9)
  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

  // AC11: Replace prior unused reset token with the newest active token
  targetDoc.passwordResetTokenHash = tokenHash;
  targetDoc.passwordResetExpiresAt = expiresAt;

  try {
    await targetDoc.save();
  } catch {
    // Review finding 3: Handle persistence failures safely without exposing account eligibility.
    // Retain safe operational logging for diagnosis and abort email dispatch.
    console.error(
      '[PasswordResetService] Failed to persist reset token state due to database operational failure.'
    );
    return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
  }

  // AC22: Build reset link from approved frontend configuration
  const frontendBaseUrl = (
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN?.split(',')[0] ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');

  const resetUrl = `${frontendBaseUrl}/reset-password?token=${rawToken}`;

  // Review finding 1 & 2: Decouple SMTP notification delivery from the HTTP response path.
  // Dispatching asynchronously off the response path ensures identical fast response times
  // for both existing and non-existing accounts, preventing timing-based account enumeration.
  // Exception logging uses safe, controlled operational messages without untrusted err.message strings.
  const dispatchNotification = async () => {
    try {
      await notificationService.sendPasswordResetNotification(
        {
          to: normalizedEmail,
          resetUrl,
          minutesValid: TOKEN_EXPIRY_MINUTES,
        },
        options.notificationOptions || {}
      );
    } catch {
      console.warn(
        '[PasswordResetService] Password reset notification delivery encountered an operational failure.'
      );
    }
  };

  if (options.awaitDispatch) {
    await dispatchNotification();
  } else {
    setImmediate(dispatchNotification);
  }

  return { ...GENERIC_FORGOT_PASSWORD_RESPONSE };
}

/**
 * Resets an account password using a single-use reset token.
 * Complies with Issue #83 AC12, AC14 - AC19, AC27:
 * - Validates new password complexity (AC15)
 * - Atomic password update and reset-token invalidation (AC12, AC19)
 * - Concurrency protection: simultaneous requests with same token will only permit one to succeed
 * - Rejects expired, invalid, or already-used tokens with safe error code (AC18)
 * - Hashes password using existing bcrypt configuration (AC17)
 *
 * @param {object} params
 * @param {string} params.token - Raw reset token
 * @param {string} params.newPassword - New plain-text password
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function resetPassword({ token, newPassword }) {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new BadRequestError(
      'Invalid or expired password reset token.',
      null,
      'RESET_TOKEN_INVALID_OR_EXPIRED'
    );
  }

  if (!isValidPassword(newPassword)) {
    throw new ValidationError(
      'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.',
      { field: 'newPassword' }
    );
  }

  const tokenHash = hashResetToken(token.trim());
  const now = new Date();
  const hashedPassword = await hashPassword(newPassword);

  const filter = {
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: now },
  };

  const update = {
    $set: { passwordHash: hashedPassword },
    $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
  };

  // Attempt atomic update on Customer collection
  const updatedCustomer = await Customer.findOneAndUpdate(filter, update, {
    new: false,
  });

  if (updatedCustomer) {
    return {
      success: true,
      message: 'Password has been successfully reset. You can now log in with your new password.',
    };
  }

  // Attempt atomic update on Staff collection
  const updatedStaff = await Staff.findOneAndUpdate(filter, update, {
    new: false,
  });

  if (updatedStaff) {
    return {
      success: true,
      message: 'Password has been successfully reset. You can now log in with your new password.',
    };
  }

  // Neither Customer nor Staff matched unexpired token
  throw new BadRequestError(
    'Invalid or expired password reset token.',
    null,
    'RESET_TOKEN_INVALID_OR_EXPIRED'
  );
}

module.exports = {
  TOKEN_EXPIRY_MINUTES,
  RESET_TOKEN_BYTE_LENGTH,
  ELIGIBLE_ROLES,
  GENERIC_FORGOT_PASSWORD_RESPONSE,
  generateResetToken,
  hashResetToken,
  isValidPassword,
  requestPasswordReset,
  resetPassword,
};
