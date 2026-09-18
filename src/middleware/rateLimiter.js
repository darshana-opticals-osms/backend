const rateLimit = require('express-rate-limit');
const { GENERAL_RATE_LIMIT, AUTH_RATE_LIMIT } = require('../config/security');

/**
 * Standard rate-limit exceeded handler.
 * Returns a consistent JSON response that does not expose internal details (AC9).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    success: false,
    error: {
      message: 'Too many requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  });
};

/**
 * General API rate limiter (AC3).
 *
 * Applied to all /api routes.
 * Limits abusive traffic without disrupting legitimate clients.
 *
 * Default: 100 requests per 15 minutes per IP (configurable via env).
 */
const generalLimiter = rateLimit({
  windowMs: GENERAL_RATE_LIMIT.windowMs,
  max: GENERAL_RATE_LIMIT.max,
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable deprecated X-RateLimit-* headers
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
});

/**
 * Authentication endpoint rate limiter (AC4, AC5).
 *
 * Applied only to /api/auth routes — stricter than the general limiter
 * to protect against brute-force login attempts (AC5).
 *
 * Default: 10 requests per 15 minutes per IP (configurable via env).
 */
const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT.windowMs,
  max: AUTH_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
});

module.exports = { generalLimiter, authLimiter };
