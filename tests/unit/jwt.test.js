const jwt = require('jsonwebtoken');
const { loadConfig } = require('../../src/config/env');
const { JWT_ALGORITHM, createAccessToken, verifyAccessToken } = require('../../src/utils/jwt');
const { ROLE_VALUES } = require('../../src/constants/roles');

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

describe('JWT utility', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'controlled-unit-test-secret';
    process.env.JWT_EXPIRES_IN = '2h';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should sign an access token with the configured secret, expiry, and HS256 algorithm', () => {
    // Arrange
    jwt.sign.mockReturnValue('signed-token');

    // Act
    const token = createAccessToken({
      userId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.CUSTOMER,
    });

    // Assert
    expect(token).toBe('signed-token');
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: '507f1f77bcf86cd799439011', role: ROLE_VALUES.CUSTOMER },
      'controlled-unit-test-secret',
      { algorithm: JWT_ALGORITHM, expiresIn: '2h' }
    );
  });

  it('should include branchId in token payload when provided', () => {
    jwt.sign.mockReturnValue('signed-token-with-branch');

    const token = createAccessToken({
      userId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: '507f1f77bcf86cd799439099',
    });

    expect(token).toBe('signed-token-with-branch');
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        userId: '507f1f77bcf86cd799439011',
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: '507f1f77bcf86cd799439099',
      },
      'controlled-unit-test-secret',
      { algorithm: JWT_ALGORITHM, expiresIn: '2h' }
    );
  });

  it('should verify only the configured signing algorithm and return trusted identity claims including branchId', () => {
    // Arrange
    jwt.verify.mockReturnValue({
      userId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.SYSTEM_ADMIN,
      branchId: '507f1f77bcf86cd799439099',
      iat: 1,
      exp: 2,
    });

    // Act
    const claims = verifyAccessToken('signed-token');

    // Assert
    expect(claims).toEqual({
      userId: '507f1f77bcf86cd799439011',
      role: ROLE_VALUES.SYSTEM_ADMIN,
      branchId: '507f1f77bcf86cd799439099',
    });
    expect(jwt.verify).toHaveBeenCalledWith('signed-token', 'controlled-unit-test-secret', {
      algorithms: [JWT_ALGORITHM],
    });
  });


  it.each([
    { userId: '', role: ROLE_VALUES.CUSTOMER },
    { userId: '507f1f77bcf86cd799439011', role: 'admin' },
    { userId: 42, role: ROLE_VALUES.CUSTOMER },
  ])('should reject invalid authenticated claim values', (payload) => {
    // Arrange
    jwt.verify.mockReturnValue(payload);

    // Act / Assert
    expect(() => verifyAccessToken('signed-token')).toThrow('Invalid authentication token.');
  });

  it('should require JWT_SECRET outside test mode', () => {
    // Arrange
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    // Act / Assert
    expect(() => loadConfig()).toThrow('JWT_SECRET is required');
  });
});
