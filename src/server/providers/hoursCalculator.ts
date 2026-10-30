/**
 * Operating Hours and State Calculator (GAR-011 §12)
 *
 * Provides:
 * - Deterministic evaluation of OPEN vs CLOSED state
 * - Support for multiple shift windows per day
 * - Support for date-specific exceptions and holiday overrides
 * - Timezone-aware local clock conversion
 */

import {
  OperatingState,
  ProviderOperatingHoursEntity,
  ProviderScheduleExceptionEntity,
} from './types';

export interface OperatingStateEvaluation {
  state: OperatingState;
  reason: string;
  nextChangeTime?: string | null;
}

/**
 * Parses "HH:MM" into total minutes from midnight
 */
export function timeStringToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  return hours * 60 + minutes;
}

/**
 * Gets the current or target date breakdown in a specified IANA timezone
 */
export function getZonedTimeDetails(
  date: Date = new Date(),
  timezone: string = 'Africa/Nairobi'
): {
  dateString: string; // YYYY-MM-DD
  dayOfWeek: number;   // 0=Sun, 1=Mon, ..., 6=Sat
  minutesOfDay: number;
} {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    let year = '';
    let month = '';
    let day = '';
    let hour = 0;
    let minute = 0;
    let weekdayStr = '';

    for (const p of parts) {
      if (p.type === 'year') year = p.value;
      if (p.type === 'month') month = p.value;
      if (p.type === 'day') day = p.value;
      if (p.type === 'hour') hour = parseInt(p.value, 10);
      if (p.type === 'minute') minute = parseInt(p.value, 10);
      if (p.type === 'weekday') weekdayStr = p.value;
    }

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = weekdayMap[weekdayStr] ?? date.getUTCDay();
    const dateString = `${year}-${month}-${day}`;
    const minutesOfDay = hour * 60 + minute;

    return { dateString, dayOfWeek, minutesOfDay };
  } catch {
    // Fallback if invalid timezone
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    const dayOfWeek = date.getUTCDay();
    const minutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
    return { dateString, dayOfWeek, minutesOfDay };
  }
}

/**
 * Computes operating state for a provider or branch at a specific instant
 */
export function computeOperatingState(
  operatingHours: ProviderOperatingHoursEntity[],
  exceptions: ProviderScheduleExceptionEntity[] = [],
  timezone: string = 'Africa/Nairobi',
  targetDate: Date = new Date()
): OperatingStateEvaluation {
  if (!operatingHours || operatingHours.length === 0) {
    return {
      state: OperatingState.UNKNOWN,
      reason: 'No operating schedule configured',
    };
  }

  const { dateString, dayOfWeek, minutesOfDay } = getZonedTimeDetails(targetDate, timezone);

  // 1. Check for specific date exception (holiday or special schedule override)
  const exception = exceptions.find((ex) => ex.exception_date === dateString);
  if (exception) {
    if (exception.is_closed) {
      return {
        state: OperatingState.CLOSED,
        reason: `Closed for schedule exception: ${exception.reason || 'Special holiday'}`,
      };
    }

    // Special hours on exception date
    if (exception.opens_at && exception.closes_at) {
      const openMin = timeStringToMinutes(exception.opens_at);
      const closeMin = timeStringToMinutes(exception.closes_at);

      if (minutesOfDay >= openMin && minutesOfDay < closeMin) {
        return {
          state: OperatingState.OPEN,
          reason: `Open (special hours: ${exception.opens_at} - ${exception.closes_at})`,
          nextChangeTime: exception.closes_at,
        };
      } else {
        return {
          state: OperatingState.CLOSED,
          reason: `Closed (special hours: ${exception.opens_at} - ${exception.closes_at})`,
          nextChangeTime: minutesOfDay < openMin ? exception.opens_at : undefined,
        };
      }
    }
  }

  // 2. Check weekly operating hours for current day of week
  const daySchedules = operatingHours.filter(
    (h) => h.day_of_week === dayOfWeek && !h.is_closed
  );

  if (daySchedules.length === 0) {
    return {
      state: OperatingState.CLOSED,
      reason: 'Closed on this day of week',
    };
  }

  // Check if current time falls within any open window
  for (const window of daySchedules) {
    const openMin = timeStringToMinutes(window.opens_at);
    const closeMin = timeStringToMinutes(window.closes_at);

    if (minutesOfDay >= openMin && minutesOfDay < closeMin) {
      return {
        state: OperatingState.OPEN,
        reason: `Open today from ${window.opens_at} to ${window.closes_at}`,
        nextChangeTime: window.closes_at,
      };
    }
  }

  // If before first window today, report next open time
  const sortedWindows = [...daySchedules].sort(
    (a, b) => timeStringToMinutes(a.opens_at) - timeStringToMinutes(b.opens_at)
  );

  const upcomingWindow = sortedWindows.find(
    (w) => timeStringToMinutes(w.opens_at) > minutesOfDay
  );

  if (upcomingWindow) {
    return {
      state: OperatingState.CLOSED,
      reason: `Closed, opens today at ${upcomingWindow.opens_at}`,
      nextChangeTime: upcomingWindow.opens_at,
    };
  }

  return {
    state: OperatingState.CLOSED,
    reason: 'Closed for the day',
  };
}
