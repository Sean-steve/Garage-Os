/**
 * Canonical API Middlewares & Response Formatters (GAR-034 §1-§12B)
 */

import { Request, Response, NextFunction } from 'express';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { ResponseEnvelope, ApiErrorEnvelope } from '../../shared/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { AuthenticatedActorContext } from '../identity/types';

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
 * Legacy authentication hook retained as a no-op for middleware compatibility.
 *
 * Authentication is performed only by the canonical authenticate() middleware
 * on protected routes. In particular, X-Actor-* headers and arbitrary
 * Authorization header presence never create an authenticated actor.
 */
export function authContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
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
