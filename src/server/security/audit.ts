/**
 * Immutable Audit Log Architecture (GAR-039 §11, GAR-000 §9, GAR-000 §14)
 *
 * Audit Law: Privileged, financial, safety, trust and material history changes are auditable.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { generateCanonicalUuid } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { CanonicalActorType } from '../../shared/types';

export interface AuditLogEntry {
  actor_id?: string;
  actor_type?: CanonicalActorType | string;
  action: string;
  resource_type: string;
  resource_id?: string;
  correlation_id: string;
  source: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string;
  source: string;
  before_state: string | null;
  after_state: string | null;
  metadata: string | null;
  created_at: string;
}

export function recordAuditEvent(entry: AuditLogEntry, customDb?: DatabaseSync): string {
  const db = customDb || getDatabase();
  const id = generateCanonicalUuid();
  const now = getCurrentUtcIsoString();

  db.prepare(`
    INSERT INTO audit_events (
      id, actor_id, actor_type, action, resource_type, resource_id,
      correlation_id, source, before_state, after_state, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `).run(
    id,
    entry.actor_id || null,
    entry.actor_type || CanonicalActorType.SYSTEM_WORKER,
    entry.action,
    entry.resource_type,
    entry.resource_id || null,
    entry.correlation_id,
    entry.source,
    entry.before_state ? JSON.stringify(entry.before_state) : null,
    entry.after_state ? JSON.stringify(entry.after_state) : null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    now
  );

  logger.info(`Audit logged: [${entry.action}] on ${entry.resource_type}:${entry.resource_id || 'general'}`, {
    correlation_id: entry.correlation_id,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
  });

  return id;
}

export function listAuditEvents(limit = 50, offset = 0, resourceType?: string): { items: AuditRow[]; total: number } {
  const db = getDatabase();

  let query = 'SELECT * FROM audit_events';
  let countQuery = 'SELECT COUNT(*) as total FROM audit_events';
  const params: (string | number)[] = [];

  if (resourceType) {
    query += ' WHERE resource_type = ?';
    countQuery += ' WHERE resource_type = ?';
    params.push(resourceType);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?;';

  const countRow = db.prepare(countQuery).get(...(resourceType ? [resourceType] : [])) as { total: number };
  const items = db.prepare(query).all(...params, limit, offset) as unknown as AuditRow[];

  return {
    items,
    total: countRow?.total || 0,
  };
}
