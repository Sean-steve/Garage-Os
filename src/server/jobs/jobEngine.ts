/**
 * Canonical Background Jobs, Leases & Worker Engine (GAR-036 §1-§10)
 *
 * Rules:
 * 1. Jobs are idempotent or protect side effects with deduplication keys.
 * 2. Long workflows persist state; process memory is not the source of truth.
 * 3. Retries use bounded exponential backoff with domain-specific expiry.
 * 4. Dead-letter jobs are queryable and reprocessable.
 */

import { getDatabase } from '../database/connection';
import { generateCanonicalUuid } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { recordDeadLetterJob } from './deadLetter';

export type JobHandler<TPayload = any> = (payload: TPayload, correlationId: string) => Promise<void>;

export interface EnqueueJobOptions {
  runAt?: Date | string;
  maxRetries?: number;
  correlationId?: string;
}

export interface JobInstanceRow {
  id: string;
  job_name: string;
  payload: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'RETRY_WAIT' | 'DEAD_LETTERED';
  retry_count: number;
  max_retries: number;
  run_at: string;
  lease_id?: string | null;
  lease_expires_at?: string | null;
  last_error?: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

class JobEngine {
  private handlers: Map<string, JobHandler> = new Map();
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs = 2500;
  private leaseDurationSeconds = 60;

  /**
   * Register a job worker handler
   */
  registerWorker<TPayload = any>(jobName: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(jobName, handler);
    logger.info(`Registered background job worker for [${jobName}]`);
  }

  /**
   * Enqueue a job for immediate or future execution
   */
  enqueue<TPayload = unknown>(jobName: string, payload: TPayload, options?: EnqueueJobOptions): string {
    const db = getDatabase();
    const id = generateCanonicalUuid();
    const now = getCurrentUtcIsoString();
    const runAt = options?.runAt ? new Date(options.runAt).toISOString() : now;
    const maxRetries = options?.maxRetries ?? 5;
    const correlationId = options?.correlationId || generateCanonicalUuid();

    db.prepare(`
      INSERT INTO job_instances (
        id, job_name, payload, status, retry_count, max_retries,
        run_at, correlation_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'QUEUED', 0, ?, ?, ?, ?, ?);
    `).run(
      id,
      jobName,
      JSON.stringify(payload),
      maxRetries,
      runAt,
      correlationId,
      now,
      now
    );

    logger.debug(`Enqueued job [${jobName}] with ID ${id}`, {
      correlation_id: correlationId,
      resource_id: id,
    });

    return id;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Starting Background Job Engine');
    this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Stopped Background Job Engine');
  }

  private poll(): void {
    if (!this.isRunning) return;

    this.processAvailableJobs()
      .catch((err) => {
        logger.error(`Job engine cycle error: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (this.isRunning) {
          this.timer = setTimeout(() => this.poll(), this.pollIntervalMs);
        }
      });
  }

  /**
   * Process runnable jobs using lease reservation
   */
  async processAvailableJobs(limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();
    const leaseId = generateCanonicalUuid();
    const leaseExpiresAt = new Date(Date.now() + this.leaseDurationSeconds * 1000).toISOString();

    // Acquire lease on ready jobs (status QUEUED or RETRY_WAIT, run_at <= now, or expired lease)
    db.prepare(`
      UPDATE job_instances
      SET status = 'RUNNING', lease_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id IN (
        SELECT id FROM job_instances
        WHERE (status IN ('QUEUED', 'RETRY_WAIT') AND run_at <= ?)
           OR (status = 'RUNNING' AND lease_expires_at < ?)
        ORDER BY run_at ASC
        LIMIT ?
      );
    `).run(leaseId, leaseExpiresAt, now, now, now, limit);

    // Fetch the jobs acquired with this lease
    const jobs = db.prepare(`
      SELECT * FROM job_instances WHERE lease_id = ? AND status = 'RUNNING';
    `).all(leaseId) as unknown as JobInstanceRow[];

    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      const handler = this.handlers.get(job.job_name);
      const startTime = Date.now();

      if (!handler) {
        logger.warn(`No handler registered for job [${job.job_name}], releasing lease`, {
          correlation_id: job.correlation_id,
          resource_id: job.id,
        });
        db.prepare(`
          UPDATE job_instances
          SET status = 'QUEUED', lease_id = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ?;
        `).run(getCurrentUtcIsoString(), job.id);
        continue;
      }

      try {
        const payload = JSON.parse(job.payload);
        await handler(payload, job.correlation_id);

        const doneTime = getCurrentUtcIsoString();
        db.prepare(`
          UPDATE job_instances
          SET status = 'SUCCEEDED', lease_id = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ?;
        `).run(doneTime, job.id);

        succeeded++;
        logger.info(`Job [${job.job_name}] completed successfully in ${Date.now() - startTime}ms`, {
          correlation_id: job.correlation_id,
          resource_id: job.id,
        });
      } catch (err) {
        failed++;
        const nextRetry = job.retry_count + 1;
        const errorMessage = err instanceof Error ? err.message : String(err);
        const updateTime = getCurrentUtcIsoString();

        if (nextRetry >= job.max_retries) {
          // Send to Dead Letter Queue
          recordDeadLetterJob(
            job.id,
            job.job_name,
            job.payload,
            errorMessage,
            nextRetry,
            job.correlation_id
          );

          db.prepare(`
            UPDATE job_instances
            SET status = 'DEAD_LETTERED', retry_count = ?, last_error = ?, lease_id = NULL, lease_expires_at = NULL, updated_at = ?
            WHERE id = ?;
          `).run(nextRetry, errorMessage, updateTime, job.id);
        } else {
          // Bounded exponential backoff: 2s * (2 ^ retry_count), max 1 hour
          const backoffDelayMs = Math.min(2000 * Math.pow(2, nextRetry), 3600000);
          const nextRunAt = new Date(Date.now() + backoffDelayMs).toISOString();

          db.prepare(`
            UPDATE job_instances
            SET status = 'RETRY_WAIT', retry_count = ?, run_at = ?, last_error = ?, lease_id = NULL, lease_expires_at = NULL, updated_at = ?
            WHERE id = ?;
          `).run(nextRetry, nextRunAt, errorMessage, updateTime, job.id);

          logger.warn(`Job [${job.job_name}] failed, scheduled retry #${nextRetry} in ${backoffDelayMs / 1000}s`, {
            correlation_id: job.correlation_id,
            resource_id: job.id,
            details: errorMessage,
          });
        }
      }
    }

    return { processed: jobs.length, succeeded, failed };
  }

  getQueueDepth(): { queued: number; running: number; failed: number } {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count FROM job_instances GROUP BY status;
    `).all() as Array<{ status: string; count: number }>;

    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.status] = r.count;
    }

    return {
      queued: (map['QUEUED'] || 0) + (map['RETRY_WAIT'] || 0),
      running: map['RUNNING'] || 0,
      failed: map['FAILED'] || 0,
    };
  }
}

export const jobEngine = new JobEngine();
