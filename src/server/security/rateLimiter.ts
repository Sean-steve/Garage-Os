/**
 * API Rate Limiting Middleware (GAR-039 §1-§8, GAR-034 §4)
 *
 * Enforces request throughput caps per IP/actor with standard HTTP headers.
 */

import { Request, Response, NextFunction } from 'express';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { config } from '../config/env';

interface ClientWindow {
  tokens: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, ClientWindow>();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs = config.RATE_LIMIT_WINDOW_MS, maxRequests = config.RATE_LIMIT_MAX_REQUESTS) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Periodic sweep of expired windows
    setInterval(() => this.cleanup(), Math.max(windowMs, 30000)).unref();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows.entries()) {
      if (now > window.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  isAllowed(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window || now > window.resetAt) {
      window = {
        tokens: this.maxRequests - 1,
        resetAt: now + this.windowMs,
      };
      this.windows.set(key, window);
      return { allowed: true, remaining: window.tokens, resetAt: window.resetAt };
    }

    if (window.tokens > 0) {
      window.tokens--;
      return { allowed: true, remaining: window.tokens, resetAt: window.resetAt };
    }

    return { allowed: false, remaining: 0, resetAt: window.resetAt };
  }

  getMiddleware(maxReqs?: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
      const result = this.isAllowed(clientKey);

      res.setHeader('X-RateLimit-Limit', maxReqs ?? this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        throw new CanonicalAppError(
          ErrorCode.RATE_LIMITED,
          'API rate limit exceeded. Please retry after reset timestamp.',
          429
        );
      }

      next();
    };
  }
}

export const rateLimiter = new RateLimiter();
