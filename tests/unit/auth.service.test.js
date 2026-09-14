const bcrypt = require('bcrypt');
const { checkExistingIdentity, registerCustomer } = require('../../src/services/auth.service');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

jest.mock('../../src/models/customer.model', () => ({
  create: jest.fn(),
  exists: jest.fn(),
}));

jest.mock('../../src/models/staff.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/admin.model', () => ({
  exists: jest.fn(),
}));

describe('Auth service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should detect a duplicate identity across customer, staff, and admin collections', async () => {
    // Arrange
    Customer.exists.mockResolvedValue(null);
    Staff.exists.mockResolvedValue({ _id: 'staff-id' });
    Admin.exists.mockResolvedValue(null);

    // Act
    const duplicate = await checkExistingIdentity('staff@example.com');

    // Assert
    expect(duplicate).toEqual({ _id: 'staff-id' });
    expect(Customer.exists).toHaveBeenCalledWith({ email: 'staff@example.com' });
    expect(Staff.exists).toHaveBeenCalledWith({ email: 'staff@example.com' });
    expect(Admin.exists).toHaveBeenCalledWith({ email: 'staff@example.com' });
  });

  it('should hash a password and create a customer record using the canonical CUSTOMER role', async () => {
    // Arrange
    const plainPassword = 'StrongPass123!';
    bcrypt.hash.mockResolvedValue('$2b$12$hashedPasswordValue');
    Customer.exists.mockResolvedValue(null);
    Staff.exists.mockResolvedValue(null);
    Admin.exists.mockResolvedValue(null);
    Customer.create.mockResolvedValue({
      _id: 'customer-id',
      name: 'Alice Customer',
      email: 'alice.customer@example.com',
      address: '12 Main Street',
      phone: '+94711234567',
      role: ROLE_VALUES.CUSTOMER,
    });

    // Act
    const customer = await registerCustomer({
      name: 'Alice Customer',
      email: 'alice.customer@example.com',
      address: '12 Main Street',
      phone: '+94711234567',
      password: plainPassword,
    });

    // Assert
    expect(bcrypt.hash).toHaveBeenCalledWith(plainPassword, 12);
    expect(Customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alice Customer',
        email: 'alice.customer@example.com',
        role: ROLE_VALUES.CUSTOMER,
        passwordHash: '$2b$12$hashedPasswordValue',
      })
    );
    expect(customer).toMatchObject({
      id: 'customer-id',
      name: 'Alice Customer',
      email: 'alice.customer@example.com',
      role: ROLE_VALUES.CUSTOMER,
    });
    expect(customer).not.toHaveProperty('password');
    expect(customer).not.toHaveProperty('passwordHash');
  });
});
