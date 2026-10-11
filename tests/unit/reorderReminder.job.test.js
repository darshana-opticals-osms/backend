const {
  runReminderCheckOnce,
  startReminderScheduler,
  stopReminderScheduler,
} = require('../../src/jobs/reorderReminder.job');
const { processPeriodicReminders } = require('../../src/services/reorderAlert.service');

jest.mock('../../src/services/reorderAlert.service', () => ({
  processPeriodicReminders: jest.fn(),
}));

describe('Reorder Reminder Scheduler Job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stopReminderScheduler();
  });

  afterEach(() => {
    stopReminderScheduler();
    jest.useRealTimers();
  });

  describe('runReminderCheckOnce', () => {
    it('should invoke processPeriodicReminders and return result', async () => {
      processPeriodicReminders.mockResolvedValue({ remindersSent: 2, withinWorkingHours: true });

      const result = await runReminderCheckOnce();

      expect(processPeriodicReminders).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ remindersSent: 2, withinWorkingHours: true });
    });

    it('should catch error safely and return null if processPeriodicReminders fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      processPeriodicReminders.mockRejectedValue(new Error('DB failure'));

      const result = await runReminderCheckOnce();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error during periodic reorder reminder execution:',
        'DB failure'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('startReminderScheduler & stopReminderScheduler', () => {
    it('should start timer, run initial check, and execute on interval', async () => {
      processPeriodicReminders.mockResolvedValue({ remindersSent: 0, withinWorkingHours: true });

      startReminderScheduler(1000);

      // Initial check on start
      expect(processPeriodicReminders).toHaveBeenCalledTimes(1);

      // Fast forward 1 interval
      jest.advanceTimersByTime(1000);
      expect(processPeriodicReminders).toHaveBeenCalledTimes(2);

      // Fast forward another interval
      jest.advanceTimersByTime(1000);
      expect(processPeriodicReminders).toHaveBeenCalledTimes(3);

      stopReminderScheduler();

      // Ensure no further calls after stop
      jest.advanceTimersByTime(2000);
      expect(processPeriodicReminders).toHaveBeenCalledTimes(3);
    });

    it('should not start multiple timers if called repeatedly', () => {
      startReminderScheduler(1000);
      startReminderScheduler(1000);

      expect(processPeriodicReminders).toHaveBeenCalledTimes(1);

      stopReminderScheduler();
    });
  });
});
