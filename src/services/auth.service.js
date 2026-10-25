const bcrypt = require('bcrypt');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ConflictError, UnauthorizedError } = require('../errors/AppError');
const { createAccessToken } = require('../utils/jwt');
const { ACCOUNT_LOCKOUT } = require('../config/security');

const BCRYPT_SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = '$2b$12$yQa0uZLdNMNWbfUR4Cq40ObkJsDegwPc51KLL2pYzbZRPFfJZMaKe';
const AUTH_LOG_PREFIX = '[SecurityAuth]';

const logAuthenticationFailure = (event = 'LOGIN_FAILED') => {
  console.warn(`${AUTH_LOG_PREFIX} ${event}`);
};

const logAuthenticationSuccess = (role) => {
  console.info(`${AUTH_LOG_PREFIX} LOGIN_SUCCEEDED role=${role}`);
};

const checkExistingIdentity = async (email) => {
  const [customer, staff, admin] = await Promise.all([
    Customer.exists({ email }),
    Staff.exists({ email }),
    Admin.exists({ email }),
  ]);

  return customer || staff || admin || null;
};

const buildSafeCustomerResponse = (customer) => ({
  id: customer._id ? customer._id.toString() : customer.id,
  name: customer.name,
  email: customer.email,
  address: customer.address,
  phone: customer.phone,
  role: customer.role,
});

const buildSafeIdentityResponse = (identity) => {
  const safeIdentity = {
    id: identity._id ? identity._id.toString() : identity.id,
    name: identity.name,
    email: identity.email,
    role: identity.role,
  };

  if (identity.address !== undefined) safeIdentity.address = identity.address;
  if (identity.phone !== undefined) safeIdentity.phone = identity.phone;
  if (identity.branchId) safeIdentity.branchId = identity.branchId.toString();

  return safeIdentity;
};

const findLoginIdentity = async (email) => {
  const matches = await Promise.all([
    Customer.findOne({ email }).select('+passwordHash +failedLoginAttempts +lockUntil'),
    Staff.findOne({ email }).select('+passwordHash +failedLoginAttempts +lockUntil'),
    Admin.findOne({ email }).select('+passwordHash +failedLoginAttempts +lockUntil'),
  ]);

  const identities = matches.filter(Boolean);
  return identities.length === 1 ? identities[0] : null;
};

const isAccountLocked = (identity, now = new Date()) =>
  Boolean(identity?.lockUntil && identity.lockUntil.getTime() > now.getTime());

const recordFailedLogin = async (identity, now = new Date()) => {
  const Model = identity.constructor;

  if (identity.lockUntil && identity.lockUntil.getTime() <= now.getTime()) {
    await Model.updateOne(
      { _id: identity._id, lockUntil: identity.lockUntil },
      { $set: { failedLoginAttempts: 0, lockUntil: null } }
    );
  }

  const updatedIdentity = await Model.findOneAndUpdate(
    {
      _id: identity._id,
      $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    },
    { $inc: { failedLoginAttempts: 1 } },
    { new: true }
  ).select('+failedLoginAttempts +lockUntil');

  if (!updatedIdentity || updatedIdentity.failedLoginAttempts < ACCOUNT_LOCKOUT.maxAttempts) {
    return;
  }

  await Model.updateOne(
    {
      _id: identity._id,
      $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    },
    {
      $set: {
        failedLoginAttempts: ACCOUNT_LOCKOUT.maxAttempts,
        lockUntil: new Date(now.getTime() + ACCOUNT_LOCKOUT.lockMs),
      },
    }
  );
};

const clearLoginFailures = async (identity) => {
  const failedLoginAttempts = Number(identity.failedLoginAttempts) || 0;
  const lockUntil = identity.lockUntil ?? null;

  if (failedLoginAttempts === 0 && !lockUntil) return true;

  const result = await identity.constructor.updateOne(
    {
      _id: identity._id,
      failedLoginAttempts,
      lockUntil,
    },
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    }
  );

  return result.matchedCount === 1;
};

const login = async ({ email, password }) => {
  const identity = await findLoginIdentity(email);
  const passwordHash = identity ? identity.passwordHash : DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(password, passwordHash);

  if (!identity) {
    logAuthenticationFailure();
    throw new UnauthorizedError('Invalid email or password.');
  }

  const now = new Date();

  if (isAccountLocked(identity, now)) {
    logAuthenticationFailure('LOGIN_BLOCKED_LOCKED');
    throw new UnauthorizedError('Invalid email or password.');
  }

  if (!passwordMatches) {
    await recordFailedLogin(identity, now);
    logAuthenticationFailure();
    throw new UnauthorizedError('Invalid email or password.');
  }

  if (identity.isActive === false) {
    logAuthenticationFailure();
    throw new UnauthorizedError('Account is inactive.');
  }

  const loginStateCleared = await clearLoginFailures(identity);

  if (!loginStateCleared) {
    logAuthenticationFailure();
    throw new UnauthorizedError('Invalid email or password.');
  }
  const user = buildSafeIdentityResponse(identity);
  const token = createAccessToken({
    userId: user.id,
    role: user.role,
    branchId: user.branchId || null,
  });

  logAuthenticationSuccess(user.role);

  return { token, user };
};

const hashPassword = async (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

const registerCustomer = async (customerInput = {}) => {
  const { name, email, address = '', phone, password } = customerInput;

  const existingIdentity = await checkExistingIdentity(email);
  if (existingIdentity) {
    throw new ConflictError('An account with this email already exists.');
  }

  const passwordHash = await hashPassword(password);

  const customer = await Customer.create({
    name,
    email,
    address: typeof address === 'string' ? address.trim() : '',
    phone,
    role: ROLE_VALUES.CUSTOMER,
    passwordHash,
  });

  return buildSafeCustomerResponse(customer);
};

module.exports = {
  BCRYPT_SALT_ROUNDS,
  hashPassword,
  checkExistingIdentity,
  registerCustomer,
  buildSafeCustomerResponse,
  findLoginIdentity,
  login,
  buildSafeIdentityResponse,
};
