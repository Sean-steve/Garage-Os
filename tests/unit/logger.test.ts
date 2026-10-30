import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactPayload } from '../../src/server/observability/logger';

describe('Structured Logger & Redaction (GAR-045, GAR-039 §11)', () => {
  it('redacts sensitive keys like password, token, apikey, secret', () => {
    const raw = {
      username: 'johndoe',
      password: 'supersecretpassword',
      token: 'jwt.token.here',
      nested: {
        apiKey: 'ai-studio-key-12345',
        safeProperty: 'visible',
      },
    };

    const redacted = redactPayload(raw) as any;
    assert.equal(redacted.username, 'johndoe');
    assert.equal(redacted.password, '[REDACTED]');
    assert.equal(redacted.token, '[REDACTED]');
    assert.equal(redacted.nested.apiKey, '[REDACTED]');
    assert.equal(redacted.nested.safeProperty, 'visible');
  });
});
