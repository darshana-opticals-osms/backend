jest.mock('../../src/services/orderReservation.service', () => ({
  sweepExpiredReservations: jest.fn(),
}));
const { sweepExpiredReservations } = require('../../src/services/orderReservation.service');
const {
  runReservationExpiryOnce,
  startReservationExpiryScheduler,
  stopReservationExpiryScheduler,
} = require('../../src/jobs/paymentReservation.job');

describe('Reservation expiry scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stopReservationExpiryScheduler();
    sweepExpiredReservations.mockResolvedValue({
      cancelled: 0,
      held: [],
      failed: [],
      nextCursor: null,
    });
  });
  afterEach(() => {
    stopReservationExpiryScheduler();
    jest.useRealTimers();
  });
  it('starts once, checks immediately, repeats and stops', async () => {
    startReservationExpiryScheduler(1000);
    startReservationExpiryScheduler(1000);
    await runReservationExpiryOnce();
    expect(sweepExpiredReservations).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(sweepExpiredReservations).toHaveBeenCalledTimes(2);
    stopReservationExpiryScheduler();
    await jest.advanceTimersByTimeAsync(1000);
    expect(sweepExpiredReservations).toHaveBeenCalledTimes(2);
  });
  it('shares an in-flight sweep rather than overlapping locally', async () => {
    let resolve;
    sweepExpiredReservations.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const first = runReservationExpiryOnce();
    const second = runReservationExpiryOnce();
    expect(second).toBe(first);
    resolve({ held: [], failed: [], nextCursor: null });
    await first;
    expect(sweepExpiredReservations).toHaveBeenCalledTimes(1);
  });
  it('uses the page cursor to progress past held reservations and reports safe identifiers', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    sweepExpiredReservations.mockResolvedValueOnce({
      held: [{ orderId: 'order-id', reason: 'PAYMENT_OUTCOME_UNCERTAIN' }],
      failed: [],
      nextCursor: 'cursor',
    });
    try {
      await runReservationExpiryOnce();
      await runReservationExpiryOnce();
      expect(sweepExpiredReservations).toHaveBeenLastCalledWith({ afterId: 'cursor' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('requires attention'),
        expect.objectContaining({
          held: [{ orderId: 'order-id', reason: 'PAYMENT_OUTCOME_UNCERTAIN' }],
        })
      );
    } finally {
      warn.mockRestore();
    }
  });
  it('reports database failure and permits the next scheduled retry', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    sweepExpiredReservations.mockRejectedValueOnce(new Error('DB unavailable'));
    try {
      expect(await runReservationExpiryOnce()).toBeNull();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('sweep failed'), 'DB unavailable');
      expect(await runReservationExpiryOnce()).not.toBeNull();
    } finally {
      error.mockRestore();
    }
  });
});
