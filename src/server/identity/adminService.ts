/**
 * Canonical Platform Administration & Identity Governance Service (GAR-003 §10-§12, GAR-039)
 *
 * Implements:
 * 1. Global user query & inspection.
 * 2. Administrative account suspension & reactivation with immediate session revocation.
 * 3. Platform role assignment & privilege governance.
 * 4. Immutable audit logging of all administrative actions.
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { DataProvenanceClass } from '../../shared/provenance';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { assertAuthorized } from './policyEngine';
import { CanonicalPermission } from './rbac';
import {
  AccountStatus,
  AuthenticatedActorContext,
  PlatformRole,
  UserEntity,
} from './types';

export class AdminService {
  /**
   * Search/list all users in the system
   */
  public listUsers(
    actor: AuthenticatedActorContext,
    options?: { search?: string; status?: AccountStatus; limit?: number }
  ): Array<Record<string, unknown>> {
    assertAuthorized(actor, CanonicalPermission.ADMIN_USERS_READ);

    const db = getDatabase();
    const limit = options?.limit || 50;

    let query = `
      SELECT u.id, u.email, u.phone, u.account_status, u.email_verified_at, u.last_authenticated_at,
             u.failed_login_attempts, u.locked_until, u.created_at,
             COALESCE(p.display_name, u.full_name) as display_name,
             p.country, p.timezone
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (options?.status) {
      query += ' AND u.account_status = ?';
      params.push(options.status);
    }

    if (options?.search) {
      query += ' AND (u.email LIKE ? OR p.display_name LIKE ?)';
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ?;';
    params.push(limit);

    const users = db.prepare(query).all(...params) as any[];

    // Augment with platform roles & memberships count
    return users.map((u) => {
      const roles = (db.prepare('SELECT role FROM user_platform_roles WHERE user_id = ?;').all(u.id) as any[]).map(
        (r) => r.role
      );
      const orgs = db.prepare(`
        SELECT o.id, o.name, m.role, m.status
        FROM organization_memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ?;
      `).all(u.id) as any[];

      return {
        ...u,
        platform_roles: roles,
        organizations: orgs,
      };
    });
  }

  /**
   * Administratively change account status (e.g. SUSPEND or ACTIVATE)
   */
  public updateAccountStatus(
    actor: AuthenticatedActorContext,
    targetUserId: string,
    newStatus: AccountStatus,
    reason: string,
    correlationId?: string
  ): void {
    assertAuthorized(actor, CanonicalPermission.ADMIN_USERS_SUSPEND);

    if (!reason || reason.trim().length < 5) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'A valid administrative reason (at least 5 characters) is required', 400);
    }

    const db = getDatabase();
    const targetUser = db.prepare('SELECT id, email, account_status FROM users WHERE id = ?;').get(targetUserId) as any;

    if (!targetUser) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'User not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const corrId = correlationId || `admin_status_${Date.now()}`;

    withTransaction((ctx) => {
      // 1. Update user account status
      ctx.db.prepare('UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?;').run(newStatus, now, targetUserId);

      // 2. If transitioning to SUSPENDED, LOCKED, or DISABLED: Immediately revoke all active sessions!
      if (newStatus === AccountStatus.SUSPENDED || newStatus === AccountStatus.DISABLED || newStatus === AccountStatus.LOCKED) {
        ctx.db.prepare("UPDATE sessions SET status = 'REVOKED' WHERE user_id = ? AND status = 'ACTIVE';").run(targetUserId);
      }

      // 3. Emit canonical event
      const eventType = newStatus === AccountStatus.SUSPENDED ? 'AccountSuspended' : 'AccountStatusUpdated';
      const event = createCanonicalEventEnvelope({
        type: eventType,
        correlation_id: corrId,
        subject_ids: { user_id: targetUserId, admin_user_id: actor.id },
        provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
        payload: {
          user_id: targetUserId,
          previous_status: targetUser.account_status,
          new_status: newStatus,
          reason,
          admin_user_id: actor.id,
        },
      });
      enqueueOutboxEvent(event, ctx.db);

      // 4. Record audit event
      recordAuditEvent(
        {
          actor_id: actor.id,
          actor_type: 'USER',
          action: 'ADMIN_USER_STATUS_CHANGE',
          resource_type: 'user',
          resource_id: targetUserId,
          correlation_id: corrId,
          source: 'ADMIN_API',
          before_state: { account_status: targetUser.account_status },
          after_state: { account_status: newStatus, reason },
        },
        ctx.db
      );
    });
  }

  /**
   * Assign or remove a platform role for a user
   */
  public assignPlatformRole(
    actor: AuthenticatedActorContext,
    targetUserId: string,
    role: PlatformRole,
    correlationId?: string
  ): void {
    assertAuthorized(actor, CanonicalPermission.ADMIN_PLATFORM_MANAGE);

    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    db.prepare(`
      INSERT INTO user_platform_roles (user_id, role, assigned_by, assigned_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, role) DO NOTHING;
    `).run(targetUserId, role, actor.id, now);

    recordAuditEvent({
      actor_id: actor.id,
      actor_type: 'USER',
      action: 'PLATFORM_ROLE_ASSIGNED',
      resource_type: 'user',
      resource_id: targetUserId,
      correlation_id: correlationId || `plat_role_${Date.now()}`,
      source: 'ADMIN_API',
      after_state: { role, assigned_by: actor.id },
    });
  }
}

export const adminService = new AdminService();
