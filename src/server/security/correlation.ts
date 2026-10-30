/**
 * Correlation ID Middleware (GAR-045 §12, GAR-034 §4)
 *
 * Ensures every incoming HTTP request carries a tracing correlation ID
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      actorId?: string;
    }
  }
}

export const CORRELATION_HEADER = 'x-correlation-id';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers[CORRELATION_HEADER] || req.headers['x-request-id'];
  const correlationId = typeof incomingId === 'string' && incomingId.trim() !== ''
    ? incomingId.trim()
    : `req_${crypto.randomUUID()}`;

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);

  next();
}
