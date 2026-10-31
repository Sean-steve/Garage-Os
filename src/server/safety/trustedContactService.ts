import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config/env';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { jobEngine } from '../jobs/jobEngine';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { safetyRepository } from './safetyRepository';
import { sosRepository } from './sosRepository';
import { trustedContactRepository } from './trustedContactRepository';
import {
  SosIncidentStatus,
  SosNotificationAttempt,
  SosNotificationStatus,
  TrustedContactAccessGrant,
  TrustedContactGrantStatus,
  TrustedContactPortalView,
  TrustedContactResponse,
  TrustedContactResponseRecord,
} from './types';

function signingSecret(): string {
  return config.TRUSTED_CONTACT_TOKEN_SECRET || config.JWT_SECRET;
}

function tokenSignature(grantId: string): string {
  return createHmac('sha256', signingSecret())
    .update(`garage-os:trusted-contact:${grantId}`)
    .digest('base64url');
}

function rawTokenForGrant(grantId: string): string {
  return `${grantId}.${tokenSignature(grantId)}`;
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseGrantId(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const grantId = token.slice(0, dot);
  const suppliedSignature = token.slice(dot + 1);
  if (!safeEqual(suppliedSignature, tokenSignature(grantId))) return null;
  return grantId;
}

function portalUrl(token: string): string {
  const base = config.APP_URL.replace(/\/+$/, '');
  // The secret stays in the URL fragment so browsers do not send it in the initial
  // HTTP request, server access logs, or Referer header.
  return `${base}/trusted-contact#token=${encodeURIComponent(token)}`;
}

export const TRUSTED_CONTACT_ACCESS_EXPIRY_JOB = 'safety.trusted_contact.access_expiry';

export class TrustedContactService {
  ensureGrantForNotificationAttempt(attempt: SosNotificationAttempt): {
    grant: TrustedContactAccessGrant;
    token: string;
    portal_url: string;
  } {
    const existing = trustedContactRepository.getGrantByNotificationAttempt(attempt.id);
    if (existing) {
      const now = getCurrentUtcIsoString();
      if (
        existing.status !== TrustedContactGrantStatus.ACTIVE ||
        existing.expires_at <= now
      ) {
        if (
          existing.status === TrustedContactGrantStatus.ACTIVE &&
          existing.expires_at <= now
        ) {
          trustedContactRepository.expireGrant(existing.id, now);
        }
        throw new CanonicalAppError(
          ErrorCode.INVALID_STATE_TRANSITION,
          'Trusted-contact access for this notification attempt is no longer active',
          409
        );
      }
      const token = rawTokenForGrant(existing.id);
      return { grant: existing, token, portal_url: portalUrl(token) };
    }

    const incident = sosRepository.getIncidentById(attempt.incident_id);
    if (!incident || incident.status !== SosIncidentStatus.ACTIVATED) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Trusted-contact access can only be issued for an activated SOS incident',
        409
      );
    }

    const now = getCurrentUtcIsoString();
    const grantId = generateCanonicalId('tcg');
    const token = rawTokenForGrant(grantId);
    const expiresAt = new Date(
      new Date(now).getTime() + config.TRUSTED_CONTACT_TOKEN_TTL_MINUTES * 60_000
    ).toISOString();

    const grant: TrustedContactAccessGrant = {
      id: grantId,
      incident_id: attempt.incident_id,
      contact_id: attempt.contact_id,
      notification_attempt_id: attempt.id,
      token_digest: digestToken(token),
      status: TrustedContactGrantStatus.ACTIVE,
      expires_at: expiresAt,
      first_accessed_at: null,
      last_accessed_at: null,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    };

    withTransaction(({ db }) => {
      trustedContactRepository.createGrant(grant);
      trustedContactRepository.recordAccessAudit({
        id: generateCanonicalId('tca'),
        grant_id: grant.id,
        incident_id: grant.incident_id,
        contact_id: grant.contact_id,
        action: 'ACCESS_GRANT_CREATED',
        metadata: {
          expires_at: grant.expires_at,
          notification_attempt_id: grant.notification_attempt_id,
        },
        occurred_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.trusted_contact.access_grant.created',
          producer: 'garage-os-safety',
          correlation_id: grant.incident_id,
          subject_ids: {
            sos_incident: grant.incident_id,
            emergency_contact: grant.contact_id,
            trusted_contact_grant: grant.id,
          },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            grant_id: grant.id,
            incident_id: grant.incident_id,
            contact_id: grant.contact_id,
            expires_at: grant.expires_at,
          },
        }),
        db
      );
    });

    jobEngine.enqueue(
      TRUSTED_CONTACT_ACCESS_EXPIRY_JOB,
      { grant_id: grant.id },
      { runAt: grant.expires_at, correlationId: grant.incident_id, maxRetries: 3 }
    );

    return { grant, token, portal_url: portalUrl(token) };
  }

  resolvePortal(token: string): TrustedContactPortalView {
    const grant = this.requireActiveGrant(token, true);
    const incident = sosRepository.getIncidentById(grant.incident_id);
    if (!incident || incident.status !== SosIncidentStatus.ACTIVATED) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        'Trusted-contact link is no longer available',
        404
      );
    }

    const attempt = sosRepository.getNotificationAttempt(grant.notification_attempt_id);
    if (!attempt || attempt.contact_id !== grant.contact_id) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        'Trusted-contact link is no longer available',
        404
      );
    }

    const contact = safetyRepository.getContact(incident.user_id, grant.contact_id);
    if (!contact || contact.status !== 'ACTIVE') {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        'Trusted-contact link is no longer available',
        404
      );
    }

    const db = getDatabase();
    const owner = db.prepare(
      'SELECT full_name, phone FROM users WHERE id = ? LIMIT 1'
    ).get(incident.user_id) as { full_name?: string | null; phone?: string | null } | undefined;

    let vehicle: TrustedContactPortalView['vehicle'] = null;
    if (attempt.share_vehicle_summary && incident.vehicle_id) {
      const row = db.prepare(
        `SELECT
          v.make,
          v.model,
          (
            SELECT vi.value
            FROM vehicle_identifiers vi
            WHERE vi.vehicle_id = v.id
              AND vi.type = 'REGISTRATION_NUMBER'
            ORDER BY vi.is_primary DESC, vi.created_at DESC
            LIMIT 1
          ) AS registration_number
        FROM vehicles v
        WHERE v.id = ?
        LIMIT 1`
      ).get(incident.vehicle_id) as {
        make?: string | null;
        model?: string | null;
        registration_number?: string | null;
      } | undefined;
      if (row) {
        vehicle = {
          make: row.make || null,
          model: row.model || null,
          registration_number: row.registration_number || null,
        };
      }
    }

    const activeLocation =
      attempt.share_live_location
        ? sosRepository.getActiveLocation(incident.id, getCurrentUtcIsoString())
        : null;

    const location =
      activeLocation && activeLocation.sharing_authorized
        ? {
            latitude: activeLocation.latitude,
            longitude: activeLocation.longitude,
            accuracy_meters: activeLocation.accuracy_meters || null,
            captured_at: activeLocation.captured_at,
            expires_at: activeLocation.expires_at,
          }
        : null;

    const assistance = attempt.share_assistance_status
      ? {
          state: incident.assistance_state,
          requested: incident.assistance_state !== 'NOT_REQUESTED',
          accepted: ['ACCEPTED', 'ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
          arrived: ['ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
        }
      : null;

    return {
      grant: {
        expires_at: grant.expires_at,
        status: grant.status,
      },
      contact: {
        display_name: contact.display_name,
        relationship_label: contact.relationship_label || null,
      },
      owner: {
        display_name: owner?.full_name || 'Garage OS user',
        callback_number: attempt.share_callback_number ? owner?.phone || null : null,
      },
      incident: {
        id: incident.id,
        status: incident.status,
        incident_type: attempt.share_incident_type ? incident.incident_type : null,
        incident_level: incident.incident_level,
        activated_at: incident.activated_at || null,
        created_at: incident.created_at,
      },
      vehicle,
      location,
      assistance,
      latest_response: trustedContactRepository.getLatestResponse(grant.id),
      permissions: {
        incident_type: attempt.share_incident_type,
        vehicle_summary: attempt.share_vehicle_summary,
        live_location: attempt.share_live_location,
        assistance_status: attempt.share_assistance_status,
        callback_number: attempt.share_callback_number,
      },
      safety_truth: {
        backend_acknowledged: Boolean(incident.server_acknowledged_at),
        trusted_contact_delivery_confirmed:
          attempt.status === SosNotificationStatus.DELIVERED,
        assistance_requested: incident.assistance_state !== 'NOT_REQUESTED',
        assistance_accepted: ['ACCEPTED', 'ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
        assistance_arrived: ['ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
      },
    };
  }

  recordResponse(token: string, response: TrustedContactResponse): TrustedContactPortalView {
    if (!Object.values(TrustedContactResponse).includes(response)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid trusted-contact response', 400);
    }

    const grant = this.requireActiveGrant(token, false);
    const incident = sosRepository.getIncidentById(grant.incident_id);
    if (!incident || incident.status !== SosIncidentStatus.ACTIVATED) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'This SOS incident is no longer active',
        409
      );
    }

    const latest = trustedContactRepository.getLatestResponse(grant.id);
    if (latest?.response === response) {
      return this.resolvePortal(token);
    }

    const now = getCurrentUtcIsoString();
    const record: TrustedContactResponseRecord = {
      id: generateCanonicalId('tcr'),
      grant_id: grant.id,
      incident_id: grant.incident_id,
      contact_id: grant.contact_id,
      response,
      created_at: now,
    };

    withTransaction(({ db }) => {
      trustedContactRepository.insertResponse(record);
      trustedContactRepository.touchGrant(grant.id, now);
      trustedContactRepository.recordAccessAudit({
        id: generateCanonicalId('tca'),
        grant_id: grant.id,
        incident_id: grant.incident_id,
        contact_id: grant.contact_id,
        action: 'CONTACT_RESPONSE_RECORDED',
        metadata: { response },
        occurred_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.trusted_contact.response.recorded',
          producer: 'garage-os-safety',
          correlation_id: grant.incident_id,
          subject_ids: {
            sos_incident: grant.incident_id,
            emergency_contact: grant.contact_id,
            trusted_contact_grant: grant.id,
            trusted_contact_response: record.id,
          },
          actor_id: grant.contact_id,
          actor_type: CanonicalActorType.TRUSTED_CONTACT,
          provenance_class: DataProvenanceClass.EXTERNALLY_VERIFIED,
          payload: {
            incident_id: grant.incident_id,
            grant_id: grant.id,
            contact_id: grant.contact_id,
            response,
            provider_assistance_state_changed: false,
          },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: grant.contact_id,
          actor_type: CanonicalActorType.TRUSTED_CONTACT,
          action: 'TRUSTED_CONTACT_RESPONSE_RECORDED',
          resource_type: 'sos_incident',
          resource_id: grant.incident_id,
          correlation_id: grant.incident_id,
          source: 'TRUSTED_CONTACT_PORTAL',
          metadata: {
            response,
            assistance_state_changed: false,
          },
        },
        db
      );
    });

    return this.resolvePortal(token);
  }

  listOwnerIncidentGrants(userId: string, incidentId: string) {
    const incident = sosRepository.getIncident(userId, incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'SOS incident not found', 404);
    }

    return trustedContactRepository.listIncidentGrants(incidentId).map((grant) => {
      const contact = safetyRepository.getContact(userId, grant.contact_id);
      const attempt = sosRepository.getNotificationAttempt(grant.notification_attempt_id);
      return {
        id: grant.id,
        contact_id: grant.contact_id,
        contact_name: contact?.display_name || 'Trusted contact',
        status: grant.status,
        expires_at: grant.expires_at,
        first_accessed_at: grant.first_accessed_at || null,
        last_accessed_at: grant.last_accessed_at || null,
        revoked_at: grant.revoked_at || null,
        notification_status: attempt?.status || null,
        latest_response: trustedContactRepository.getLatestResponse(grant.id),
      };
    });
  }

  revokeOwnerIncidentGrants(userId: string, incidentId: string): number {
    const incident = sosRepository.getIncident(userId, incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'SOS incident not found', 404);
    }
    return this.revokeIncidentGrants(incidentId, 'OWNER_REVOKED_TRUSTED_CONTACT_ACCESS');
  }

  revokeIncidentGrants(incidentId: string, reason: string): number {
    const now = getCurrentUtcIsoString();
    const grants = trustedContactRepository
      .listIncidentGrants(incidentId)
      .filter((grant) => grant.status === TrustedContactGrantStatus.ACTIVE);

    if (grants.length === 0) return 0;

    withTransaction(({ db }) => {
      for (const grant of grants) {
        trustedContactRepository.revokeGrant(grant.id, now);
        trustedContactRepository.recordAccessAudit({
          id: generateCanonicalId('tca'),
          grant_id: grant.id,
          incident_id: grant.incident_id,
          contact_id: grant.contact_id,
          action: 'ACCESS_GRANT_REVOKED',
          metadata: { reason },
          occurred_at: now,
        });
      }
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.trusted_contact.access_grants.revoked',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { sos_incident: incidentId },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            incident_id: incidentId,
            revoked_grant_count: grants.length,
            reason,
          },
        }),
        db
      );
    });

    return grants.length;
  }

  revokeContactGrants(contactId: string, reason = 'EMERGENCY_CONTACT_REVOKED'): number {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, incident_id FROM trusted_contact_access_grants
      WHERE contact_id = ? AND status = 'ACTIVE'
    `).all(contactId) as Array<{ id: string; incident_id: string }>;
    const now = getCurrentUtcIsoString();

    for (const row of rows) {
      trustedContactRepository.revokeGrant(row.id, now);
      trustedContactRepository.recordAccessAudit({
        id: generateCanonicalId('tca'),
        grant_id: row.id,
        incident_id: row.incident_id,
        contact_id: contactId,
        action: 'ACCESS_GRANT_REVOKED',
        metadata: { reason },
        occurred_at: now,
      });
    }
    return rows.length;
  }

  expireGrantIfDue(grantId: string, now = getCurrentUtcIsoString()): boolean {
    const grant = trustedContactRepository.getGrantById(grantId);
    if (
      !grant ||
      grant.status !== TrustedContactGrantStatus.ACTIVE ||
      grant.expires_at > now
    ) {
      return false;
    }

    withTransaction(({ db }) => {
      trustedContactRepository.expireGrant(grant.id, now);
      trustedContactRepository.recordAccessAudit({
        id: generateCanonicalId('tca'),
        grant_id: grant.id,
        incident_id: grant.incident_id,
        contact_id: grant.contact_id,
        action: 'ACCESS_GRANT_EXPIRED',
        occurred_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.trusted_contact.access_grant.expired',
          producer: 'garage-os-safety',
          correlation_id: grant.incident_id,
          subject_ids: {
            sos_incident: grant.incident_id,
            emergency_contact: grant.contact_id,
            trusted_contact_grant: grant.id,
          },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            grant_id: grant.id,
            incident_id: grant.incident_id,
            expired_at: now,
          },
        }),
        db
      );
    });
    return true;
  }

  expireDueGrants(now = getCurrentUtcIsoString()): number {
    return trustedContactRepository.expireDueGrants(now);
  }

  private requireActiveGrant(token: string, touch: boolean): TrustedContactAccessGrant {
    if (!token || token.length > 512) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Trusted-contact link is invalid', 401);
    }

    const grantId = parseGrantId(token);
    if (!grantId) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Trusted-contact link is invalid', 401);
    }

    const grant = trustedContactRepository.getGrantById(grantId);
    if (!grant || !safeEqual(grant.token_digest, digestToken(token))) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Trusted-contact link is invalid', 401);
    }

    const now = getCurrentUtcIsoString();
    if (grant.status === TrustedContactGrantStatus.ACTIVE && grant.expires_at <= now) {
      this.expireGrantIfDue(grant.id, now);
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Trusted-contact link has expired', 401);
    }

    if (grant.status !== TrustedContactGrantStatus.ACTIVE) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Trusted-contact link is no longer active', 401);
    }

    if (touch) {
      trustedContactRepository.touchGrant(grant.id, now);
      trustedContactRepository.recordAccessAudit({
        id: generateCanonicalId('tca'),
        grant_id: grant.id,
        incident_id: grant.incident_id,
        contact_id: grant.contact_id,
        action: 'PORTAL_VIEWED',
        occurred_at: now,
      });
    }

    return trustedContactRepository.getGrantById(grant.id)!;
  }
}

export const trustedContactService = new TrustedContactService();
