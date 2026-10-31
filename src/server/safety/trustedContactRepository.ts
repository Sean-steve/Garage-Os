import { getDatabase } from '../database/connection';
import {
  TrustedContactAccessGrant,
  TrustedContactGrantStatus,
  TrustedContactResponse,
  TrustedContactResponseRecord,
} from './types';

function mapGrant(row: any): TrustedContactAccessGrant {
  return {
    id: String(row.id),
    incident_id: String(row.incident_id),
    contact_id: String(row.contact_id),
    notification_attempt_id: String(row.notification_attempt_id),
    token_digest: String(row.token_digest),
    status: row.status as TrustedContactGrantStatus,
    expires_at: String(row.expires_at),
    first_accessed_at: row.first_accessed_at ? String(row.first_accessed_at) : null,
    last_accessed_at: row.last_accessed_at ? String(row.last_accessed_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapResponse(row: any): TrustedContactResponseRecord {
  return {
    id: String(row.id),
    grant_id: String(row.grant_id),
    incident_id: String(row.incident_id),
    contact_id: String(row.contact_id),
    response: row.response as TrustedContactResponse,
    created_at: String(row.created_at),
  };
}

export class TrustedContactRepository {
  createGrant(grant: TrustedContactAccessGrant): void {
    getDatabase().prepare(`
      INSERT INTO trusted_contact_access_grants (
        id, incident_id, contact_id, notification_attempt_id, token_digest,
        status, expires_at, first_accessed_at, last_accessed_at, revoked_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      grant.id,
      grant.incident_id,
      grant.contact_id,
      grant.notification_attempt_id,
      grant.token_digest,
      grant.status,
      grant.expires_at,
      grant.first_accessed_at || null,
      grant.last_accessed_at || null,
      grant.revoked_at || null,
      grant.created_at,
      grant.updated_at
    );
  }

  getGrantByNotificationAttempt(notificationAttemptId: string): TrustedContactAccessGrant | null {
    const row = getDatabase().prepare(
      'SELECT * FROM trusted_contact_access_grants WHERE notification_attempt_id = ? LIMIT 1'
    ).get(notificationAttemptId) as any | undefined;
    return row ? mapGrant(row) : null;
  }

  getGrantById(grantId: string): TrustedContactAccessGrant | null {
    const row = getDatabase().prepare(
      'SELECT * FROM trusted_contact_access_grants WHERE id = ? LIMIT 1'
    ).get(grantId) as any | undefined;
    return row ? mapGrant(row) : null;
  }

  listIncidentGrants(incidentId: string): TrustedContactAccessGrant[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM trusted_contact_access_grants
      WHERE incident_id = ?
      ORDER BY created_at ASC
    `).all(incidentId) as any[];
    return rows.map(mapGrant);
  }

  touchGrant(grantId: string, now: string): void {
    getDatabase().prepare(`
      UPDATE trusted_contact_access_grants
      SET first_accessed_at = COALESCE(first_accessed_at, ?),
          last_accessed_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(now, now, now, grantId);
  }

  expireGrant(grantId: string, now: string): void {
    getDatabase().prepare(`
      UPDATE trusted_contact_access_grants
      SET status = 'EXPIRED', updated_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(now, grantId);
  }

  revokeGrant(grantId: string, now: string): void {
    getDatabase().prepare(`
      UPDATE trusted_contact_access_grants
      SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
      WHERE id = ? AND status = 'ACTIVE'
    `).run(now, now, grantId);
  }

  revokeIncidentGrants(incidentId: string, now: string): number {
    const result = getDatabase().prepare(`
      UPDATE trusted_contact_access_grants
      SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, ?), updated_at = ?
      WHERE incident_id = ? AND status = 'ACTIVE'
    `).run(now, now, incidentId);
    return Number(result.changes || 0);
  }

  expireDueGrants(now: string): number {
    const result = getDatabase().prepare(`
      UPDATE trusted_contact_access_grants
      SET status = 'EXPIRED', updated_at = ?
      WHERE status = 'ACTIVE' AND expires_at <= ?
    `).run(now, now);
    return Number(result.changes || 0);
  }

  insertResponse(response: TrustedContactResponseRecord): void {
    getDatabase().prepare(`
      INSERT INTO trusted_contact_responses (
        id, grant_id, incident_id, contact_id, response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      response.id,
      response.grant_id,
      response.incident_id,
      response.contact_id,
      response.response,
      response.created_at
    );
  }

  getLatestResponse(grantId: string): TrustedContactResponseRecord | null {
    const row = getDatabase().prepare(`
      SELECT * FROM trusted_contact_responses
      WHERE grant_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(grantId) as any | undefined;
    return row ? mapResponse(row) : null;
  }

  recordAccessAudit(params: {
    id: string;
    grant_id: string;
    incident_id: string;
    contact_id: string;
    action: string;
    metadata?: Record<string, unknown>;
    occurred_at: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO trusted_contact_access_audit (
        id, grant_id, incident_id, contact_id, action, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.grant_id,
      params.incident_id,
      params.contact_id,
      params.action,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.occurred_at
    );
  }
}

export const trustedContactRepository = new TrustedContactRepository();
