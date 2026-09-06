const express = require('express');
const healthRoutes = require('./routes/health.routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/api', healthRoutes);

  // Catch-all route handler for non-existent endpoints (404)
  app.use(notFound);

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
