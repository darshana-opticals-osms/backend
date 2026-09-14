const bcrypt = require('bcrypt');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Admin = require('../models/admin.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ConflictError } = require('../errors/AppError');

const BCRYPT_SALT_ROUNDS = 12;

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

const registerCustomer = async (customerInput = {}) => {
  const { name, email, address, phone, password } = customerInput;

  const existingIdentity = await checkExistingIdentity(email);
  if (existingIdentity) {
    throw new ConflictError('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const customer = await Customer.create({
    name,
    email,
    address,
    phone,
    role: ROLE_VALUES.CUSTOMER,
    passwordHash,
  });

  return buildSafeCustomerResponse(customer);
};

module.exports = {
  BCRYPT_SALT_ROUNDS,
  checkExistingIdentity,
  registerCustomer,
  buildSafeCustomerResponse,
};
