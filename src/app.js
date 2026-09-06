const express = require('express');
const healthRoutes = require('./routes/health.routes');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/api', healthRoutes);

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    const statusCode = err.statusCode || 500;
    const safeMessage = statusCode >= 500 ? 'Internal server error' : err.message;

    return res.status(statusCode).json({
      error: safeMessage,
    });
  });

  return app;
}

module.exports = { createApp };
