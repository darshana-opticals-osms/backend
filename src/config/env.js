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
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    CHATBOT_TIMEOUT_MS: process.env.CHATBOT_TIMEOUT_MS || '6000',
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
    PAYMENT_CURRENCY: process.env.PAYMENT_CURRENCY || 'LKR',
    PAYHERE_MODE: process.env.PAYHERE_MODE || 'sandbox',
    PAYHERE_MERCHANT_ID: process.env.PAYHERE_MERCHANT_ID || '',
    PAYHERE_MERCHANT_SECRET: process.env.PAYHERE_MERCHANT_SECRET || '',
    PAYHERE_RETURN_URL: process.env.PAYHERE_RETURN_URL || '',
    PAYHERE_CANCEL_URL: process.env.PAYHERE_CANCEL_URL || '',
    PAYHERE_NOTIFY_URL: process.env.PAYHERE_NOTIFY_URL || '',
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

  if (env.PAYMENT_CURRENCY !== 'LKR') {
    errors.push('PAYMENT_CURRENCY must be LKR.');
  }

  if (!['sandbox', 'live'].includes(env.PAYHERE_MODE)) {
    errors.push('PAYHERE_MODE must be one of: sandbox, live.');
  }

  if (env.PAYHERE_MODE === 'live' && env.NODE_ENV !== 'production') {
    errors.push('PAYHERE_MODE=live is permitted only when NODE_ENV=production.');
  }

  if (env.PAYHERE_MODE === 'live') {
    for (const key of [
      'PAYHERE_MERCHANT_ID',
      'PAYHERE_MERCHANT_SECRET',
      'PAYHERE_RETURN_URL',
      'PAYHERE_CANCEL_URL',
      'PAYHERE_NOTIFY_URL',
    ]) {
      if (!env[key]) errors.push(`${key} is required in PayHere live mode.`);
    }
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
    geminiModel: env.GEMINI_MODEL,
    chatbotTimeoutMs: Number(env.CHATBOT_TIMEOUT_MS) || 6000,
    cloudinaryCloudName: env.CLOUDINARY_CLOUD_NAME || undefined,
    cloudinaryApiKey: env.CLOUDINARY_API_KEY || undefined,
    cloudinaryApiSecret: env.CLOUDINARY_API_SECRET || undefined,
    paymentCurrency: env.PAYMENT_CURRENCY,
    payhereMode: env.PAYHERE_MODE,
    payhereMerchantId: env.PAYHERE_MERCHANT_ID || undefined,
    payhereMerchantSecret: env.PAYHERE_MERCHANT_SECRET || undefined,
    payhereReturnUrl: env.PAYHERE_RETURN_URL || undefined,
    payhereCancelUrl: env.PAYHERE_CANCEL_URL || undefined,
    payhereNotifyUrl: env.PAYHERE_NOTIFY_URL || undefined,
    payhereCheckoutUrl:
      env.PAYHERE_MODE === 'live'
        ? 'https://www.payhere.lk/pay/checkout'
        : 'https://sandbox.payhere.lk/pay/checkout',
  };
}

module.exports = {
  loadConfig,
};
