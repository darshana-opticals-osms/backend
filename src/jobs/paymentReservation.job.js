const { sweepExpiredReservations } = require('../services/orderReservation.service');

const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000;
let timer = null;
let inFlight = null;
let cursor = null;

function runReservationExpiryOnce() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const result = await sweepExpiredReservations({ afterId: cursor });
      cursor = result.nextCursor;
      if (result.held.length || result.failed.length) {
        console.warn('[PaymentReservation] Expiry requires attention:', {
          held: result.held,
          failed: result.failed,
        });
      }
      return result;
    } catch (error) {
      console.error('[PaymentReservation] Expiry sweep failed:', error.message);
      return null;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function startReservationExpiryScheduler(intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
  if (timer) return;
  runReservationExpiryOnce();
  timer = setInterval(runReservationExpiryOnce, intervalMs);
  timer.unref?.();
}

function stopReservationExpiryScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  cursor = null;
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  runReservationExpiryOnce,
  startReservationExpiryScheduler,
  stopReservationExpiryScheduler,
};
