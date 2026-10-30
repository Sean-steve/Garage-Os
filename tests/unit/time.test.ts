import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentUtcIsoString,
  normalizeToUtcIsoString,
  isTimestampStale,
  isValidIanaTimezone,
} from '../../src/server/domain/time';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Canonical Time Handling (GAR-000 §6, GAR-000 §13)', () => {
  it('returns valid UTC ISO 8601 strings', () => {
    const now = getCurrentUtcIsoString();
    assert.ok(now.endsWith('Z'));
    assert.ok(!isNaN(new Date(now).getTime()));
  });

  it('normalizes various date inputs into UTC ISO format', () => {
    const date = new Date('2026-05-10T14:30:00Z');
    assert.equal(normalizeToUtcIsoString(date), '2026-05-10T14:30:00.000Z');
    assert.equal(normalizeToUtcIsoString(date.getTime()), '2026-05-10T14:30:00.000Z');
  });

  it('throws on invalid date input', () => {
    assert.throws(
      () => normalizeToUtcIsoString('not-a-date'),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  it('correctly assesses timestamp staleness for location & telemetry', () => {
    const recent = new Date(Date.now() - 5000).toISOString();
    assert.equal(isTimestampStale(recent, 30000), false);

    const stale = new Date(Date.now() - 60000).toISOString();
    assert.equal(isTimestampStale(stale, 30000), true);
  });

  it('validates IANA timezones', () => {
    assert.equal(isValidIanaTimezone('Africa/Nairobi'), true);
    assert.equal(isValidIanaTimezone('UTC'), true);
    assert.equal(isValidIanaTimezone('Invalid/Zone_Name'), false);
  });
});
