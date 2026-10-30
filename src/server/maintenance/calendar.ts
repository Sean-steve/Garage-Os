/**
 * Canonical Calendar Date Arithmetic (GAR-006 §11)
 *
 * Rules:
 * 1. Strictly avoids the simplistic "1 month = 30 days" approximation.
 * 2. Correctly preserves month boundaries and leap year rules.
 * 3. Handles month-end clamping (e.g. Jan 31 + 1 month = Feb 28/29).
 */

export type TimeIntervalUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

/**
 * Returns whether a given year is a leap year
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a specific year and month (1-indexed month: 1=Jan, 12=Dec)
 */
export function getDaysInMonth(year: number, month1Indexed: number): number {
  switch (month1Indexed) {
    case 1: // Jan
    case 3: // Mar
    case 5: // May
    case 7: // Jul
    case 8: // Aug
    case 10: // Oct
    case 12: // Dec
      return 31;
    case 4: // Apr
    case 6: // Jun
    case 9: // Sep
    case 11: // Nov
      return 30;
    case 2: // Feb
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new Error(`Invalid month: ${month1Indexed}`);
  }
}

/**
 * Adds an exact number of calendar days to a Date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Adds an exact number of calendar weeks to a Date
 */
export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/**
 * Adds calendar months with accurate month-end clamping
 * E.g., Jan 31 + 1 month = Feb 28 (or Feb 29 in leap year)
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const day = date.getUTCDate();

  // Calculate target year and month
  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-indexed, handles negative properly

  // Clamp day to max days in target month
  const daysInTargetMonth = getDaysInMonth(targetYear, targetMonth + 1);
  const targetDay = Math.min(day, daysInTargetMonth);

  const result = new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));

  return result;
}

/**
 * Adds calendar years with leap-year clamping
 * E.g., Feb 29, 2024 + 1 year = Feb 28, 2025
 */
export function addYears(date: Date, years: number): Date {
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const daysInMonth = getDaysInMonth(year, month + 1);
  const targetDay = Math.min(day, daysInMonth);

  const result = new Date(Date.UTC(
    year,
    month,
    targetDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));

  return result;
}

/**
 * Adds interval according to specified unit
 */
export function addCalendarInterval(
  startDate: Date | string,
  intervalValue: number,
  intervalUnit: TimeIntervalUnit | string
): Date {
  const base = typeof startDate === 'string' ? new Date(startDate) : new Date(startDate.getTime());
  if (isNaN(base.getTime())) {
    throw new Error(`Invalid start date: ${startDate}`);
  }

  const unit = intervalUnit.toUpperCase();
  switch (unit) {
    case 'DAYS':
      return addDays(base, intervalValue);
    case 'WEEKS':
      return addWeeks(base, intervalValue);
    case 'MONTHS':
      return addMonths(base, intervalValue);
    case 'YEARS':
      return addYears(base, intervalValue);
    default:
      throw new Error(`Unsupported time interval unit: ${intervalUnit}`);
  }
}

/**
 * Calculates calendar days remaining between two dates (can be negative if target is in the past)
 */
export function calculateDaysRemaining(targetDate: Date | string, fromDate: Date | string = new Date()): number {
  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const from = typeof fromDate === 'string' ? new Date(fromDate) : fromDate;

  const diffMs = target.getTime() - from.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
