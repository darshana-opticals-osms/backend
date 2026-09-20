const bcrypt = require('bcrypt');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ConflictError, UnauthorizedError } = require('../errors/AppError');
const { createAccessToken } = require('../utils/jwt');

const BCRYPT_SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = '$2b$12$yQa0uZLdNMNWbfUR4Cq40ObkJsDegwPc51KLL2pYzbZRPFfJZMaKe';

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

  return safeIdentity;
};

const findLoginIdentity = async (email) => {
  const matches = await Promise.all([
    Customer.findOne({ email }).select('+passwordHash'),
    Staff.findOne({ email }).select('+passwordHash'),
    Admin.findOne({ email }).select('+passwordHash'),
  ]);

  const identities = matches.filter(Boolean);
  return identities.length === 1 ? identities[0] : null;
};

const login = async ({ email, password }) => {
  const identity = await findLoginIdentity(email);
  const passwordHash = identity ? identity.passwordHash : DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(password, passwordHash);

  if (!identity || !passwordMatches) {
    throw new UnauthorizedError('Invalid email or password.');
  }

  const user = buildSafeIdentityResponse(identity);
  const token = createAccessToken({ userId: user.id, role: user.role });

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
