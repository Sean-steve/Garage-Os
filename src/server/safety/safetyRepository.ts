import { getDatabase } from '../database/connection';
import {
  EmergencyContact,
  EmergencyContactScope,
  EmergencyContactStatus,
  EmergencyContactVerificationStatus,
  HumanSafetyPreferences,
  SafetyIncidentLevel,
} from './types';

function bool(value: unknown): boolean {
  return Boolean(value);
}

function mapScope(row: any): EmergencyContactScope {
  return {
    id: String(row.id),
    contact_id: String(row.contact_id),
    incident_level: row.incident_level as SafetyIncidentLevel,
    notify_contact: bool(row.notify_contact),
    share_incident_type: bool(row.share_incident_type),
    share_vehicle_summary: bool(row.share_vehicle_summary),
    share_live_location: bool(row.share_live_location),
    share_assistance_status: bool(row.share_assistance_status),
    share_callback_number: bool(row.share_callback_number),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapPreferences(row: any): HumanSafetyPreferences {
  return {
    user_id: String(row.user_id),
    emergency_circle_enabled: bool(row.emergency_circle_enabled),
    allow_location_sharing: bool(row.allow_location_sharing),
    safety_check_enabled: bool(row.safety_check_enabled),
    safety_check_timeout_seconds: Number(row.safety_check_timeout_seconds),
    sos_cancel_countdown_seconds: Number(row.sos_cancel_countdown_seconds),
    escalation_sequence_enabled: bool(row.escalation_sequence_enabled),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class SafetyRepository {
  listContacts(userId: string, includeRevoked = false): EmergencyContact[] {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT * FROM emergency_contacts
       WHERE user_id = ? ${includeRevoked ? '' : "AND status = 'ACTIVE'"}
       ORDER BY priority ASC, created_at ASC`
    ).all(userId) as any[];

    return rows.map((row) => this.hydrateContact(row));
  }

  getContact(userId: string, contactId: string): EmergencyContact | null {
    const row = getDatabase()
      .prepare('SELECT * FROM emergency_contacts WHERE id = ? AND user_id = ? LIMIT 1')
      .get(contactId, userId) as any | undefined;
    return row ? this.hydrateContact(row) : null;
  }

  getContactByPhoneOrEmail(userId: string, phone?: string | null, email?: string | null): EmergencyContact | null {
    if (!phone && !email) return null;
    const row = getDatabase().prepare(`
      SELECT * FROM emergency_contacts
      WHERE user_id = ?
        AND status = 'ACTIVE'
        AND ((? IS NOT NULL AND phone_e164 = ?) OR (? IS NOT NULL AND lower(email) = lower(?)))
      LIMIT 1
    `).get(userId, phone || null, phone || null, email || null, email || null) as any | undefined;
    return row ? this.hydrateContact(row) : null;
  }

  insertContact(contact: Omit<EmergencyContact, 'scopes'>): void {
    getDatabase().prepare(`
      INSERT INTO emergency_contacts (
        id, user_id, display_name, relationship_label, phone_e164, email,
        priority, status, verification_status, created_at, updated_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contact.id,
      contact.user_id,
      contact.display_name,
      contact.relationship_label || null,
      contact.phone_e164 || null,
      contact.email || null,
      contact.priority,
      contact.status,
      contact.verification_status,
      contact.created_at,
      contact.updated_at,
      contact.revoked_at || null
    );
  }

  updateContact(userId: string, contactId: string, values: {
    display_name: string;
    relationship_label?: string | null;
    phone_e164?: string | null;
    email?: string | null;
    priority: number;
    updated_at: string;
  }): void {
    getDatabase().prepare(`
      UPDATE emergency_contacts
      SET display_name = ?, relationship_label = ?, phone_e164 = ?, email = ?,
          priority = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'ACTIVE'
    `).run(
      values.display_name,
      values.relationship_label || null,
      values.phone_e164 || null,
      values.email || null,
      values.priority,
      values.updated_at,
      contactId,
      userId
    );
  }

  revokeContact(userId: string, contactId: string, revokedAt: string): void {
    getDatabase().prepare(`
      UPDATE emergency_contacts
      SET status = 'REVOKED', revoked_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'ACTIVE'
    `).run(revokedAt, revokedAt, contactId, userId);
  }

  listScopes(contactId: string): EmergencyContactScope[] {
    const rows = getDatabase()
      .prepare('SELECT * FROM emergency_contact_scopes WHERE contact_id = ? ORDER BY incident_level ASC')
      .all(contactId) as any[];
    return rows.map(mapScope);
  }

  upsertScope(scope: EmergencyContactScope): void {
    getDatabase().prepare(`
      INSERT INTO emergency_contact_scopes (
        id, contact_id, incident_level, notify_contact, share_incident_type,
        share_vehicle_summary, share_live_location, share_assistance_status,
        share_callback_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, incident_level) DO UPDATE SET
        notify_contact = excluded.notify_contact,
        share_incident_type = excluded.share_incident_type,
        share_vehicle_summary = excluded.share_vehicle_summary,
        share_live_location = excluded.share_live_location,
        share_assistance_status = excluded.share_assistance_status,
        share_callback_number = excluded.share_callback_number,
        updated_at = excluded.updated_at
    `).run(
      scope.id,
      scope.contact_id,
      scope.incident_level,
      scope.notify_contact ? 1 : 0,
      scope.share_incident_type ? 1 : 0,
      scope.share_vehicle_summary ? 1 : 0,
      scope.share_live_location ? 1 : 0,
      scope.share_assistance_status ? 1 : 0,
      scope.share_callback_number ? 1 : 0,
      scope.created_at,
      scope.updated_at
    );
  }

  getPreferences(userId: string): HumanSafetyPreferences | null {
    const row = getDatabase()
      .prepare('SELECT * FROM human_safety_preferences WHERE user_id = ? LIMIT 1')
      .get(userId) as any | undefined;
    return row ? mapPreferences(row) : null;
  }

  upsertPreferences(preferences: HumanSafetyPreferences): void {
    getDatabase().prepare(`
      INSERT INTO human_safety_preferences (
        user_id, emergency_circle_enabled, allow_location_sharing,
        safety_check_enabled, safety_check_timeout_seconds,
        sos_cancel_countdown_seconds, escalation_sequence_enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        emergency_circle_enabled = excluded.emergency_circle_enabled,
        allow_location_sharing = excluded.allow_location_sharing,
        safety_check_enabled = excluded.safety_check_enabled,
        safety_check_timeout_seconds = excluded.safety_check_timeout_seconds,
        sos_cancel_countdown_seconds = excluded.sos_cancel_countdown_seconds,
        escalation_sequence_enabled = excluded.escalation_sequence_enabled,
        updated_at = excluded.updated_at
    `).run(
      preferences.user_id,
      preferences.emergency_circle_enabled ? 1 : 0,
      preferences.allow_location_sharing ? 1 : 0,
      preferences.safety_check_enabled ? 1 : 0,
      preferences.safety_check_timeout_seconds,
      preferences.sos_cancel_countdown_seconds,
      preferences.escalation_sequence_enabled ? 1 : 0,
      preferences.created_at,
      preferences.updated_at
    );
  }

  recordHistory(params: {
    id: string;
    user_id: string;
    change_type: string;
    subject_id?: string;
    summary: Record<string, unknown>;
    actor_id: string;
    created_at: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO safety_configuration_history (
        id, user_id, change_type, subject_id, summary_json, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.user_id,
      params.change_type,
      params.subject_id || null,
      JSON.stringify(params.summary),
      params.actor_id,
      params.created_at
    );
  }

  private hydrateContact(row: any): EmergencyContact {
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      display_name: String(row.display_name),
      relationship_label: row.relationship_label ? String(row.relationship_label) : null,
      phone_e164: row.phone_e164 ? String(row.phone_e164) : null,
      email: row.email ? String(row.email) : null,
      priority: Number(row.priority),
      status: row.status as EmergencyContactStatus,
      verification_status: row.verification_status as EmergencyContactVerificationStatus,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      revoked_at: row.revoked_at ? String(row.revoked_at) : null,
      scopes: this.listScopes(String(row.id)),
    };
  }
}

export const safetyRepository = new SafetyRepository();
