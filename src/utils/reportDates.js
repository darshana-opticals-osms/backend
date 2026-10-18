const { DATE_PRESETS } = require('../constants/report.constants');

const COLOMBO_OFFSET_HOURS = 5;
const COLOMBO_OFFSET_MINUTES = 30;
const COLOMBO_OFFSET_MS = (COLOMBO_OFFSET_HOURS * 60 + COLOMBO_OFFSET_MINUTES) * 60 * 1000;

/**
 * Validates whether a string is a valid ISO date string formatted as YYYY-MM-DD.
 */
function isValidIsoDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  const [year, month, day] = str.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Returns current calendar components in Asia/Colombo (UTC+05:30).
 */
function getColomboCalendarDate(date = new Date()) {
  const colomboTime = new Date(date.getTime() + COLOMBO_OFFSET_MS);
  const year = colomboTime.getUTCFullYear();
  const month = String(colomboTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(colomboTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shifts a YYYY-MM-DD date string by a number of days in calendar terms.
 */
function shiftCalendarDays(dateStr, dayDelta) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dayDelta));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolves a date preset or custom range into exact UTC boundaries in Asia/Colombo.
 *
 * @param {Object} params
 * @param {string} [params.preset] - 'today' | 'last_7_days' | 'last_30_days' | 'this_month' | 'custom'
 * @param {string} [params.startDate] - YYYY-MM-DD
 * @param {string} [params.endDate] - YYYY-MM-DD
 * @param {Date} [referenceDate] - Current reference date (defaults to new Date())
 * @returns {{ startUtc: Date, endUtc: Date, startDateStr: string, endDateStr: string, preset: string }}
 */
function resolveReportDateRange({ preset, startDate, endDate } = {}, referenceDate = new Date()) {
  const todayColombo = getColomboCalendarDate(referenceDate);

  let activePreset = preset;
  let startStr;
  let endStr;

  if (startDate && endDate) {
    activePreset = DATE_PRESETS.CUSTOM;
    startStr = startDate;
    endStr = endDate;
  } else if (!activePreset) {
    activePreset = DATE_PRESETS.THIS_MONTH;
  }

  switch (activePreset) {
    case DATE_PRESETS.TODAY:
      startStr = todayColombo;
      endStr = todayColombo;
      break;

    case DATE_PRESETS.LAST_7_DAYS:
      startStr = shiftCalendarDays(todayColombo, -6);
      endStr = todayColombo;
      break;

    case DATE_PRESETS.LAST_30_DAYS:
      startStr = shiftCalendarDays(todayColombo, -29);
      endStr = todayColombo;
      break;

    case DATE_PRESETS.THIS_MONTH: {
      const [year, month] = todayColombo.split('-');
      startStr = `${year}-${month}-01`;
      endStr = todayColombo;
      break;
    }

    case DATE_PRESETS.CUSTOM:
      startStr = startDate;
      endStr = endDate;
      break;

    default:
      startStr = shiftCalendarDays(todayColombo, -29);
      endStr = todayColombo;
      activePreset = DATE_PRESETS.LAST_30_DAYS;
      break;
  }

  const startUtc = new Date(`${startStr}T00:00:00.000+05:30`);
  const endUtc = new Date(`${endStr}T23:59:59.999+05:30`);

  return {
    startUtc,
    endUtc,
    startDateStr: startStr,
    endDateStr: endStr,
    preset: activePreset,
  };
}

module.exports = {
  isValidIsoDateString,
  getColomboCalendarDate,
  shiftCalendarDays,
  resolveReportDateRange,
};
