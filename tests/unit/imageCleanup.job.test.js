const {
  runImageCleanupOnce,
  startImageCleanupScheduler,
  stopImageCleanupScheduler,
} = require('../../src/jobs/imageCleanup.job');
const { runImageReconciliation } = require('../../src/services/imageReconciliation.service');

jest.mock('../../src/services/imageReconciliation.service', () => ({
  runImageReconciliation: jest.fn(),
}));

describe('Image Cleanup Scheduler Job Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stopImageCleanupScheduler();
  });

  afterEach(() => {
    stopImageCleanupScheduler();
    jest.useRealTimers();
  });

  describe('runImageCleanupOnce', () => {
    it('should invoke runImageReconciliation and return results', async () => {
      runImageReconciliation.mockResolvedValue({
        failedCleanups: { attempted: 2, succeeded: 2, failed: 0 },
        abandonedUploads: { attempted: 1, purged: 1, failed: 0 },
      });

      const result = await runImageCleanupOnce();

      expect(runImageReconciliation).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        failedCleanups: { attempted: 2, succeeded: 2, failed: 0 },
        abandonedUploads: { attempted: 1, purged: 1, failed: 0 },
      });
    });

    it('should catch error safely and return null if execution throws', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      runImageReconciliation.mockRejectedValue(new Error('Job error'));

      const result = await runImageCleanupOnce();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Error during image cleanup execution:', 'Job error');
      consoleSpy.mockRestore();
    });
  });

  describe('startImageCleanupScheduler & stopImageCleanupScheduler', () => {
    it('should start timer, run initial check, and execute on interval', async () => {
      runImageReconciliation.mockResolvedValue({
        failedCleanups: { attempted: 0, succeeded: 0, failed: 0 },
        abandonedUploads: { attempted: 0, purged: 0, failed: 0 },
      });

      startImageCleanupScheduler(5000);

      // Initial run on start
      expect(runImageReconciliation).toHaveBeenCalledTimes(1);

      // Advance by 1 interval
      jest.advanceTimersByTime(5000);
      expect(runImageReconciliation).toHaveBeenCalledTimes(2);

      // Advance by another interval
      jest.advanceTimersByTime(5000);
      expect(runImageReconciliation).toHaveBeenCalledTimes(3);
    });

    it('should not create duplicate timers if already started', () => {
      runImageReconciliation.mockResolvedValue(null);

      startImageCleanupScheduler(5000);
      startImageCleanupScheduler(5000);

      expect(runImageReconciliation).toHaveBeenCalledTimes(1);
    });

    it('should stop timer cleanly when stopImageCleanupScheduler is called', () => {
      runImageReconciliation.mockResolvedValue(null);

      startImageCleanupScheduler(5000);
      expect(runImageReconciliation).toHaveBeenCalledTimes(1);

      stopImageCleanupScheduler();

      // Advancing timer should not call reconciliation anymore
      jest.advanceTimersByTime(10000);
      expect(runImageReconciliation).toHaveBeenCalledTimes(1);
    });
  });
});
