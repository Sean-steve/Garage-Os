/**
 * Dead-Letter Queue Management & Remediation (GAR-036 §4.x, GAR-036 §7)
 *
 * Invariant: Dead-letter jobs are queryable and reprocessable by authorized operators.
 */

import { getDatabase } from '../database/connection';
import { generateCanonicalUuid } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export interface DeadLetterRecord {
  id: string;
  original_job_id: string;
  job_name: string;
  payload: string;
  failure_reason: string;
  retry_count: number;
  correlation_id: string;
  created_at: string;
}

export function recordDeadLetterJob(
  originalJobId: string,
  jobName: string,
  payload: unknown,
  failureReason: string,
  retryCount: number,
  correlationId: string
): string {
  const db = getDatabase();
  const id = generateCanonicalUuid();
  const now = getCurrentUtcIsoString();

  db.prepare(`
    INSERT INTO dead_letter_jobs (
      id, original_job_id, job_name, payload, failure_reason, retry_count, correlation_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `).run(
    id,
    originalJobId,
    jobName,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    failureReason,
    retryCount,
    correlationId,
    now
  );

  logger.error(`Dead-letter recorded for job [${jobName}] ID: ${originalJobId}: ${failureReason}`, {
    correlation_id: correlationId,
    resource_id: id,
    error_code: 'JOB_DEAD_LETTER',
  });

  return id;
}

export function listDeadLetters(limit = 50): DeadLetterRecord[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM dead_letter_jobs ORDER BY created_at DESC LIMIT ?;
  `).all(limit) as unknown as DeadLetterRecord[];
}

export function getDeadLetterCount(): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) as count FROM dead_letter_jobs;').get() as { count: number };
  return row?.count || 0;
}
