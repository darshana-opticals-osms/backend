const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('../config/env');
const { ROLE_VALUES } = require('../constants/roles');
const { UnauthorizedError } = require('../errors/AppError');

const JWT_ALGORITHM = 'HS256';
const CANONICAL_ROLES = new Set(Object.values(ROLE_VALUES));

const getJwtConfig = () => {
  const { jwtSecret, jwtExpiresIn } = loadConfig();

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required to sign or verify authentication tokens.');
  }

  return { jwtSecret, jwtExpiresIn };
};

const createAccessToken = ({ userId, role }) => {
  const { jwtSecret, jwtExpiresIn } = getJwtConfig();

  return jwt.sign({ userId, role }, jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: jwtExpiresIn,
  });
};

const verifyAccessToken = (token) => {
  const { jwtSecret } = getJwtConfig();
  const payload = jwt.verify(token, jwtSecret, { algorithms: [JWT_ALGORITHM] });

  if (
    !payload ||
    typeof payload.userId !== 'string' ||
    !mongoose.isValidObjectId(payload.userId) ||
    typeof payload.role !== 'string' ||
    !CANONICAL_ROLES.has(payload.role)
  ) {
    throw new UnauthorizedError('Invalid authentication token.');
  }

  return {
    userId: payload.userId,
    role: payload.role,
  };
};

module.exports = {
  JWT_ALGORITHM,
  createAccessToken,
  verifyAccessToken,
};
