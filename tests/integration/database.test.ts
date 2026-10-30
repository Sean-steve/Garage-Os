import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations, rollbackLatestMigration } from '../../src/server/database/migrations';
import { withTransaction } from '../../src/server/database/transaction';

describe('Database Architecture & Migration Engine (GAR-033)', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  it('runs canonical migrations deterministically', () => {
    const db = getDatabase({ memory: true });
    const res1 = runMigrations(db);
    assert.ok(res1.applied.length > 0);
    assert.equal(res1.alreadyUpToDate, false);

    // Running again should detect already up to date
    const res2 = runMigrations(db);
    assert.equal(res2.applied.length, 0);
    assert.equal(res2.alreadyUpToDate, true);
  });

  it('enforces ACID atomicity with withTransaction rollback on failure', () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    // Initial count
    const initialCount = (db.prepare('SELECT COUNT(*) as c FROM audit_events;').get() as { c: number }).c;

    assert.throws(() => {
      withTransaction((ctx) => {
        ctx.db.prepare(`
          INSERT INTO audit_events (id, actor_type, action, resource_type, correlation_id, source, created_at)
          VALUES ('audit_fail_01', 'SYSTEM_WORKER', 'TEST_ACTION', 'test', 'corr_1', 'TEST', datetime('now'));
        `).run();

        // Deliberate failure to trigger rollback
        throw new Error('Forced transactional failure');
      }, db);
    });

    // Verify record was NOT committed
    const finalCount = (db.prepare('SELECT COUNT(*) as c FROM audit_events;').get() as { c: number }).c;
    assert.equal(finalCount, initialCount);
  });

  it('supports migration rollback safely', () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    const rollbackResult = rollbackLatestMigration(db);
    assert.ok(rollbackResult.rolledBack.length > 0);
  });
});
