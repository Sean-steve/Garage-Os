import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { jobEngine } from '../../src/server/jobs/jobEngine';
import { getDeadLetterCount } from '../../src/server/jobs/deadLetter';

describe('Background Job Engine & Lease Architecture (GAR-036)', () => {
  beforeEach(() => {
    resetDatabaseInstance();
  });

  it('enqueues and executes background jobs with worker leasing', async () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    let executed = false;
    let jobPayload: any = null;

    jobEngine.registerWorker('test.reminder', async (payload) => {
      executed = true;
      jobPayload = payload;
    });

    jobEngine.enqueue('test.reminder', { task: 'Oil Change', dueKm: 60000 });

    const batch = await jobEngine.processAvailableJobs(5);
    assert.equal(batch.processed, 1);
    assert.equal(batch.succeeded, 1);
    assert.equal(executed, true);
    assert.equal(jobPayload.task, 'Oil Change');

    // Status in DB should be SUCCEEDED
    const row = db.prepare("SELECT status FROM job_instances WHERE job_name = 'test.reminder';").get() as { status: string };
    assert.equal(row.status, 'SUCCEEDED');
  });

  it('retries failing jobs and routes to dead-letter queue on max retries', async () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);

    jobEngine.registerWorker('failing.job', async () => {
      throw new Error('Unrecoverable upstream failure');
    });

    // Enqueue with max_retries = 1
    jobEngine.enqueue('failing.job', { attempt: 1 }, { maxRetries: 1 });

    const initialDeadLetters = getDeadLetterCount();

    await jobEngine.processAvailableJobs(5);

    const finalDeadLetters = getDeadLetterCount();
    assert.equal(finalDeadLetters, initialDeadLetters + 1);

    const row = db.prepare("SELECT status, retry_count FROM job_instances WHERE job_name = 'failing.job';").get() as { status: string; retry_count: number };
    assert.equal(row.status, 'DEAD_LETTERED');
    assert.equal(row.retry_count, 1);
  });
});
