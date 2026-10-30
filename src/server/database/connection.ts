/**
 * Canonical Persistence Connection & Pooling Abstraction (GAR-033 §1-§5)
 *
 * Implements:
 * - Synchronous ACID transactions using Node 22 native SQLite engine
 * - WAL mode and enforced Foreign Keys
 * - Multi-environment support (in-memory test isolation, persistent file-based production)
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env';
import { logger } from '../observability/logger';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export interface DatabaseOptions {
  memory?: boolean;
  filePath?: string;
  enforceForeignKeys?: boolean;
}

/**
 * Initialize or retrieve the canonical database connection
 */
export function getDatabase(options?: DatabaseOptions): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const isTest = config.APP_ENV === 'test';
  const useMemory = options?.memory ?? (isTest && !options?.filePath);

  let targetPath = ':memory:';
  if (!useMemory) {
    const rawPath = options?.filePath || config.DATABASE_URL.replace(/^file:/, '');
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    targetPath = resolvedPath;
  }

  currentDbPath = targetPath;
  logger.info(`Initializing canonical database connection: ${targetPath}`);

  dbInstance = new DatabaseSync(targetPath);

  // Enforce WAL mode and foreign key constraints
  if (targetPath !== ':memory:') {
    dbInstance.exec('PRAGMA journal_mode = WAL;');
  }
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');

  return dbInstance;
}

/**
 * Reset database instance (useful for clean isolated test runs)
 */
export function resetDatabaseInstance(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * Explicitly inject in-memory database for isolated test execution
 */
export function setDatabaseForTesting(customDb: DatabaseSync | null): void {
  dbInstance = customDb;
  currentDbPath = customDb ? ':memory:' : null;
}

/**
 * Check if the database connection is currently active and healthy
 */
export function checkDatabaseHealth(): { status: 'HEALTHY' | 'DOWN'; latency_ms: number; path: string } {
  const start = Date.now();
  try {
    const db = getDatabase();
    db.prepare('SELECT 1 as alive;').get();
    return {
      status: 'HEALTHY',
      latency_ms: Date.now() - start,
      path: currentDbPath || ':memory:',
    };
  } catch {
    return {
      status: 'DOWN',
      latency_ms: Date.now() - start,
      path: currentDbPath || ':unknown:',
    };
  }
}
