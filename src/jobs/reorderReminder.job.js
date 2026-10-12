const { processPeriodicReminders } = require('../services/reorderAlert.service');

let reminderTimer = null;

// Default check interval: 15 minutes (to detect 3-hour boundaries during working hours)
const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Runs one check iteration for reorder reminders with safe error logging.
 * @returns {Promise<{ remindersSent: number, withinWorkingHours: boolean } | null>}
 */
async function runReminderCheckOnce() {
  try {
    const result = await processPeriodicReminders();
    return result;
  } catch (error) {
    console.error('Error during periodic reorder reminder execution:', error.message);
    return null;
  }
}

/**
 * Starts the periodic reminder scheduler.
 * @param {number} [intervalMs=DEFAULT_CHECK_INTERVAL_MS]
 */
function startReminderScheduler(intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
  if (reminderTimer) {
    return;
  }

  // Run initial check upon start
  runReminderCheckOnce();

  reminderTimer = setInterval(() => {
    runReminderCheckOnce();
  }, intervalMs);

  // Do not hold process alive if this is the only active handle
  if (reminderTimer && typeof reminderTimer.unref === 'function') {
    reminderTimer.unref();
  }
}

/**
 * Stops the periodic reminder scheduler.
 */
function stopReminderScheduler() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  runReminderCheckOnce,
  startReminderScheduler,
  stopReminderScheduler,
};
