const dotenv = require('dotenv');

dotenv.config();

function isValidPort(value) {
  const portNumber = Number(value);
  return Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
}

function loadConfig(overrides = {}) {
  const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || '5000',
    ...overrides,
  };

  const errors = [];

  if (!['development', 'test', 'production'].includes(env.NODE_ENV)) {
    errors.push('NODE_ENV must be one of: development, test, production.');
  }

  if (!isValidPort(env.PORT)) {
    errors.push('PORT must be a valid TCP port.');
  }

  if (errors.length > 0) {
    const message = `Configuration validation failed: ${errors.join(' ')}`;
    throw new Error(message);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: Number(env.PORT),
  };
}

module.exports = {
  loadConfig,
};
