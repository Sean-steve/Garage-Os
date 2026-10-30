/**
 * Canonical Time & Timestamp Conventions (GAR-000 §6, GAR-000 §13, GAR-033 §7)
 *
 * Rules:
 * 1. Use UTC timestamps in persistence; presentation converts to local time.
 * 2. Store occurrence time separately from recorded time where offline entry,
 *    device telemetry or imported evidence can arrive late.
 * 3. State changes carry actor/source and correlation context.
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';

/**
 * Returns the current timestamp in ISO 8601 UTC format
 */
export function getCurrentUtcIsoString(): string {
  return new Date().toISOString();
}

/**
 * Normalizes any valid Date/string/number into an unambiguous UTC ISO 8601 string
 */
export function normalizeToUtcIsoString(input: string | number | Date): string {
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid timestamp format provided: ${String(input)}`,
      400
    );
  }
  return date.toISOString();
}

/**
 * Validates whether a timestamp is considered stale given a maximum age in milliseconds
 */
export function isTimestampStale(isoTimestamp: string, maxAgeMs: number): boolean {
  try {
    const time = new Date(isoTimestamp).getTime();
    const now = Date.now();
    return (now - time) > maxAgeMs;
  } catch {
    return true;
  }
}

/**
 * Validates IANA timezone format (e.g., "Africa/Nairobi", "UTC")
 */
export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
