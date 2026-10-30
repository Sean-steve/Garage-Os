/**
 * Canonical Policy Engine & Relationship-Aware Authorization (GAR-003 §10, GAR-039 §2, GAR-040)
 *
 * Rules:
 * 1. Deny by default: If no explicit policy allows the action, DENY.
 * 2. Multi-tenancy isolation: Cross-organization resource access is strictly forbidden.
 * 3. Account state enforcement: Suspended, locked, or deleted accounts cannot perform authorized actions.
 * 4. Relationship-aware: Combines RBAC permission with ownership and tenant context.
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  AuthenticatedActorContext,
  AccountStatus,
  OrganizationStatus,
  MembershipStatus,
} from './types';
import {
  CanonicalPermission,
  ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
} from './rbac';
import { logger } from '../observability/logger';

export interface ResourceAuthorizationContext {
  /** The target resource ID */
  resourceId?: string;
  /** The owner user ID if the resource is owned by a person */
  ownerUserId?: string;
  /** The tenant/organization ID owning this resource */
  organizationId?: string;
  /** Additional arbitrary context for specialized domain rules */
  attributes?: Record<string, unknown>;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason: string;
  auditRequired?: boolean;
}

/**
 * Centralized policy evaluation engine
 */
export function evaluatePolicy(
  actor: AuthenticatedActorContext,
  permission: CanonicalPermission,
  resourceContext?: ResourceAuthorizationContext
): PolicyEvaluationResult {
  // Rule 1: Account status check
  if (actor.account_status !== AccountStatus.ACTIVE) {
    return {
      allowed: false,
      reason: `Account is in state ${actor.account_status}; operations are prohibited`,
    };
  }

  // Rule 2: Personal resource ownership
  // Users always have permission to read/update their own profile and view/revoke their own sessions
  if (
    resourceContext?.ownerUserId &&
    resourceContext.ownerUserId === actor.id
  ) {
    if (
      permission === CanonicalPermission.USER_PROFILE_READ ||
      permission === CanonicalPermission.USER_PROFILE_UPDATE ||
      permission === CanonicalPermission.USER_SESSION_READ ||
      permission === CanonicalPermission.USER_SESSION_REVOKE
    ) {
      return {
        allowed: true,
        reason: 'Authorized via direct personal ownership of resource',
      };
    }
  }

  // Rule 3: Platform Roles (Platform administration)
  for (const platRole of actor.platform_roles) {
    const permissions = PLATFORM_ROLE_PERMISSIONS[platRole] || [];
    if (permissions.includes(permission)) {
      return {
        allowed: true,
        reason: `Authorized via platform role ${platRole}`,
        auditRequired: true,
      };
    }
  }

  // Rule 4: Organization-scoped RBAC & Multi-tenant isolation
  if (resourceContext?.organizationId) {
    const targetOrgId = resourceContext.organizationId;

    // Find actor's membership in target organization
    const membership = actor.memberships.find(
      (m) => m.organization_id === targetOrgId
    );

    if (!membership) {
      return {
        allowed: false,
        reason: `Actor has no membership in organization ${targetOrgId} (Multi-tenancy isolation violation)`,
      };
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      return {
        allowed: false,
        reason: `Actor membership in organization ${targetOrgId} is ${membership.status}`,
      };
    }

    if (membership.organization_status !== OrganizationStatus.ACTIVE) {
      return {
        allowed: false,
        reason: `Organization ${targetOrgId} status is ${membership.organization_status}; operations are restricted`,
      };
    }

    const orgPermissions = ROLE_PERMISSIONS[membership.role] || [];
    if (orgPermissions.includes(permission)) {
      return {
        allowed: true,
        reason: `Authorized via organization role ${membership.role} in organization ${targetOrgId}`,
      };
    }

    return {
      allowed: false,
      reason: `Organization role ${membership.role} lacks permission ${permission}`,
    };
  }

  // Rule 5: Active organization context when no specific resource organization is passed
  if (actor.active_organization_id && actor.active_membership) {
    const mem = actor.active_membership;
    if (mem.status === MembershipStatus.ACTIVE && mem.organization_status === OrganizationStatus.ACTIVE) {
      const orgPermissions = ROLE_PERMISSIONS[mem.role] || [];
      if (orgPermissions.includes(permission)) {
        return {
          allowed: true,
          reason: `Authorized via active organization role ${mem.role} in ${actor.active_organization_id}`,
        };
      }
    }
  }

  // Rule 6: Deny by default
  return {
    allowed: false,
    reason: `Deny by default: actor lacks grant for permission ${permission}`,
  };
}

/**
 * Asserts authorization or throws 403 NOT_AUTHORIZED
 */
export function assertAuthorized(
  actor: AuthenticatedActorContext,
  permission: CanonicalPermission,
  resourceContext?: ResourceAuthorizationContext
): void {
  const result = evaluatePolicy(actor, permission, resourceContext);
  if (!result.allowed) {
    logger.warn(`Authorization denied: actor=${actor.id} permission=${permission} reason="${result.reason}"`, {
      actor_id: actor.id,
      details: {
        permission,
        resourceContext,
      },
    });
    throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, result.reason, 403);
  }
}
