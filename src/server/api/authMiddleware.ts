/**
 * Canonical Authentication & Authorization Express Middleware (GAR-034, GAR-039)
 *
 * Implements:
 * 1. Bearer session token extraction & verification.
 * 2. Active organization tenant resolution via `X-Organization-Id` header.
 * 3. Relationship-aware permission gate via `requirePermission()`.
 * 4. Immediate account status enforcement (denying suspended/locked accounts).
 */

import { Request, Response, NextFunction } from 'express';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { authService } from '../identity/authService';
import { assertAuthorized, ResourceAuthorizationContext } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { AccountStatus, AuthenticatedActorContext } from '../identity/types';
import { config } from '../config/env';

export const GARAGE_OS_SESSION_COOKIE = 'garage_os_session';

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

declare global {
  namespace Express {
    interface Request {
      actor?: AuthenticatedActorContext;
    }
  }
}

/**
 * Authentication middleware that extracts session token and populates req.actor
 */
export function authenticate(options: { optional?: boolean } = {}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      let token: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (typeof req.headers['x-session-token'] === 'string') {
        token = req.headers['x-session-token'].trim();
      } else {
        token = readCookie(req.headers.cookie, GARAGE_OS_SESSION_COOKIE);
      }

      const activeOrgId = (req.headers['x-organization-id'] as string) || undefined;
      const explicitActorId = (req.headers['x-actor-id'] || req.headers['x-user-id']) as string | undefined;
      const allowDevActorHeaders =
        (config.APP_ENV === 'development' || config.APP_ENV === 'test') &&
        process.env.GARAGE_OS_ALLOW_DEV_ACTOR_HEADERS === 'true';

      let actor: AuthenticatedActorContext | null = null;

      if (token) {
        actor = authService.authenticateSession(token, activeOrgId);
      } else if (explicitActorId && allowDevActorHeaders) {
        // Explicit actor headers are a test/development-only escape hatch and are disabled by default.
        actor = authService.getActorContextById(explicitActorId.trim(), activeOrgId);
      } else if (config.APP_ENV === 'development' || config.APP_ENV === 'test') {
        // Controlled local seed fallback for the owner-facing development shell.
        actor = authService.getActorContextById('usr_seed_owner_01', activeOrgId);
      }

      if (!actor) {
        if (options.optional) {
          return next();
        }
        throw new CanonicalAppError(
          ErrorCode.NOT_AUTHORIZED,
          token ? 'Invalid, revoked, or expired session' : 'Authentication required: missing Bearer token',
          401
        );
      }

      // Check account lifecycle status
      if (actor.account_status === AccountStatus.SUSPENDED) {
        throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Account has been suspended by administration', 403);
      }

      if (actor.account_status === AccountStatus.DISABLED || actor.account_status === AccountStatus.DELETED) {
        throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Account is disabled or deactivated', 403);
      }

      req.actor = actor;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Authorization middleware requiring a canonical permission
 */
export function requirePermission(
  permission: CanonicalPermission,
  contextExtractor?: (req: Request) => ResourceAuthorizationContext
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.actor) {
        throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Authentication required', 401);
      }

      const resourceContext = contextExtractor ? contextExtractor(req) : undefined;
      assertAuthorized(req.actor, permission, resourceContext);
      next();
    } catch (err) {
      next(err);
    }
  };
}
