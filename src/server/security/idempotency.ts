/**
 * API Idempotency Framework (GAR-034 §7, GAR-000 §12, Sprint 1 §38)
 *
 * Rules:
 * 1. Idempotency keys are scoped to actor + operation + defined retention window.
 * 2. Replay returns the original outcome where safe.
 * 3. Payload hash mismatch with same key returns CONFLICT.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../database/connection';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotencyRow {
  idempotency_key: string;
  actor_id: string | null;
  endpoint: string;
  request_hash: string;
  status_code: number;
  response_body: string;
  resource_version: number | null;
  created_at: string;
  expires_at: string;
}

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to mutating requests
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const key = req.headers[IDEMPOTENCY_HEADER];
  if (!key || typeof key !== 'string' || key.trim() === '') {
    // If not supplied, continue normally (endpoints requiring mandatory idempotency will check)
    return next();
  }

  const idempotencyKey = key.trim();
  const db = getDatabase();
  const now = getCurrentUtcIsoString();

  // Compute request body hash
  const bodyContent = req.body ? JSON.stringify(req.body) : '';
  const requestHash = crypto.createHash('sha256').update(`${req.method}:${req.path}:${bodyContent}`).digest('hex');

  // Check existing record
  const existing = db.prepare(`
    SELECT * FROM idempotency_records WHERE idempotency_key = ? AND expires_at > ?;
  `).get(idempotencyKey, now) as unknown as IdempotencyRow | undefined;

  if (existing) {
    // Conflict check: Has the payload changed?
    if (existing.request_hash !== requestHash) {
      logger.warn(`Idempotency key reused with mismatched request payload: ${idempotencyKey}`);
      return next(
        new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Idempotency key '${idempotencyKey}' was previously used with a different request payload.`,
          409
        )
      );
    }

    logger.info(`Replaying cached idempotent response for key: ${idempotencyKey}`);
    res.setHeader('X-Idempotency-Replayed', 'true');
    res.status(existing.status_code);

    try {
      const parsedBody = JSON.parse(existing.response_body);
      if (parsedBody && typeof parsedBody === 'object' && parsedBody.meta) {
        parsedBody.meta.idempotency_replayed = true;
      }
      res.json(parsedBody);
      return;
    } catch {
      res.send(existing.response_body);
      return;
    }
  }

  // Intercept response to store for future replay
  const originalJson = res.json.bind(res);
  res.json = (body: any): Response => {
    try {
      // Only cache successful or validated business responses (status < 500)
      if (res.statusCode < 500) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.prepare(`
          INSERT INTO idempotency_records (
            idempotency_key, actor_id, endpoint, request_hash, status_code,
            response_body, resource_version, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO UPDATE SET
            status_code = excluded.status_code,
            response_body = excluded.response_body,
            expires_at = excluded.expires_at;
        `).run(
          idempotencyKey,
          req.actorId || null,
          req.originalUrl || req.path,
          requestHash,
          res.statusCode,
          JSON.stringify(body),
          body?.meta?.resource_version || 1,
          now,
          expiresAt
        );
      }
    } catch (err) {
      logger.error(`Failed to record idempotency cache: ${err instanceof Error ? err.message : String(err)}`);
    }

    return originalJson(body);
  };

  next();
}
