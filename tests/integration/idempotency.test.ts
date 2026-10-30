import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { idempotencyMiddleware } from '../../src/server/security/idempotency';
import { CanonicalAppError } from '../../src/shared/errors';

describe('API Idempotency Integration (GAR-034 §7, Sprint 1 §38)', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  it('records idempotency and detects payload conflicts on key reuse', () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    const idempotencyKey = 'idem_unique_test_100';

    // Mock request 1
    const req1: any = {
      method: 'POST',
      path: '/api/v1/test/action',
      originalUrl: '/api/v1/test/action',
      headers: { 'idempotency-key': idempotencyKey },
      body: { paymentAmount: 5000 },
    };

    let responseSent: any = null;
    let headersSent: Record<string, string> = {};
    const res1: any = {
      statusCode: 200,
      headersSent: false,
      setHeader: (k: string, v: string) => { headersSent[k.toLowerCase()] = v; },
      getHeader: (k: string) => headersSent[k.toLowerCase()],
      status: (code: number) => { res1.statusCode = code; return res1; },
      json: (data: any) => { responseSent = data; return res1; },
    };

    let nextCalled = false;
    idempotencyMiddleware(req1, res1, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // Call res1.json to complete first request
    res1.json({ data: { success: true, ref: 'TX-123' }, meta: { correlation_id: 'corr_1' } });

    // Mock request 2: same key, same payload -> should intercept and replay
    let replayedBody: any = null;
    const req2: any = {
      method: 'POST',
      path: '/api/v1/test/action',
      originalUrl: '/api/v1/test/action',
      headers: { 'idempotency-key': idempotencyKey },
      body: { paymentAmount: 5000 },
    };
    const res2: any = {
      statusCode: 200,
      headers: {},
      setHeader: (k: string, v: string) => { res2.headers[k.toLowerCase()] = v; },
      status: (code: number) => { res2.statusCode = code; return res2; },
      json: (data: any) => { replayedBody = data; return res2; },
    };

    let nextCalled2 = false;
    idempotencyMiddleware(req2, res2, () => { nextCalled2 = true; });

    // next() should NOT be called on replay
    assert.equal(nextCalled2, false);
    assert.ok(replayedBody);
    assert.equal(replayedBody.meta.idempotency_replayed, true);
    assert.equal(res2.headers['x-idempotency-replayed'], 'true');

    // Mock request 3: same key, DIFFERENT payload -> should return 409 CONFLICT
    const req3: any = {
      method: 'POST',
      path: '/api/v1/test/action',
      originalUrl: '/api/v1/test/action',
      headers: { 'idempotency-key': idempotencyKey },
      body: { paymentAmount: 99999 }, // changed payload!
    };
    const res3: any = {
      setHeader: () => {},
      status: () => res3,
      json: () => res3,
    };

    let conflictError: any = null;
    idempotencyMiddleware(req3, res3, (err?: any) => {
      conflictError = err;
    });

    assert.ok(conflictError instanceof CanonicalAppError);
    assert.equal(conflictError.code, 'CONFLICT');
    assert.equal(conflictError.statusCode, 409);
  });
});
