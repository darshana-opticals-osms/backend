const { loadConfig } = require('./config/env');
const { createApp } = require('./app');
const { connectDatabase } = require('./config/database');
const { startReminderScheduler } = require('./jobs/reorderReminder.job');
const { startImageCleanupScheduler } = require('./jobs/imageCleanup.job');
const { startReservationExpiryScheduler } = require('./jobs/paymentReservation.job');
require('./services/orderNotification.service');

async function startServer() {
  const { port } = loadConfig();
  const app = createApp();

  try {
    await connectDatabase();
    app.listen(port, () => {
      console.log(`OSMS backend listening on port ${port}`);
      startReminderScheduler();
      startImageCleanupScheduler();
      startReservationExpiryScheduler();
    });
  } catch (error) {
    console.error('Failed to start OSMS backend:', error.message);
    process.exit(1);
  }
}

startServer();
