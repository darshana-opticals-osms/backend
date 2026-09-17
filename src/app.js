const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { CORS_CONFIG, REQUEST_BODY_LIMIT } = require('./config/security');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { sanitizeInput } = require('./utils/sanitizer');

function createApp() {
  const app = express();

  // --- Security Middleware ---

  // AC1: Security HTTP headers (Content-Security-Policy, X-Frame-Options, etc.)
  app.use(helmet());

  // AC2: CORS — allow only configured frontend origins
  app.use(cors(CORS_CONFIG));

  // AC7: Reject oversized request bodies before application processing
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

  // AC8: Input Sanitization (trims whitespace, strips script tags, prevents Mongo injection)
  app.use(sanitizeInput);

  // AC3: General API rate limiter — applied to all /api routes
  app.use('/api', generalLimiter);

  // AC4, AC5: Stricter rate limiter on authentication endpoints
  app.use('/api/auth', authLimiter);

  // --- API Documentation ---
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // --- Routes ---
  app.use('/api', healthRoutes);
  app.use('/api', authRoutes);

  // Catch-all route handler for non-existent endpoints (404)
  app.use(notFound);

  // Centralized Error Handling Middleware (AC12: no stack traces in production)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
