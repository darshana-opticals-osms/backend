const {
  isValidIsoDateString,
  getColomboCalendarDate,
  shiftCalendarDays,
  resolveReportDateRange,
} = require('../../src/utils/reportDates');

describe('reportDates utility (ADR-014 §7)', () => {
  describe('isValidIsoDateString', () => {
    it('accepts valid YYYY-MM-DD dates', () => {
      expect(isValidIsoDateString('2026-10-18')).toBe(true);
      expect(isValidIsoDateString('2026-02-28')).toBe(true);
    });

    it('rejects invalid or non-existent dates', () => {
      expect(isValidIsoDateString('2026-02-30')).toBe(false);
      expect(isValidIsoDateString('invalid-date')).toBe(false);
      expect(isValidIsoDateString('2026/10/18')).toBe(false);
      expect(isValidIsoDateString('')).toBe(false);
      expect(isValidIsoDateString(null)).toBe(false);
    });
  });

  describe('getColomboCalendarDate and shiftCalendarDays', () => {
    it('computes correct calendar day in Asia/Colombo (UTC+05:30)', () => {
      // 2026-10-17 19:00:00 UTC is 2026-10-18 00:30:00 in Colombo
      const refDate = new Date('2026-10-17T19:00:00.000Z');
      expect(getColomboCalendarDate(refDate)).toBe('2026-10-18');
    });

    it('shifts calendar days accurately', () => {
      expect(shiftCalendarDays('2026-10-18', -1)).toBe('2026-10-17');
      expect(shiftCalendarDays('2026-10-01', -1)).toBe('2026-09-30');
      expect(shiftCalendarDays('2026-10-18', -6)).toBe('2026-10-12');
    });
  });

  describe('resolveReportDateRange', () => {
    const fixedNow = new Date('2026-10-18T05:00:00.000Z'); // 10:30 AM in Colombo on 2026-10-18

    it('resolves "today" preset to start and end of Colombo calendar day', () => {
      const range = resolveReportDateRange({ preset: 'today' }, fixedNow);

      expect(range.startDateStr).toBe('2026-10-18');
      expect(range.endDateStr).toBe('2026-10-18');
      expect(range.startUtc.toISOString()).toBe('2026-10-17T18:30:00.000Z');
      expect(range.endUtc.toISOString()).toBe('2026-10-18T18:29:59.999Z');
    });

    it('resolves "last_7_days" preset', () => {
      const range = resolveReportDateRange({ preset: 'last_7_days' }, fixedNow);

      expect(range.startDateStr).toBe('2026-10-12');
      expect(range.endDateStr).toBe('2026-10-18');
    });

    it('resolves "this_month" preset', () => {
      const range = resolveReportDateRange({ preset: 'this_month' }, fixedNow);

      expect(range.startDateStr).toBe('2026-10-01');
      expect(range.endDateStr).toBe('2026-10-18');
    });

    it('resolves custom date range when startDate and endDate are provided', () => {
      const range = resolveReportDateRange(
        { startDate: '2026-05-01', endDate: '2026-05-31' },
        fixedNow
      );

      expect(range.startDateStr).toBe('2026-05-01');
      expect(range.endDateStr).toBe('2026-05-31');
      expect(range.preset).toBe('custom');
      expect(range.startUtc.toISOString()).toBe('2026-04-30T18:30:00.000Z');
      expect(range.endUtc.toISOString()).toBe('2026-05-31T18:29:59.999Z');
    });
  });
});
