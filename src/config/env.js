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
    MONGODB_URI: process.env.MONGODB_URI || '',
    JWT_SECRET: process.env.JWT_SECRET || '',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    CHATBOT_TIMEOUT_MS: process.env.CHATBOT_TIMEOUT_MS || '6000',
  };

  Object.assign(env, overrides);

  const errors = [];

  if (!['development', 'test', 'production'].includes(env.NODE_ENV)) {
    errors.push('NODE_ENV must be one of: development, test, production.');
  }

  if (!isValidPort(env.PORT)) {
    errors.push('PORT must be a valid TCP port.');
  }

  if (env.NODE_ENV !== 'test' && !env.MONGODB_URI) {
    errors.push(
      'MONGODB_URI is required in development, production, and other non-test environments.'
    );
  }

  if (env.NODE_ENV !== 'test' && !env.JWT_SECRET) {
    errors.push(
      'JWT_SECRET is required in development, production, and other non-test environments.'
    );
  }

  if (errors.length > 0) {
    const message = `Configuration validation failed: ${errors.join(' ')}`;
    throw new Error(message);
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: Number(env.PORT),
    mongoUri: env.MONGODB_URI || undefined,
    jwtSecret: env.JWT_SECRET || undefined,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    chatbotTimeoutMs: Number(env.CHATBOT_TIMEOUT_MS) || 6000,
  };
}

module.exports = {
  loadConfig,
};
