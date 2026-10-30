/**
 * Canonical API Middlewares & Response Formatters (GAR-034 §1-§12B)
 */

import { Request, Response, NextFunction } from 'express';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { ResponseEnvelope, ApiErrorEnvelope, CanonicalActorType } from '../../shared/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { AuthenticatedActorContext, AccountStatus } from '../identity/types';

declare global {
  namespace Express {
    interface Response {
      canonicalSuccess: <T>(data: T, metaOptions?: Partial<ResponseEnvelope['meta']>, warnings?: Array<{ code: string; message: string }>) => Response;
    }
    interface Request {
      actor?: AuthenticatedActorContext;
    }
  }
}

/**
 * Attaches standard canonical response helper to Express Response
 */
export function canonicalEnvelopeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.canonicalSuccess = function <T>(
    data: T,
    metaOptions?: Partial<ResponseEnvelope['meta']>,
    warnings?: Array<{ code: string; message: string }>
  ): Response {
    const duration = Date.now() - startTime;
    metrics.recordHttpRequest(res.statusCode, duration);

    const envelope: ResponseEnvelope<T> = {
      data,
      meta: {
        correlation_id: req.correlationId || `req_${Date.now()}`,
        timestamp: getCurrentUtcIsoString(),
        idempotency_replayed: Boolean(res.getHeader('X-Idempotency-Replayed')),
        ...metaOptions,
      },
      warnings,
    };

    return res.json(envelope);
  };

  next();
}

/**
 * Authentication Hook Placeholder (GAR-003, Full auth in Sprint 2)
 */
export function authContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const actorRoleHeader = req.headers['x-actor-role'] as string;
  const actorIdHeader = req.headers['x-actor-id'] as string;

  if (actorIdHeader && actorRoleHeader) {
    req.actor = {
      id: actorIdHeader,
      user_id: actorIdHeader,
      type: (actorRoleHeader as CanonicalActorType) || CanonicalActorType.VEHICLE_OWNER,
      roles: [actorRoleHeader],
      email: `${actorIdHeader}@garageos.test`,
      account_status: AccountStatus.ACTIVE,
      profile: {
        user_id: actorIdHeader,
        display_name: actorIdHeader,
        preferred_language: 'en',
        timezone: 'UTC',
        country: 'KE',
        created_at: getCurrentUtcIsoString(),
        updated_at: getCurrentUtcIsoString(),
      },
      platform_roles: [],
      memberships: [],
      session_id: `ses_legacy_${actorIdHeader}`,
    };
    req.actorId = actorIdHeader;
  } else if (authHeader) {
    // Basic dev session mock hook for foundation
    req.actor = {
      id: 'usr_foundation_demo',
      user_id: 'usr_foundation_demo',
      type: CanonicalActorType.VEHICLE_OWNER,
      roles: ['VEHICLE_OWNER'],
      email: 'demo@garageos.test',
      account_status: AccountStatus.ACTIVE,
      profile: {
        user_id: 'usr_foundation_demo',
        display_name: 'Demo User',
        preferred_language: 'en',
        timezone: 'UTC',
        country: 'KE',
        created_at: getCurrentUtcIsoString(),
        updated_at: getCurrentUtcIsoString(),
      },
      platform_roles: [],
      memberships: [],
      session_id: 'ses_legacy_demo',
    };
    req.actorId = 'usr_foundation_demo';
  }

  next();
}

/**
 * Canonical Global Error Handler (GAR-000 §7, GAR-034 §4)
 * Sanitizes errors in production, generates machine-readable error codes and requestId.
 */
export function canonicalErrorHandler(
  err: Error | CanonicalAppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const correlationId = req.correlationId || `err_${Date.now()}`;
  const now = getCurrentUtcIsoString();

  let statusCode = 500;
  let code = ErrorCode.INTERNAL_ERROR;
  let message = 'An internal system error occurred.';
  let details: Array<{ field?: string; message: string; code?: string }> | undefined;

  if (err instanceof CanonicalAppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err.name === 'SyntaxError') {
    statusCode = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'Malformed JSON request body.';
  } else {
    // Standard unexpected error
    logger.error(`Unhandled Exception: ${err.message}`, {
      correlation_id: correlationId,
      details: err.stack,
    });
  }

  metrics.recordHttpRequest(statusCode, 0);

  const errorEnvelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      requestId: correlationId,
      details,
      path: req.originalUrl || req.path,
      timestamp: now,
    },
    meta: {
      correlation_id: correlationId,
      timestamp: now,
    },
  };

  res.status(statusCode).json(errorEnvelope);
}
