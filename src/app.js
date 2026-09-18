const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const profileRoutes = require('./routes/profile.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { sanitizeInput } = require('./utils/sanitizer');

function createApp() {
  const app = express();

  app.use(express.json());

  // Input Sanitization Middleware (trims whitespace, strips script tags, prevents Mongo injection)
  app.use(sanitizeInput);

  // Swagger API Documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use('/api', healthRoutes);
  app.use('/api', authRoutes);
  app.use('/api', profileRoutes);

  // Catch-all route handler for non-existent endpoints (404)
  app.use(notFound);

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
