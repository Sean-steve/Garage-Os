/**
 * Canonical Organization, Membership & Invitation Service (GAR-003 §7-§9, GAR-011, GAR-030)
 *
 * Implements:
 * 1. Multi-organization tenancy foundation.
 * 2. Organization lifecycle states (DRAFT, PENDING_VERIFICATION, ACTIVE, SUSPENDED, DISABLED).
 * 3. Organization membership management & multi-membership support.
 * 4. Secure, single-use, expiring invitations with token hashing.
 * 5. Strict authorization and multi-tenant isolation.
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { generatePrefixedId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { DataProvenanceClass } from '../../shared/provenance';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { jobEngine } from '../jobs/jobEngine';
import { normalizeEmail } from './normalizer';
import { hashOpaqueToken, generateSecureToken } from './password';
import { assertAuthorized } from './policyEngine';
import { CanonicalPermission } from './rbac';
import {
  AuthenticatedActorContext,
  MembershipRole,
  MembershipStatus,
  OrganizationEntity,
  OrganizationMembershipEntity,
  OrganizationStatus,
  OrganizationType,
} from './types';

export interface CreateOrganizationInput {
  name: string;
  type: OrganizationType;
  correlationId?: string;
}

export class OrganizationService {
  /**
   * Create a new organization and assign creator as OWNER
   */
  public createOrganization(
    actor: AuthenticatedActorContext,
    input: CreateOrganizationInput
  ): { organization: OrganizationEntity; membership: OrganizationMembershipEntity } {
    if (!input.name || input.name.trim().length < 2) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Organization name must be at least 2 characters', 400);
    }

    const orgId = generatePrefixedId('org');
    const membershipId = generatePrefixedId('mem');
    const now = getCurrentUtcIsoString();
    const correlationId = input.correlationId || `org_create_${Date.now()}`;

    const organization: OrganizationEntity = {
      id: orgId,
      name: input.name.trim(),
      organization_type: input.type,
      status: OrganizationStatus.ACTIVE,
      created_at: now,
      updated_at: now,
    };

    const membership: OrganizationMembershipEntity = {
      id: membershipId,
      user_id: actor.id,
      organization_id: orgId,
      role: MembershipRole.OWNER,
      status: MembershipStatus.ACTIVE,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    };

    withTransaction((ctx) => {
      // 1. Insert organization
      ctx.db
        .prepare(`
          INSERT INTO organizations (id, organization_type, name, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?);
        `)
        .run(orgId, organization.organization_type, organization.name, organization.status, now, now);

      // 2. Insert creator as OWNER membership
      ctx.db
        .prepare(`
          INSERT INTO organization_memberships (
            id, user_id, organization_id, role, status, accepted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `)
        .run(membershipId, actor.id, orgId, membership.role, membership.status, now, now, now);

      // 3. Outbox event
      const event = createCanonicalEventEnvelope({
        type: 'OrganizationCreated',
        correlation_id: correlationId,
        subject_ids: { organization_id: orgId, owner_user_id: actor.id },
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        payload: {
          organization_id: orgId,
          name: organization.name,
          organization_type: organization.organization_type,
          owner_user_id: actor.id,
        },
      });
      enqueueOutboxEvent(event, ctx.db);

      // 4. Audit
      recordAuditEvent(
        {
          actor_id: actor.id,
          actor_type: 'USER',
          action: 'ORGANIZATION_CREATED',
          resource_type: 'organization',
          resource_id: orgId,
          correlation_id: correlationId,
          source: 'ORGANIZATION_API',
          after_state: { name: organization.name, type: organization.organization_type },
        },
        ctx.db
      );
    });

    return { organization, membership };
  }

  /**
   * Get organization by ID
   */
  public getOrganization(actor: AuthenticatedActorContext, orgId: string): OrganizationEntity {
    assertAuthorized(actor, CanonicalPermission.ORG_READ, { organizationId: orgId });

    const db = getDatabase();
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?;').get(orgId) as any;

    if (!org) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Organization not found', 404);
    }

    return {
      id: org.id,
      organization_type: org.organization_type as OrganizationType,
      name: org.name,
      status: org.status as OrganizationStatus,
      created_at: org.created_at,
      updated_at: org.updated_at,
    };
  }

  /**
   * List organizations current actor is an active member of
   */
  public listOrganizationsForActor(actor: AuthenticatedActorContext): OrganizationEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT o.*
      FROM organizations o
      JOIN organization_memberships m ON m.organization_id = o.id
      WHERE m.user_id = ? AND m.status = 'ACTIVE'
      ORDER BY o.name ASC;
    `).all(actor.id) as any[];

    return rows.map((r) => ({
      id: r.id,
      organization_type: r.organization_type as OrganizationType,
      name: r.name,
      status: r.status as OrganizationStatus,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  /**
   * Update organization details
   */
  public updateOrganization(
    actor: AuthenticatedActorContext,
    orgId: string,
    updates: { name?: string; status?: OrganizationStatus },
    correlationId?: string
  ): OrganizationEntity {
    assertAuthorized(actor, CanonicalPermission.ORG_UPDATE, { organizationId: orgId });

    const db = getDatabase();
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?;').get(orgId) as any;
    if (!org) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Organization not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const newName = updates.name ? updates.name.trim() : org.name;
    const newStatus = updates.status || org.status;

    db.prepare(`
      UPDATE organizations SET name = ?, status = ?, updated_at = ? WHERE id = ?;
    `).run(newName, newStatus, now, orgId);

    recordAuditEvent({
      actor_id: actor.id,
      actor_type: 'USER',
      action: 'ORGANIZATION_UPDATED',
      resource_type: 'organization',
      resource_id: orgId,
      correlation_id: correlationId || `org_upd_${Date.now()}`,
      source: 'ORGANIZATION_API',
      before_state: { name: org.name, status: org.status },
      after_state: { name: newName, status: newStatus },
    });

    return {
      id: orgId,
      organization_type: org.organization_type as OrganizationType,
      name: newName,
      status: newStatus as OrganizationStatus,
      created_at: org.created_at,
      updated_at: now,
    };
  }

  /**
   * List members of an organization
   */
  public listMembers(
    actor: AuthenticatedActorContext,
    orgId: string
  ): Array<{
    membership_id: string;
    user_id: string;
    email: string;
    full_name: string;
    role: MembershipRole;
    status: MembershipStatus;
    invited_at?: string | null;
    accepted_at?: string | null;
  }> {
    assertAuthorized(actor, CanonicalPermission.ORG_MEMBERS_READ, { organizationId: orgId });

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT m.id as membership_id, m.user_id, u.email, COALESCE(p.display_name, u.full_name) as full_name,
             m.role, m.status, m.invited_at, m.accepted_at
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE m.organization_id = ?
      ORDER BY m.created_at ASC;
    `).all(orgId) as any[];

    return rows;
  }

  /**
   * Invite a new member to the organization
   */
  public inviteMember(
    actor: AuthenticatedActorContext,
    orgId: string,
    email: string,
    role: MembershipRole,
    correlationId?: string
  ): { id: string; email: string; role: MembershipRole; expires_at: string; devInvitationToken?: string } {
    assertAuthorized(actor, CanonicalPermission.ORG_MEMBERS_INVITE, { organizationId: orgId });
    const normalized = normalizeEmail(email);

    const db = getDatabase();
    // Check if already active member
    const existing = db.prepare(`
      SELECT m.id, m.status
      FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND u.email = ? AND m.status = 'ACTIVE';
    `).get(orgId, normalized);

    if (existing) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, 'User is already an active member of this organization', 409);
    }

    const invitationId = generatePrefixedId('inv');
    const rawToken = generateSecureToken(32);
    const tokenHash = hashOpaqueToken(rawToken);
    const now = getCurrentUtcIsoString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const org = db.prepare('SELECT name FROM organizations WHERE id = ?;').get(orgId) as any;

    withTransaction((ctx) => {
      // Cancel previous pending invitations for this email in this org
      ctx.db.prepare(`
        UPDATE organization_invitations
        SET status = 'CANCELLED', updated_at = ?
        WHERE organization_id = ? AND email = ? AND status = 'PENDING';
      `).run(now, orgId, normalized);

      ctx.db.prepare(`
        INSERT INTO organization_invitations (
          id, organization_id, inviter_user_id, email, role, token_hash, status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?);
      `).run(invitationId, orgId, actor.id, normalized, role, tokenHash, expiresAt, now, now);

      const event = createCanonicalEventEnvelope({
        type: 'MembershipInvited',
        correlation_id: correlationId || `inv_${Date.now()}`,
        subject_ids: { organization_id: orgId, invitation_id: invitationId },
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        payload: {
          invitation_id: invitationId,
          organization_id: orgId,
          email: normalized,
          role,
          inviter_user_id: actor.id,
        },
      });
      enqueueOutboxEvent(event, ctx.db);

      recordAuditEvent(
        {
          actor_id: actor.id,
          actor_type: 'USER',
          action: 'MEMBERSHIP_INVITED',
          resource_type: 'organization_invitation',
          resource_id: invitationId,
          correlation_id: correlationId || `inv_${Date.now()}`,
          source: 'ORGANIZATION_API',
          after_state: { organization_id: orgId, email: normalized, role },
        },
        ctx.db
      );
    });

    // Enqueue background delivery
    jobEngine.enqueue('identity.send_organization_invitation', {
      invitationId,
      organizationId: orgId,
      organizationName: org?.name || 'Garage OS Organization',
      inviterName: actor.profile.display_name,
      email: normalized,
      role,
      token: rawToken,
    });

    return {
      id: invitationId,
      email: normalized,
      role,
      expires_at: expiresAt,
      devInvitationToken: rawToken,
    };
  }

  /**
   * Accept an organization invitation
   */
  public acceptInvitation(
    actor: AuthenticatedActorContext,
    token: string,
    correlationId?: string
  ): OrganizationMembershipEntity {
    if (!token) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invitation token is required', 400);
    }

    const tokenHash = hashOpaqueToken(token);
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const invitation = db.prepare(`
      SELECT * FROM organization_invitations
      WHERE token_hash = ? AND status = 'PENDING' AND expires_at > ?;
    `).get(tokenHash, now) as any;

    if (!invitation) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid, cancelled, or expired invitation', 400);
    }

    const orgId = invitation.organization_id;
    const role = invitation.role as MembershipRole;
    const membershipId = generatePrefixedId('mem');

    withTransaction((ctx) => {
      // 1. Mark invitation accepted
      ctx.db.prepare(`
        UPDATE organization_invitations
        SET status = 'ACCEPTED', updated_at = ?
        WHERE id = ?;
      `).run(now, invitation.id);

      // 2. Insert or update membership
      ctx.db.prepare(`
        INSERT INTO organization_memberships (
          id, user_id, organization_id, role, status, accepted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
        ON CONFLICT(user_id, organization_id) DO UPDATE SET
          role = excluded.role,
          status = 'ACTIVE',
          accepted_at = excluded.accepted_at,
          updated_at = excluded.updated_at;
      `).run(membershipId, actor.id, orgId, role, now, now, now);

      // 3. Outbox event
      const event = createCanonicalEventEnvelope({
        type: 'MembershipAccepted',
        correlation_id: correlationId || `acc_inv_${Date.now()}`,
        subject_ids: { organization_id: orgId, user_id: actor.id },
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        payload: {
          invitation_id: invitation.id,
          organization_id: orgId,
          user_id: actor.id,
          role,
        },
      });
      enqueueOutboxEvent(event, ctx.db);

      // 4. Audit
      recordAuditEvent(
        {
          actor_id: actor.id,
          actor_type: 'USER',
          action: 'MEMBERSHIP_ACCEPTED',
          resource_type: 'organization_membership',
          resource_id: membershipId,
          correlation_id: correlationId || `acc_inv_${Date.now()}`,
          source: 'ORGANIZATION_API',
          after_state: { organization_id: orgId, role, status: 'ACTIVE' },
        },
        ctx.db
      );
    });

    return {
      id: membershipId,
      user_id: actor.id,
      organization_id: orgId,
      role,
      status: MembershipStatus.ACTIVE,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Update member role within an organization
   */
  public updateMemberRole(
    actor: AuthenticatedActorContext,
    orgId: string,
    membershipId: string,
    newRole: MembershipRole,
    correlationId?: string
  ): void {
    assertAuthorized(actor, CanonicalPermission.ORG_MEMBERS_UPDATE_ROLE, { organizationId: orgId });

    const db = getDatabase();
    const mem = db.prepare('SELECT * FROM organization_memberships WHERE id = ? AND organization_id = ?;').get(membershipId, orgId) as any;

    if (!mem) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Membership not found in this organization', 404);
    }

    const now = getCurrentUtcIsoString();
    db.prepare('UPDATE organization_memberships SET role = ?, updated_at = ? WHERE id = ?;').run(newRole, now, membershipId);

    recordAuditEvent({
      actor_id: actor.id,
      actor_type: 'USER',
      action: 'MEMBERSHIP_ROLE_UPDATED',
      resource_type: 'organization_membership',
      resource_id: membershipId,
      correlation_id: correlationId || `role_upd_${Date.now()}`,
      source: 'ORGANIZATION_API',
      before_state: { role: mem.role },
      after_state: { role: newRole },
    });
  }

  /**
   * Revoke membership in an organization
   */
  public revokeMembership(
    actor: AuthenticatedActorContext,
    orgId: string,
    membershipId: string,
    correlationId?: string
  ): void {
    assertAuthorized(actor, CanonicalPermission.ORG_MEMBERS_REVOKE, { organizationId: orgId });

    const db = getDatabase();
    const mem = db.prepare('SELECT * FROM organization_memberships WHERE id = ? AND organization_id = ?;').get(membershipId, orgId) as any;

    if (!mem) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Membership not found in this organization', 404);
    }

    const now = getCurrentUtcIsoString();

    withTransaction((ctx) => {
      ctx.db.prepare("UPDATE organization_memberships SET status = 'REVOKED', revoked_at = ?, updated_at = ? WHERE id = ?;").run(now, now, membershipId);

      const event = createCanonicalEventEnvelope({
        type: 'MembershipRevoked',
        correlation_id: correlationId || `rev_mem_${Date.now()}`,
        subject_ids: { organization_id: orgId, user_id: mem.user_id, membership_id: membershipId },
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        payload: {
          membership_id: membershipId,
          organization_id: orgId,
          user_id: mem.user_id,
        },
      });
      enqueueOutboxEvent(event, ctx.db);

      recordAuditEvent(
        {
          actor_id: actor.id,
          actor_type: 'USER',
          action: 'MEMBERSHIP_REVOKED',
          resource_type: 'organization_membership',
          resource_id: membershipId,
          correlation_id: correlationId || `rev_mem_${Date.now()}`,
          source: 'ORGANIZATION_API',
          after_state: { status: 'REVOKED' },
        },
        ctx.db
      );
    });
  }
}

export const organizationService = new OrganizationService();
