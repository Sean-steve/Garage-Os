import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { healthRegistry } from '../../src/server/observability/health';
import { metrics } from '../../src/server/observability/metrics';

describe('Health Probes & Metrics (GAR-002, GAR-045)', () => {
  it('reports liveness as UP', () => {
    const liveness = healthRegistry.getLiveness();
    assert.equal(liveness.status, 'UP');
    assert.ok(liveness.timestamp);
  });

  it('runs registered readiness checks and computes overall health', async () => {
    healthRegistry.registerCheck('test_dep', () => ({
      status: 'HEALTHY',
      details: { ping: 'ok' },
    }));

    const readiness = await healthRegistry.getReadiness();
    assert.ok(readiness.checks.test_dep);
    assert.equal(readiness.checks.test_dep.status, 'HEALTHY');
  });

  it('calculates metrics snapshot with percentiles and queue depths', () => {
    metrics.recordHttpRequest(200, 15);
    metrics.recordHttpRequest(200, 25);
    metrics.recordHttpRequest(500, 120);

    const snap = metrics.getSnapshot();
    assert.ok(snap.http.total_requests >= 3);
    assert.ok(snap.http.latency.p95_ms > 0);
  });
});
