import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseEnvelope, ApiErrorEnvelope } from '../../src/shared/types';
import { ErrorCode } from '../../src/shared/errors';

describe('Canonical API Contract Specification (GAR-034)', () => {
  it('enforces ResponseEnvelope structure with metadata and correlation_id', () => {
    const envelope: ResponseEnvelope<{ status: string }> = {
      data: { status: 'healthy' },
      meta: {
        correlation_id: 'req_12345',
        timestamp: '2026-09-06T10:00:00.000Z',
        idempotency_replayed: false,
        resource_version: 1,
      },
    };

    assert.ok(envelope.data);
    assert.equal(envelope.data.status, 'healthy');
    assert.equal(envelope.meta.correlation_id, 'req_12345');
    assert.equal(envelope.meta.idempotency_replayed, false);
    assert.equal(envelope.meta.resource_version, 1);
  });

  it('enforces ApiErrorEnvelope structure and machine-readable error codes', () => {
    const errorEnvelope: ApiErrorEnvelope = {
      error: {
        code: ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        message: 'Resource not found',
        requestId: 'req_err_999',
        timestamp: '2026-09-06T10:00:00.000Z',
      },
      meta: {
        correlation_id: 'req_err_999',
        timestamp: '2026-09-06T10:00:00.000Z',
      },
    };

    assert.equal(errorEnvelope.error.code, 'NOT_FOUND_OR_NOT_ACCESSIBLE');
    assert.equal(errorEnvelope.error.requestId, errorEnvelope.meta.correlation_id);
  });
});
