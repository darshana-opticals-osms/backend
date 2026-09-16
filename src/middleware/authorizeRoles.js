const { ROLE_VALUES } = require('../constants/roles');
const { ForbiddenError, UnauthorizedError } = require('../errors/AppError');

const isCanonicalRole = (role) => Object.values(ROLE_VALUES).includes(role);

const authorizeRoles = (...allowedRoles) => {
  if (!allowedRoles.length) {
    throw new TypeError('authorizeRoles requires at least one canonical role value.');
  }

  const normalizedRoles = [...allowedRoles];
  const invalidRole = normalizedRoles.find(
    (role) => typeof role !== 'string' || !isCanonicalRole(role)
  );

  if (invalidRole) {
    throw new TypeError(
      `authorizeRoles received an invalid role configuration: ${String(invalidRole)}. Use ROLE_VALUES values only.`
    );
  }

  return (req, _res, next) => {
    const authenticatedRole = req && req.auth && req.auth.role;

    if (typeof authenticatedRole !== 'string' || !isCanonicalRole(authenticatedRole)) {
      return next(new UnauthorizedError('Authentication required.'));
    }

    if (!normalizedRoles.includes(authenticatedRole)) {
      return next(new ForbiddenError('Access forbidden'));
    }

    return next();
  };
};

module.exports = {
  authorizeRoles,
  isCanonicalRole,
};
