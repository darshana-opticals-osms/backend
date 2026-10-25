const bcrypt = require('bcrypt');
const { login } = require('../../src/services/auth.service');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { createAccessToken } = require('../../src/utils/jwt');

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../../src/models/customer.model', () => ({
  findOne: jest.fn(),
  exists: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../src/models/staff.model', () => ({
  findOne: jest.fn(),
  exists: jest.fn(),
}));

jest.mock('../../src/models/admin.model', () => ({
  findOne: jest.fn(),
  exists: jest.fn(),
}));

jest.mock('../../src/utils/jwt', () => ({
  createAccessToken: jest.fn(),
}));

const queryReturning = (value) => ({
  select: jest.fn().mockResolvedValue(value),
});

const setIdentityMatches = ({ customer = null, staff = null, admin = null } = {}) => {
  Customer.findOne.mockReturnValue(queryReturning(customer));
  Staff.findOne.mockReturnValue(queryReturning(staff));
  Admin.findOne.mockReturnValue(queryReturning(admin));
};

const collectedConsoleText = (spy) => spy.mock.calls.flatMap((call) => call.map(String)).join(' ');

describe('Authentication security logging', () => {
  let warnSpy;
  let infoSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('logs a generic failed-login event without credentials or account identifiers', async () => {
    const email = 'unknown.security@example.com';
    const password = 'SensitiveWrongPassword123!';

    setIdentityMatches();
    bcrypt.compare.mockResolvedValue(false);

    await expect(login({ email, password })).rejects.toThrow('Invalid email or password.');

    expect(warnSpy).toHaveBeenCalledWith('[SecurityAuth] LOGIN_FAILED');
    expect(infoSpy).not.toHaveBeenCalled();

    const loggedText = collectedConsoleText(warnSpy);
    expect(loggedText).not.toContain(email);
    expect(loggedText).not.toContain(password);
  });

  it('logs successful authentication using only the canonical role', async () => {
    const identity = {
      _id: { toString: () => '507f1f77bcf86cd799439011' },
      name: 'Security Customer',
      email: 'security.customer@example.com',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash: '$2b$12$storedHash',
      failedLoginAttempts: 0,
      lockUntil: null,
      constructor: Customer,
    };

    setIdentityMatches({ customer: identity });
    bcrypt.compare.mockResolvedValue(true);
    Customer.updateOne.mockResolvedValue({ matchedCount: 1 });
    createAccessToken.mockReturnValue('sensitive-jwt-token');

    const result = await login({
      email: identity.email,
      password: 'CorrectPassword123!',
    });

    expect(result.token).toBe('sensitive-jwt-token');
    expect(infoSpy).toHaveBeenCalledWith(
      `[SecurityAuth] LOGIN_SUCCEEDED role=${ROLE_VALUES.CUSTOMER}`
    );

    const loggedText = collectedConsoleText(infoSpy);
    expect(loggedText).not.toContain(identity.email);
    expect(loggedText).not.toContain('sensitive-jwt-token');
    expect(loggedText).not.toContain('CorrectPassword123!');
  });

  it('logs locked-account attempts generically without revealing the identity', async () => {
    const identity = {
      _id: { toString: () => '507f1f77bcf86cd799439012' },
      name: 'Locked Customer',
      email: 'locked.customer@example.com',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash: '$2b$12$storedHash',
      failedLoginAttempts: 5,
      lockUntil: new Date(Date.now() + 60_000),
    };

    setIdentityMatches({ customer: identity });
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      login({
        email: identity.email,
        password: 'CorrectPassword123!',
      })
    ).rejects.toThrow('Invalid email or password.');

    expect(warnSpy).toHaveBeenCalledWith('[SecurityAuth] LOGIN_BLOCKED_LOCKED');
    expect(infoSpy).not.toHaveBeenCalled();

    const loggedText = collectedConsoleText(warnSpy);
    expect(loggedText).not.toContain(identity.email);
    expect(loggedText).not.toContain(identity._id.toString());
    expect(loggedText).not.toContain('CorrectPassword123!');
  });
});
