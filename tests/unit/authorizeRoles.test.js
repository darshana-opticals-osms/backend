const { authorizeRoles } = require('../../src/middleware/authorizeRoles');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ForbiddenError, UnauthorizedError } = require('../../src/errors/AppError');

describe('authorizeRoles middleware', () => {
  it('should call next() when the authenticated role is explicitly allowed', () => {
    // Arrange
    const req = { auth: { role: ROLE_VALUES.INVENTORY_MANAGER } };
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.INVENTORY_MANAGER);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next() when the authenticated role is one of multiple explicitly allowed roles', () => {
    // Arrange
    const req = { auth: { role: ROLE_VALUES.MANAGEMENT } };
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.MANAGEMENT);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('should return a ForbiddenError when the authenticated role is not permitted', () => {
    // Arrange
    const req = { auth: { role: ROLE_VALUES.CUSTOMER } };
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('should return an UnauthorizedError when req.auth is missing', () => {
    // Arrange
    const req = {};
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  it('should return an UnauthorizedError when req.auth.role is missing', () => {
    // Arrange
    const req = { auth: {} };
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  it('should throw a synchronously when no allowed roles are configured', () => {
    // Arrange
    // Act
    // Assert
    expect(() => authorizeRoles()).toThrow(TypeError);
  });

  it('should throw a synchronously when a non-canonical role is configured', () => {
    // Arrange
    // Act
    // Assert
    expect(() => authorizeRoles('ADMIN')).toThrow(TypeError);
  });

  it('should read only req.auth.role and ignore client-provided role fields', () => {
    // Arrange
    const req = {
      auth: { role: ROLE_VALUES.CUSTOMER },
      body: { role: ROLE_VALUES.SYSTEM_ADMIN },
      query: { role: ROLE_VALUES.SYSTEM_ADMIN },
      headers: { role: ROLE_VALUES.SYSTEM_ADMIN },
    };
    const next = jest.fn();
    const middleware = authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN);

    // Act
    middleware(req, {}, next);

    // Assert
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });
});
