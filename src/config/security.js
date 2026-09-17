/**
 * Centralized Security Configuration (AC13)
 *
 * All security-relevant values are read from environment variables with
 * safe defaults so that development, staging, and production environments
 * can each be configured independently without changing source code.
 */

/**
 * CORS allowed origins.
 * FRONTEND_ORIGIN may be a single URL or a comma-separated list.
 * In test mode all origins are permitted so integration tests can run
 * without a real browser origin.
 */
const CORS_ORIGINS =
  process.env.NODE_ENV === 'test'
    ? true // allow all origins during automated tests
    : (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

const CORS_CONFIG = {
  origin: CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

/**
 * General API rate limit.
 * Applied to all /api routes.
 * Default: 100 requests per 15 minutes per IP.
 */
const GENERAL_RATE_LIMIT = {
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
};

/**
 * Authentication endpoint rate limit.
 * Applied to /api/auth routes — stricter than general limit.
 * Default: 10 requests per 15 minutes per IP (AC4, AC5).
 */
const AUTH_RATE_LIMIT = {
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
};

/**
 * Request body size limit (AC7).
 * Default: 10 kilobytes — rejects unexpectedly large payloads before
 * application processing.
 */
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '10kb';

module.exports = {
  CORS_CONFIG,
  GENERAL_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  REQUEST_BODY_LIMIT,
};
