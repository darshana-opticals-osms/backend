const bcrypt = require('bcrypt');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { ACCOUNT_LOCKOUT } = require('../../src/config/security');
const { login } = require('../../src/services/auth.service');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Admin = require('../../src/models/admin.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const PASSWORD = 'LockoutPass123!';
const WRONG_PASSWORD = 'DefinitelyWrong123!';

const getSecurityState = async (Model, email) =>
  Model.findOne({ email }).select('+failedLoginAttempts +lockUntil').lean();

const expectGenericAuthenticationFailure = async (loginPromise) => {
  await expect(loginPromise).rejects.toThrow('Invalid email or password.');
};

describe('DDP-085 account lockout', () => {
  let previousNodeEnv;
  let previousJwtSecret;
  let previousJwtExpiresIn;
  let previousMongoUri;

  beforeAll(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    previousJwtSecret = process.env.JWT_SECRET;
    previousJwtExpiresIn = process.env.JWT_EXPIRES_IN;
    previousMongoUri = process.env.MONGODB_URI;

    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'controlled-ddp-085-account-lockout-secret';
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;

    await connectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Admin.deleteMany({})]);
    await disconnectDatabase();

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;

    if (previousJwtExpiresIn === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = previousJwtExpiresIn;

    if (previousMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongoUri;
  });

  const createCustomer = async (email = 'lockout.customer@example.com') =>
    Customer.create({
      name: 'Lockout Customer',
      email,
      address: '12 Security Street',
      phone: '+94711111111',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });

  const createStaff = async () =>
    Staff.create({
      name: 'Lockout Staff',
      email: 'lockout.staff@example.com',
      phone: '+94712222222',
      address: 'Branch Road',
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });

  const createAdmin = async () =>
    Admin.create({
      name: 'Lockout Admin',
      email: 'lockout.admin@example.com',
      phone: '+94713333333',
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });

  const failLoginUntilLocked = async (email) => {
    for (let attempt = 0; attempt < ACCOUNT_LOCKOUT.maxAttempts; attempt += 1) {
      await expectGenericAuthenticationFailure(
        login({
          email,
          password: WRONG_PASSWORD,
        })
      );
    }
  };

  const holdSuccessfulLoginReset = (Model) => {
    const originalUpdateOne = Model.updateOne.bind(Model);

    let signalResetAttempted;
    let releaseReset;

    const resetAttempted = new Promise((resolve) => {
      signalResetAttempted = resolve;
    });

    const resetReleased = new Promise((resolve) => {
      releaseReset = resolve;
    });

    const updateSpy = jest
      .spyOn(Model, 'updateOne')
      .mockImplementation((filter, update, options) => {
        const isSuccessfulLoginReset =
          update?.$set?.failedLoginAttempts === 0 && update?.$set?.lockUntil === null;

        if (!isSuccessfulLoginReset) {
          return originalUpdateOne(filter, update, options);
        }

        signalResetAttempted();

        return resetReleased.then(() => originalUpdateOne(filter, update, options));
      });

    return {
      resetAttempted,
      releaseReset,
      restore: () => updateSpy.mockRestore(),
    };
  };

  it('locks a customer after the configured consecutive failed-login threshold', async () => {
    const customer = await createCustomer();

    await failLoginUntilLocked(customer.email);

    const state = await getSecurityState(Customer, customer.email);

    expect(state.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
    expect(state.lockUntil).toBeInstanceOf(Date);
    expect(state.lockUntil.getTime()).toBeGreaterThan(Date.now());

    await expectGenericAuthenticationFailure(
      login({
        email: customer.email,
        password: PASSWORD,
      })
    );

    const stillLocked = await getSecurityState(Customer, customer.email);

    expect(stillLocked.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
    expect(stillLocked.lockUntil).toEqual(state.lockUntil);
  });

  it('clears prior failed-login state after a successful login', async () => {
    const customer = await createCustomer('reset.customer@example.com');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectGenericAuthenticationFailure(
        login({
          email: customer.email,
          password: WRONG_PASSWORD,
        })
      );
    }

    const authentication = await login({
      email: customer.email,
      password: PASSWORD,
    });

    expect(authentication.token).toEqual(expect.any(String));

    const state = await getSecurityState(Customer, customer.email);

    expect(state.failedLoginAttempts).toBe(0);
    expect(state.lockUntil).toBeNull();
  });

  it('starts a fresh failure sequence after a temporary lock expires', async () => {
    const customer = await createCustomer('expired.customer@example.com');

    await Customer.updateOne(
      { _id: customer._id },
      {
        $set: {
          failedLoginAttempts: ACCOUNT_LOCKOUT.maxAttempts,
          lockUntil: new Date(Date.now() - 1000),
        },
      }
    );

    await expectGenericAuthenticationFailure(
      login({
        email: customer.email,
        password: WRONG_PASSWORD,
      })
    );

    const state = await getSecurityState(Customer, customer.email);

    expect(state.failedLoginAttempts).toBe(1);
    expect(state.lockUntil).toBeNull();
  });

  it.each([
    ['staff', Staff, createStaff],
    ['admin', Admin, createAdmin],
  ])('applies the same lockout policy to %s accounts', async (_label, Model, createIdentity) => {
    const identity = await createIdentity();

    await failLoginUntilLocked(identity.email);

    const state = await getSecurityState(Model, identity.email);

    expect(state.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
    expect(state.lockUntil).toBeInstanceOf(Date);
    expect(state.lockUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not erase a newer failed attempt when a successful login finishes with stale state', async () => {
    const customer = await createCustomer('concurrent.customer@example.com');

    await Customer.updateOne(
      { _id: customer._id },
      {
        $set: {
          failedLoginAttempts: 2,
          lockUntil: null,
        },
      }
    );

    const gate = holdSuccessfulLoginReset(Customer);

    try {
      const successfulLogin = login({
        email: customer.email,
        password: PASSWORD,
      });

      await gate.resetAttempted;

      await expectGenericAuthenticationFailure(
        login({
          email: customer.email,
          password: WRONG_PASSWORD,
        })
      );

      gate.releaseReset();

      await expectGenericAuthenticationFailure(successfulLogin);

      const state = await getSecurityState(Customer, customer.email);

      expect(state.failedLoginAttempts).toBe(3);
      expect(state.lockUntil).toBeNull();
    } finally {
      gate.releaseReset();
      gate.restore();
    }
  });

  it('does not clear a lock created by a concurrent fifth failed login', async () => {
    const customer = await createCustomer('concurrent.lock.customer@example.com');

    await Customer.updateOne(
      { _id: customer._id },
      {
        $set: {
          failedLoginAttempts: ACCOUNT_LOCKOUT.maxAttempts - 1,
          lockUntil: null,
        },
      }
    );

    const gate = holdSuccessfulLoginReset(Customer);

    try {
      const successfulLogin = login({
        email: customer.email,
        password: PASSWORD,
      });

      await gate.resetAttempted;

      await expectGenericAuthenticationFailure(
        login({
          email: customer.email,
          password: WRONG_PASSWORD,
        })
      );

      const lockedState = await getSecurityState(Customer, customer.email);

      expect(lockedState.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
      expect(lockedState.lockUntil).toBeInstanceOf(Date);
      expect(lockedState.lockUntil.getTime()).toBeGreaterThan(Date.now());

      gate.releaseReset();

      await expectGenericAuthenticationFailure(successfulLogin);

      const finalState = await getSecurityState(Customer, customer.email);

      expect(finalState.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
      expect(finalState.lockUntil).toEqual(lockedState.lockUntil);
    } finally {
      gate.releaseReset();
      gate.restore();
    }
  });

  it('rejects a stale successful login when concurrent failures lock an initially clean account', async () => {
    const customer = await createCustomer('concurrent.clean.customer@example.com');

    const initialState = await getSecurityState(Customer, customer.email);

    expect(initialState.failedLoginAttempts).toBe(0);
    expect(initialState.lockUntil).toBeNull();

    const gate = holdSuccessfulLoginReset(Customer);

    try {
      const successfulLogin = login({
        email: customer.email,
        password: PASSWORD,
      });

      await gate.resetAttempted;

      await failLoginUntilLocked(customer.email);

      const lockedState = await getSecurityState(Customer, customer.email);

      expect(lockedState.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
      expect(lockedState.lockUntil).toBeInstanceOf(Date);
      expect(lockedState.lockUntil.getTime()).toBeGreaterThan(Date.now());

      gate.releaseReset();

      await expectGenericAuthenticationFailure(successfulLogin);

      const finalState = await getSecurityState(Customer, customer.email);

      expect(finalState.failedLoginAttempts).toBe(ACCOUNT_LOCKOUT.maxAttempts);
      expect(finalState.lockUntil).toEqual(lockedState.lockUntil);
    } finally {
      gate.releaseReset();
      gate.restore();
    }
  });
});
