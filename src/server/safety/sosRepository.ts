import { getDatabase } from '../database/connection';
import {
  SosIncident,
  SosIncidentStatus,
  SosLocationSnapshot,
  SosNotificationAttempt,
  SosNotificationStatus,
  SosSafetyCheck,
  SosSafetyCheckResponse,
  SosSafetyCheckStatus,
  SafetyIncidentLevel,
} from './types';

function bool(v: unknown): boolean {
  return Boolean(v);
}

function mapIncident(row: any): SosIncident {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    vehicle_id: row.vehicle_id ? String(row.vehicle_id) : null,
    incident_level: row.incident_level as SafetyIncidentLevel,
    incident_type: String(row.incident_type),
    status: row.status as SosIncidentStatus,
    activation_source: String(row.activation_source),
    activation_attempted_at: String(row.activation_attempted_at),
    server_acknowledged_at: String(row.server_acknowledged_at),
    cancel_deadline_at: String(row.cancel_deadline_at),
    activated_at: row.activated_at ? String(row.activated_at) : null,
    cancelled_at: row.cancelled_at ? String(row.cancelled_at) : null,
    closed_at: row.closed_at ? String(row.closed_at) : null,
    cancellation_reason: row.cancellation_reason ? String(row.cancellation_reason) : null,
    closure_reason: row.closure_reason ? String(row.closure_reason) : null,
    notification_state: String(row.notification_state),
    safety_check_state: String(row.safety_check_state),
    assistance_state: String(row.assistance_state),
    version: Number(row.version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapLocation(row: any): SosLocationSnapshot {
  return {
    id: String(row.id),
    incident_id: String(row.incident_id),
    user_id: String(row.user_id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy_meters: row.accuracy_meters == null ? null : Number(row.accuracy_meters),
    captured_at: String(row.captured_at),
    purpose: String(row.purpose),
    source_type: String(row.source_type),
    sharing_authorized: bool(row.sharing_authorized),
    expires_at: String(row.expires_at),
    access_revoked_at: row.access_revoked_at ? String(row.access_revoked_at) : null,
    created_at: String(row.created_at),
  };
}

function mapNotification(row: any): SosNotificationAttempt {
  return {
    id: String(row.id),
    incident_id: String(row.incident_id),
    contact_id: String(row.contact_id),
    priority: Number(row.priority),
    channel: row.channel,
    status: row.status as SosNotificationStatus,
    share_incident_type: bool(row.share_incident_type),
    share_vehicle_summary: bool(row.share_vehicle_summary),
    share_live_location: bool(row.share_live_location),
    share_assistance_status: bool(row.share_assistance_status),
    share_callback_number: bool(row.share_callback_number),
    provider_name: row.provider_name ? String(row.provider_name) : null,
    provider_message_id: row.provider_message_id ? String(row.provider_message_id) : null,
    queued_at: String(row.queued_at),
    attempted_at: row.attempted_at ? String(row.attempted_at) : null,
    provider_accepted_at: row.provider_accepted_at ? String(row.provider_accepted_at) : null,
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    failed_at: row.failed_at ? String(row.failed_at) : null,
    failure_code: row.failure_code ? String(row.failure_code) : null,
    failure_message: row.failure_message ? String(row.failure_message) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapSafetyCheck(row: any): SosSafetyCheck {
  return {
    id: String(row.id),
    incident_id: String(row.incident_id),
    user_id: String(row.user_id),
    status: row.status as SosSafetyCheckStatus,
    prompted_at: String(row.prompted_at),
    due_at: String(row.due_at),
    responded_at: row.responded_at ? String(row.responded_at) : null,
    response: row.response ? (String(row.response) as SosSafetyCheckResponse) : null,
    response_notes: row.response_notes ? String(row.response_notes) : null,
    timed_out_at: row.timed_out_at ? String(row.timed_out_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class SosRepository {
  createIncident(incident: SosIncident): void {
    getDatabase().prepare(`
      INSERT INTO sos_incidents (
        id, user_id, vehicle_id, incident_level, incident_type, status,
        activation_source, activation_attempted_at, server_acknowledged_at,
        cancel_deadline_at, activated_at, cancelled_at, closed_at,
        cancellation_reason, closure_reason, notification_state,
        safety_check_state, assistance_state, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incident.id, incident.user_id, incident.vehicle_id || null, incident.incident_level,
      incident.incident_type, incident.status, incident.activation_source,
      incident.activation_attempted_at, incident.server_acknowledged_at,
      incident.cancel_deadline_at, incident.activated_at || null,
      incident.cancelled_at || null, incident.closed_at || null,
      incident.cancellation_reason || null, incident.closure_reason || null,
      incident.notification_state, incident.safety_check_state, incident.assistance_state,
      incident.version, incident.created_at, incident.updated_at
    );
  }

  getIncident(userId: string, incidentId: string): SosIncident | null {
    const row = getDatabase().prepare(
      'SELECT * FROM sos_incidents WHERE id = ? AND user_id = ? LIMIT 1'
    ).get(incidentId, userId) as any | undefined;
    return row ? mapIncident(row) : null;
  }

  getIncidentById(incidentId: string): SosIncident | null {
    const row = getDatabase().prepare(
      'SELECT * FROM sos_incidents WHERE id = ? LIMIT 1'
    ).get(incidentId) as any | undefined;
    return row ? mapIncident(row) : null;
  }

  getActiveIncident(userId: string): SosIncident | null {
    const row = getDatabase().prepare(`
      SELECT * FROM sos_incidents
      WHERE user_id = ? AND status IN ('COUNTDOWN', 'ACTIVATED')
      ORDER BY created_at DESC LIMIT 1
    `).get(userId) as any | undefined;
    return row ? mapIncident(row) : null;
  }

  listIncidents(userId: string, limit = 20): SosIncident[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM sos_incidents
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as any[];
    return rows.map(mapIncident);
  }

  createActivationAttempt(params: {
    id: string;
    incident_id: string;
    user_id: string;
    client_requested_at?: string | null;
    server_received_at: string;
    server_acknowledged_at: string;
    activation_source: string;
    status: 'ACKNOWLEDGED' | 'CANCELLED' | 'ACTIVATED' | 'FAILED';
    created_at: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO sos_activation_attempts (
        id, incident_id, user_id, attempt_number, client_requested_at,
        server_received_at, server_acknowledged_at, activation_source, status, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id, params.incident_id, params.user_id, params.client_requested_at || null,
      params.server_received_at, params.server_acknowledged_at, params.activation_source,
      params.status, params.created_at
    );
  }

  updateActivationAttemptStatus(incidentId: string, status: 'ACKNOWLEDGED' | 'CANCELLED' | 'ACTIVATED' | 'FAILED'): void {
    getDatabase().prepare(
      'UPDATE sos_activation_attempts SET status = ? WHERE incident_id = ?'
    ).run(status, incidentId);
  }

  transitionIncident(params: {
    incident_id: string;
    expected_status: SosIncidentStatus;
    next_status: SosIncidentStatus;
    now: string;
    activated_at?: string | null;
    cancelled_at?: string | null;
    closed_at?: string | null;
    cancellation_reason?: string | null;
    closure_reason?: string | null;
    notification_state?: string;
    safety_check_state?: string;
    assistance_state?: string;
  }): boolean {
    const result = getDatabase().prepare(`
      UPDATE sos_incidents
      SET status = ?,
          activated_at = COALESCE(?, activated_at),
          cancelled_at = COALESCE(?, cancelled_at),
          closed_at = COALESCE(?, closed_at),
          cancellation_reason = COALESCE(?, cancellation_reason),
          closure_reason = COALESCE(?, closure_reason),
          notification_state = COALESCE(?, notification_state),
          safety_check_state = COALESCE(?, safety_check_state),
          assistance_state = COALESCE(?, assistance_state),
          version = version + 1,
          updated_at = ?
      WHERE id = ? AND status = ?
    `).run(
      params.next_status,
      params.activated_at || null,
      params.cancelled_at || null,
      params.closed_at || null,
      params.cancellation_reason || null,
      params.closure_reason || null,
      params.notification_state || null,
      params.safety_check_state || null,
      params.assistance_state || null,
      params.now,
      params.incident_id,
      params.expected_status
    );
    return Number(result.changes || 0) === 1;
  }

  updateIncidentStates(incidentId: string, params: {
    notification_state?: string;
    safety_check_state?: string;
    assistance_state?: string;
    now: string;
  }): void {
    getDatabase().prepare(`
      UPDATE sos_incidents
      SET notification_state = COALESCE(?, notification_state),
          safety_check_state = COALESCE(?, safety_check_state),
          assistance_state = COALESCE(?, assistance_state),
          version = version + 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      params.notification_state || null,
      params.safety_check_state || null,
      params.assistance_state || null,
      params.now,
      incidentId
    );
  }

  insertLocation(location: SosLocationSnapshot): void {
    getDatabase().prepare(`
      INSERT INTO sos_location_snapshots (
        id, incident_id, user_id, latitude, longitude, accuracy_meters,
        captured_at, purpose, source_type, sharing_authorized, expires_at,
        access_revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      location.id, location.incident_id, location.user_id, location.latitude,
      location.longitude, location.accuracy_meters || null, location.captured_at,
      location.purpose, location.source_type, location.sharing_authorized ? 1 : 0,
      location.expires_at, location.access_revoked_at || null, location.created_at
    );
  }

  getActiveLocation(incidentId: string, now: string): SosLocationSnapshot | null {
    const row = getDatabase().prepare(`
      SELECT * FROM sos_location_snapshots
      WHERE incident_id = ? AND expires_at > ? AND access_revoked_at IS NULL
      ORDER BY captured_at DESC LIMIT 1
    `).get(incidentId, now) as any | undefined;
    return row ? mapLocation(row) : null;
  }

  revokeIncidentLocation(incidentId: string, now: string): void {
    getDatabase().prepare(`
      UPDATE sos_location_snapshots
      SET access_revoked_at = COALESCE(access_revoked_at, ?)
      WHERE incident_id = ?
    `).run(now, incidentId);
  }

  pruneExpiredLocations(now: string): number {
    const result = getDatabase().prepare(
      'DELETE FROM sos_location_snapshots WHERE expires_at <= ?'
    ).run(now);
    return Number(result.changes || 0);
  }

  createNotificationAttempt(attempt: SosNotificationAttempt): void {
    getDatabase().prepare(`
      INSERT INTO sos_contact_notification_attempts (
        id, incident_id, contact_id, priority, channel, status,
        share_incident_type, share_vehicle_summary, share_live_location,
        share_assistance_status, share_callback_number, provider_name,
        provider_message_id, queued_at, attempted_at, provider_accepted_at,
        delivered_at, failed_at, failure_code, failure_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.id, attempt.incident_id, attempt.contact_id, attempt.priority,
      attempt.channel, attempt.status, attempt.share_incident_type ? 1 : 0,
      attempt.share_vehicle_summary ? 1 : 0, attempt.share_live_location ? 1 : 0,
      attempt.share_assistance_status ? 1 : 0, attempt.share_callback_number ? 1 : 0,
      attempt.provider_name || null, attempt.provider_message_id || null,
      attempt.queued_at, attempt.attempted_at || null, attempt.provider_accepted_at || null,
      attempt.delivered_at || null, attempt.failed_at || null,
      attempt.failure_code || null, attempt.failure_message || null,
      attempt.created_at, attempt.updated_at
    );
  }

  listNotificationAttempts(incidentId: string): SosNotificationAttempt[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM sos_contact_notification_attempts
      WHERE incident_id = ?
      ORDER BY priority ASC, queued_at ASC
    `).all(incidentId) as any[];
    return rows.map(mapNotification);
  }

  getNotificationAttempt(attemptId: string): SosNotificationAttempt | null {
    const row = getDatabase().prepare(
      'SELECT * FROM sos_contact_notification_attempts WHERE id = ? LIMIT 1'
    ).get(attemptId) as any | undefined;
    return row ? mapNotification(row) : null;
  }

  updateNotificationAttempt(attemptId: string, params: {
    status: SosNotificationStatus;
    provider_name?: string | null;
    provider_message_id?: string | null;
    attempted_at?: string | null;
    provider_accepted_at?: string | null;
    delivered_at?: string | null;
    failed_at?: string | null;
    failure_code?: string | null;
    failure_message?: string | null;
    updated_at: string;
  }): void {
    getDatabase().prepare(`
      UPDATE sos_contact_notification_attempts
      SET status = ?,
          provider_name = COALESCE(?, provider_name),
          provider_message_id = COALESCE(?, provider_message_id),
          attempted_at = COALESCE(?, attempted_at),
          provider_accepted_at = COALESCE(?, provider_accepted_at),
          delivered_at = COALESCE(?, delivered_at),
          failed_at = COALESCE(?, failed_at),
          failure_code = COALESCE(?, failure_code),
          failure_message = COALESCE(?, failure_message),
          updated_at = ?
      WHERE id = ?
    `).run(
      params.status,
      params.provider_name || null,
      params.provider_message_id || null,
      params.attempted_at || null,
      params.provider_accepted_at || null,
      params.delivered_at || null,
      params.failed_at || null,
      params.failure_code || null,
      params.failure_message || null,
      params.updated_at,
      attemptId
    );
  }

  createSafetyCheck(check: SosSafetyCheck): void {
    getDatabase().prepare(`
      INSERT INTO sos_safety_checks (
        id, incident_id, user_id, status, prompted_at, due_at,
        responded_at, response, response_notes, timed_out_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      check.id, check.incident_id, check.user_id, check.status,
      check.prompted_at, check.due_at, check.responded_at || null,
      check.response || null, check.response_notes || null,
      check.timed_out_at || null, check.created_at, check.updated_at
    );
  }

  getSafetyCheck(incidentId: string): SosSafetyCheck | null {
    const row = getDatabase().prepare(`
      SELECT * FROM sos_safety_checks
      WHERE incident_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(incidentId) as any | undefined;
    return row ? mapSafetyCheck(row) : null;
  }

  respondSafetyCheck(checkId: string, response: SosSafetyCheckResponse, notes: string | null, now: string): boolean {
    const result = getDatabase().prepare(`
      UPDATE sos_safety_checks
      SET status = 'RESPONDED', response = ?, response_notes = ?,
          responded_at = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).run(response, notes, now, now, checkId);
    return Number(result.changes || 0) === 1;
  }

  timeoutSafetyCheck(checkId: string, now: string): boolean {
    const result = getDatabase().prepare(`
      UPDATE sos_safety_checks
      SET status = 'TIMED_OUT', timed_out_at = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING' AND due_at <= ?
    `).run(now, now, checkId, now);
    return Number(result.changes || 0) === 1;
  }

  recordStatusHistory(params: {
    id: string;
    incident_id: string;
    from_status?: string | null;
    to_status: string;
    actor_id?: string | null;
    actor_type?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    occurred_at: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO sos_status_history (
        id, incident_id, from_status, to_status, actor_id,
        actor_type, reason, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id, params.incident_id, params.from_status || null,
      params.to_status, params.actor_id || null, params.actor_type || null,
      params.reason || null, params.metadata ? JSON.stringify(params.metadata) : null,
      params.occurred_at
    );
  }
}

export const sosRepository = new SosRepository();
