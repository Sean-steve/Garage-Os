/**
 * Transactional Outbox Pattern & Worker Engine (GAR-035 §1-§10, GAR-002 §6)
 *
 * Guarantees that business state changes and emitted domain events
 * are committed together atomically.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { eventBus } from './eventBus';
import { EventEnvelope } from '../../shared/types';
import { logger } from '../observability/logger';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalUuid } from '../domain/id';

export interface OutboxRow {
  id: string;
  event_id: string;
  type: string;
  version: number;
  occurred_at: string;
  recorded_at: string;
  producer: string;
  correlation_id: string;
  causation_id?: string;
  subject_ids: string;
  actor_id?: string;
  actor_type?: string;
  provenance_class: string;
  payload: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'DEAD_LETTERED';
  retry_count: number;
  last_error?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Enqueues a canonical event into the outbox table.
 * Must be called within the same database transaction as the domain state change.
 */
export function enqueueOutboxEvent(event: EventEnvelope, customDb?: DatabaseSync): string {
  const db = customDb || getDatabase();
  const id = generateCanonicalUuid();
  const now = getCurrentUtcIsoString();

  const stmt = db.prepare(`
    INSERT INTO outbox_events (
      id, event_id, type, version, occurred_at, recorded_at, producer,
      correlation_id, causation_id, subject_ids, actor_id, actor_type,
      provenance_class, payload, status, retry_count, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 'PENDING', 0, ?, ?
    );
  `);

  stmt.run(
    id,
    event.event_id,
    event.type,
    event.version,
    event.occurred_at,
    event.recorded_at,
    event.producer,
    event.correlation_id,
    event.causation_id || null,
    JSON.stringify(event.subject_ids),
    event.actor_id || null,
    event.actor_type || null,
    event.provenance_class,
    JSON.stringify(event.payload),
    now,
    now
  );

  logger.debug(`Enqueued outbox event: ${event.type} (${event.event_id})`, {
    correlation_id: event.correlation_id,
    resource_id: event.event_id,
  });

  return id;
}

export class OutboxWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;
  private maxRetries = 5;

  constructor(pollIntervalMs = 2000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Starting Transactional Outbox Worker');
    this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Stopped Transactional Outbox Worker');
  }

  private poll(): void {
    if (!this.isRunning) return;

    this.processBatch()
      .catch((err) => {
        logger.error(`Outbox worker error during cycle: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (this.isRunning) {
          this.timer = setTimeout(() => this.poll(), this.pollIntervalMs);
        }
      });
  }

  async processBatch(limit = 25): Promise<{ processed: number; succeeded: number; failed: number }> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM outbox_events
      WHERE status IN ('PENDING', 'FAILED') AND retry_count < ?
      ORDER BY created_at ASC
      LIMIT ?;
    `).all(this.maxRetries, limit) as unknown as OutboxRow[];

    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      const envelope: EventEnvelope = {
        event_id: row.event_id,
        type: row.type,
        version: row.version,
        occurred_at: row.occurred_at,
        recorded_at: row.recorded_at,
        producer: row.producer,
        correlation_id: row.correlation_id,
        causation_id: row.causation_id,
        subject_ids: JSON.parse(row.subject_ids),
        actor_id: row.actor_id,
        actor_type: row.actor_type as any,
        provenance_class: row.provenance_class as any,
        payload: JSON.parse(row.payload),
      };

      try {
        const res = await eventBus.publish(envelope);
        if (res.failed > 0) {
          throw new Error(`${res.failed} handler(s) failed`);
        }

        const now = getCurrentUtcIsoString();
        db.prepare(`
          UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = ?, updated_at = ?
          WHERE id = ?;
        `).run(now, now, row.id);

        succeeded++;
      } catch (err) {
        failed++;
        const nextRetry = row.retry_count + 1;
        const now = getCurrentUtcIsoString();
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (nextRetry >= this.maxRetries) {
          db.prepare(`
            UPDATE outbox_events
            SET status = 'DEAD_LETTERED', retry_count = ?, last_error = ?, updated_at = ?
            WHERE id = ?;
          `).run(nextRetry, errorMessage, now, row.id);

          logger.error(`Outbox event dead-lettered after ${nextRetry} retries: ${row.event_id}`, {
            correlation_id: row.correlation_id,
            error_code: 'OUTBOX_DEAD_LETTER',
          });
        } else {
          db.prepare(`
            UPDATE outbox_events
            SET status = 'FAILED', retry_count = ?, last_error = ?, updated_at = ?
            WHERE id = ?;
          `).run(nextRetry, errorMessage, now, row.id);
        }
      }
    }

    return { processed: rows.length, succeeded, failed };
  }

  getPendingCount(): number {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM outbox_events WHERE status IN ('PENDING', 'FAILED');").get() as { count: number };
    return row?.count || 0;
  }
}

export const outboxWorker = new OutboxWorker();
