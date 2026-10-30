/**
 * Canonical Transaction & Unit-of-Work Architecture (GAR-002 §6, GAR-033 §5, Sprint 1 §17)
 *
 * Prevents partially committed canonical state:
 * domain mutation + outbox event commit atomically or roll back together.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './connection';
import { logger } from '../observability/logger';

export interface TransactionContext {
  db: DatabaseSync;
  isNested: boolean;
}

/**
 * Execute an atomic unit of work inside a database transaction.
 * Automatically commits on success or rolls back on error.
 */
export function withTransaction<T>(
  callback: (ctx: TransactionContext) => T,
  customDb?: DatabaseSync
): T {
  const db = customDb || getDatabase();

  // SQLite transactions cannot be nested directly; check if already in transaction
  // using SAVEPOINT for safe nested transactions
  const savepointId = `sp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    db.exec(`SAVEPOINT ${savepointId};`);
    const result = callback({ db, isNested: true });
    db.exec(`RELEASE SAVEPOINT ${savepointId};`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepointId};`);
    logger.error('Transaction rolled back due to error', {
      details: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
