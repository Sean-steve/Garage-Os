import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/server/security/rateLimiter';

describe('Rate Limiter Architecture (GAR-039 §1-§8)', () => {
  it('allows requests within window capacity', () => {
    const limiter = new RateLimiter(10000, 3);
    const client = '192.168.1.100';

    const first = limiter.isAllowed(client);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);

    const second = limiter.isAllowed(client);
    assert.equal(second.allowed, true);
    assert.equal(second.remaining, 1);

    const third = limiter.isAllowed(client);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    // Fourth should be blocked
    const fourth = limiter.isAllowed(client);
    assert.equal(fourth.allowed, false);
    assert.equal(fourth.remaining, 0);
  });
});
