const { runImageReconciliation } = require('../services/imageReconciliation.service');

let cleanupTimer = null;

// Default check interval: 1 hour
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs one check iteration for image reconciliation with safe error handling.
 * @returns {Promise<{ failedCleanups: object, abandonedUploads: object } | null>}
 */
async function runImageCleanupOnce() {
  try {
    const result = await runImageReconciliation();
    return result;
  } catch (error) {
    console.error('Error during image cleanup execution:', error.message);
    return null;
  }
}

/**
 * Starts the periodic image cleanup and reconciliation scheduler.
 * @param {number} [intervalMs=DEFAULT_CLEANUP_INTERVAL_MS]
 */
function startImageCleanupScheduler(intervalMs = DEFAULT_CLEANUP_INTERVAL_MS) {
  if (cleanupTimer) {
    return;
  }

  // Run initial check upon start (non-blocking)
  runImageCleanupOnce();

  cleanupTimer = setInterval(() => {
    runImageCleanupOnce();
  }, intervalMs);

  // Do not hold process alive if this is the only active handle
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

/**
 * Stops the periodic image cleanup scheduler.
 */
function stopImageCleanupScheduler() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

module.exports = {
  DEFAULT_CLEANUP_INTERVAL_MS,
  runImageCleanupOnce,
  startImageCleanupScheduler,
  stopImageCleanupScheduler,
};
