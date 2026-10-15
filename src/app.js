const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { CORS_CONFIG, REQUEST_BODY_LIMIT } = require('./config/security');
const {
  generalLimiter,
  authLimiter,
  payhereNotificationLimiter,
} = require('./middleware/rateLimiter');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const profileRoutes = require('./routes/profile.routes');
const productRoutes = require('./routes/product.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const prescriptionRoutes = require('./routes/prescription.routes');
const branchRoutes = require('./routes/branch.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const customerLookupRoutes = require('./routes/customerLookup.routes');
const cartRoutes = require('./routes/cart.routes');
const checkoutRoutes = require('./routes/checkout.routes');
const orderRoutes = require('./routes/order.routes');
const appointmentRoutes = require('./routes/appointment.routes');
const { paymentRouter, paymentNotificationRouter } = require('./routes/payment.routes');
const captureCheckoutRequest = require('./middleware/captureCheckoutRequest');
const { rejectUnsafeAppointmentInput } = require('./middleware/rejectUnsafeAppointmentInput');
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

  // PayHere signs exact form values. Handle the callback before middleware
  // that parses JSON or mutates string input.
  app.use(
    '/api/payments/notify',
    payhereNotificationLimiter,
    express.urlencoded({ extended: false, limit: REQUEST_BODY_LIMIT, parameterLimit: 20 }),
    paymentNotificationRouter
  );

  // AC7: Reject oversized request bodies before application processing
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

  app.use('/api/checkout', captureCheckoutRequest);

  app.use(['/api/appointments', '/api/doctor-sessions'], rejectUnsafeAppointmentInput);

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
  app.use('/api', adminRoutes);
  app.use('/api', profileRoutes);
  app.use('/api', productRoutes);
  app.use('/api', inventoryRoutes);
  app.use('/api', prescriptionRoutes);
  app.use('/api', customerLookupRoutes);
  app.use('/api', branchRoutes);
  app.use('/api', chatbotRoutes);
  app.use('/api', cartRoutes);
  app.use('/api', checkoutRoutes);
  app.use('/api', orderRoutes);
  app.use('/api', paymentRouter);
  app.use('/api', appointmentRoutes);

  // Catch-all route handler for non-existent endpoints (404)

  app.use(notFound);

  // Centralized Error Handling Middleware (AC12: no stack traces in production)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
