/**
 * Garage OS — Dispatch Authorization Boundary (GAR-003, GAR-016, GAR-039, GAR-040)
 *
 * Centralizes server-side authorization for dispatch HTTP, SSE and WebSocket access.
 * No caller-provided user/role/provider identifiers are trusted as authorization.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  AuthenticatedActorContext,
  MembershipStatus,
  OrganizationStatus,
  PlatformRole,
} from '../identity/types';
import { DispatchDomain } from './types';

function deny(message = 'Dispatch resource is not accessible to this actor'): never {
  throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, message, 403);
}

export function isPlatformDispatchOperator(actor: AuthenticatedActorContext): boolean {
  return actor.platform_roles.some(
    (role) => role === PlatformRole.PLATFORM_ADMIN || role === PlatformRole.OPERATIONS
  );
}

function hasActiveMembership(
  actor: AuthenticatedActorContext,
  organizationId: string | null | undefined
): boolean {
  if (!organizationId) return false;
  return actor.memberships.some(
    (membership) =>
      membership.organization_id === organizationId &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.organization_status === OrganizationStatus.ACTIVE
  );
}

export function canAccessProvider(
  actor: AuthenticatedActorContext,
  providerId: string,
  customDb?: DatabaseSync
): boolean {
  if (isPlatformDispatchOperator(actor)) return true;

  const db = customDb || getDatabase();
  const provider = db
    .prepare('SELECT organization_id FROM service_providers WHERE id = ? LIMIT 1')
    .get(providerId) as { organization_id?: string | null } | undefined;

  return Boolean(provider && hasActiveMembership(actor, provider.organization_id));
}

export function assertProviderAccess(
  actor: AuthenticatedActorContext,
  providerId: string,
  customDb?: DatabaseSync
): void {
  if (!canAccessProvider(actor, providerId, customDb)) {
    deny('Actor is not authorized for this provider dispatch context');
  }
}

function getSourceRequester(
  domain: DispatchDomain | string,
  sourceReferenceId: string,
  customDb?: DatabaseSync
): string | null {
  const db = customDb || getDatabase();

  if (domain === DispatchDomain.ROADSIDE || domain === 'ROADSIDE') {
    const row = db
      .prepare(`
        SELECT ri.reported_by_user_id AS requester_user_id
        FROM roadside_incidents ri
        LEFT JOIN roadside_assistance_requests rar ON rar.incident_id = ri.id
        WHERE ri.id = ? OR rar.id = ?
        ORDER BY ri.created_at DESC
        LIMIT 1
      `)
      .get(sourceReferenceId, sourceReferenceId) as { requester_user_id?: string | null } | undefined;
    return row?.requester_user_id || null;
  }

  if (domain === DispatchDomain.TOWING || domain === 'TOWING') {
    const row = db
      .prepare('SELECT requesting_user_id AS requester_user_id FROM tow_requests WHERE id = ? LIMIT 1')
      .get(sourceReferenceId) as { requester_user_id?: string | null } | undefined;
    return row?.requester_user_id || null;
  }

  return null;
}

export function assertDispatchSourceAccess(
  actor: AuthenticatedActorContext,
  domain: DispatchDomain | string,
  sourceReferenceId: string,
  customDb?: DatabaseSync
): void {
  if (isPlatformDispatchOperator(actor)) return;

  const requesterUserId = getSourceRequester(domain, sourceReferenceId, customDb);
  if (requesterUserId && requesterUserId === actor.id) return;

  deny('Actor is not authorized to dispatch this source request');
}

export function assertDispatchRequestAccess(
  actor: AuthenticatedActorContext,
  dispatchRequestId: string,
  customDb?: DatabaseSync
): void {
  const db = customDb || getDatabase();
  const request = db
    .prepare(`
      SELECT id, dispatch_domain, source_reference_id, assigned_provider_id
      FROM dispatch_requests
      WHERE id = ?
      LIMIT 1
    `)
    .get(dispatchRequestId) as
    | {
        id: string;
        dispatch_domain: string;
        source_reference_id: string;
        assigned_provider_id?: string | null;
      }
    | undefined;

  if (!request) {
    throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Dispatch request not found', 404);
  }

  if (isPlatformDispatchOperator(actor)) return;

  const requesterUserId = getSourceRequester(
    request.dispatch_domain,
    request.source_reference_id,
    db
  );
  if (requesterUserId === actor.id) return;

  if (request.assigned_provider_id && canAccessProvider(actor, request.assigned_provider_id, db)) {
    return;
  }

  deny();
}

export function assertResponderAccess(
  actor: AuthenticatedActorContext,
  responderReferenceId: string,
  customDb?: DatabaseSync
): void {
  if (isPlatformDispatchOperator(actor)) return;

  const db = customDb || getDatabase();
  const row = db
    .prepare(
      'SELECT provider_id FROM responder_presence WHERE responder_reference_id = ? LIMIT 1'
    )
    .get(responderReferenceId) as { provider_id?: string | null } | undefined;

  if (!row?.provider_id) {
    deny('Responder is not registered in an authorized provider context');
  }

  assertProviderAccess(actor, row.provider_id, db);
}

export function assertTrackingAccess(
  actor: AuthenticatedActorContext,
  assignmentId: string,
  customDb?: DatabaseSync
): void {
  const db = customDb || getDatabase();
  const tracking = db
    .prepare(`
      SELECT
        customer_user_id,
        dispatch_request_id,
        tracking_access_status,
        is_tracking_active
      FROM dispatch_tracking_projections
      WHERE assignment_id = ?
      LIMIT 1
    `)
    .get(assignmentId) as
    | {
        customer_user_id?: string | null;
        dispatch_request_id: string;
        tracking_access_status: string;
        is_tracking_active: number;
      }
    | undefined;

  if (!tracking) {
    throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Tracking record not found', 404);
  }

  if (isPlatformDispatchOperator(actor)) return;

  if (
    tracking.customer_user_id === actor.id &&
    tracking.tracking_access_status === 'ACTIVE' &&
    tracking.is_tracking_active === 1
  ) {
    return;
  }

  const request = db
    .prepare('SELECT assigned_provider_id FROM dispatch_requests WHERE id = ? LIMIT 1')
    .get(tracking.dispatch_request_id) as { assigned_provider_id?: string | null } | undefined;

  if (
    request?.assigned_provider_id &&
    canAccessProvider(actor, request.assigned_provider_id, db)
  ) {
    return;
  }

  deny('Tracking access is not active for this actor');
}

export function assertOperationsAccess(actor: AuthenticatedActorContext): void {
  if (!isPlatformDispatchOperator(actor)) {
    deny('Platform operations permission is required');
  }
}

export function assertRealtimeTopicAccess(
  actor: AuthenticatedActorContext,
  topic: string,
  customDb?: DatabaseSync
): void {
  if (topic === '*' || topic === 'operations.dispatch') {
    return assertOperationsAccess(actor);
  }

  if (topic.startsWith('responder.')) {
    const responderId = topic.slice('responder.'.length);
    if (!responderId) deny('Invalid responder topic');
    return assertResponderAccess(actor, responderId, customDb);
  }

  if (topic.startsWith('dispatch.request.')) {
    const requestId = topic.slice('dispatch.request.'.length);
    if (!requestId) deny('Invalid dispatch request topic');
    return assertDispatchRequestAccess(actor, requestId, customDb);
  }

  if (topic.startsWith('assignment.')) {
    const assignmentId = topic.slice('assignment.'.length);
    if (!assignmentId) deny('Invalid assignment topic');
    return assertTrackingAccess(actor, assignmentId, customDb);
  }

  deny('Realtime topic is not authorized');
}
