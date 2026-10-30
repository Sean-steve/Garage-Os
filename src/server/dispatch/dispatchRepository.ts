/**
 * Garage OS — Sprint 14: Dispatch Repository (GAR-016)
 * Data access layer for dispatch requests, attempts, candidates, and tracking projections.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import {
  DispatchRequestEntity,
  DispatchAttemptEntity,
  DispatchCandidateEntity,
  DispatchTrackingProjectionEntity,
  DispatchReconciliationRecordEntity,
  DispatchManualOverrideEntity,
  DispatchRequestStatus,
  DispatchAttemptStatus,
  TrackingAccessStatus,
} from './types';

export class DispatchRepository {
  /**
   * Create a new dispatch request
   */
  createRequest(request: DispatchRequestEntity, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      INSERT INTO dispatch_requests (
        id, dispatch_domain, source_reference_type, source_reference_id,
        required_capability, pickup_latitude, pickup_longitude, pickup_address,
        destination_latitude, destination_longitude, destination_address, vehicle_id,
        priority, status, strategy, strategy_version, current_attempt_number, active_attempt_id,
        assigned_provider_id, assigned_responder_type, assigned_responder_id, lock_version,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      request.id,
      request.dispatch_domain,
      request.source_reference_type,
      request.source_reference_id,
      request.required_capability,
      request.pickup_latitude,
      request.pickup_longitude,
      request.pickup_address ?? null,
      request.destination_latitude ?? null,
      request.destination_longitude ?? null,
      request.destination_address ?? null,
      request.vehicle_id ?? null,
      request.priority,
      request.status,
      request.strategy,
      request.strategy_version,
      request.current_attempt_number || 1,
      request.active_attempt_id ?? null,
      request.assigned_provider_id ?? null,
      request.assigned_responder_type ?? null,
      request.assigned_responder_id ?? null,
      request.lock_version || 1,
      request.created_at,
      request.updated_at,
      request.completed_at ?? null
    );
  }

  /**
   * Get dispatch request by ID
   */
  getRequestById(id: string, customDb?: DatabaseSync): DispatchRequestEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`SELECT * FROM dispatch_requests WHERE id = ?;`).get(id) as any;
    if (!row) return null;
    return this.mapRequest(row);
  }

  /**
   * Get dispatch request by source reference
   */
  getRequestBySource(sourceType: string, sourceId: string, customDb?: DatabaseSync): DispatchRequestEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`
      SELECT * FROM dispatch_requests
      WHERE source_reference_type = ? AND source_reference_id = ?
      ORDER BY created_at DESC LIMIT 1;
    `).get(sourceType, sourceId) as any;
    if (!row) return null;
    return this.mapRequest(row);
  }

  /**
   * Update dispatch request
   */
  updateRequest(id: string, updates: Partial<DispatchRequestEntity>, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as any)[k]);

    db.prepare(`UPDATE dispatch_requests SET ${setClauses} WHERE id = ?;`).run(...values, id);
  }

  /**
   * List all requests with optional status filter
   */
  listRequests(status?: string, customDb?: DatabaseSync): DispatchRequestEntity[] {
    const db = customDb || getDatabase();
    let query = 'SELECT * FROM dispatch_requests';
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    const rows = db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRequest(r));
  }

  /**
   * Create a dispatch attempt
   */
  createAttempt(attempt: DispatchAttemptEntity, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      INSERT INTO dispatch_attempts (
        id, dispatch_request_id, attempt_number, strategy,
        search_radius_km, candidate_ids_json, status, failure_reason,
        started_at, expires_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      attempt.id,
      attempt.dispatch_request_id,
      attempt.attempt_number,
      attempt.strategy,
      attempt.search_radius_km,
      attempt.candidate_ids_json,
      attempt.status,
      attempt.failure_reason ?? null,
      attempt.started_at,
      attempt.expires_at ?? null,
      attempt.completed_at ?? null,
      attempt.created_at
    );
  }

  /**
   * Get attempt by ID
   */
  getAttemptById(id: string, customDb?: DatabaseSync): DispatchAttemptEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`SELECT * FROM dispatch_attempts WHERE id = ?;`).get(id) as any;
    if (!row) return null;
    return row as DispatchAttemptEntity;
  }

  /**
   * Get all attempts for a request
   */
  getAttemptsByRequest(requestId: string, customDb?: DatabaseSync): DispatchAttemptEntity[] {
    const db = customDb || getDatabase();
    const rows = db.prepare(`
      SELECT * FROM dispatch_attempts
      WHERE dispatch_request_id = ?
      ORDER BY attempt_number ASC;
    `).all(requestId) as any[];
    return rows as DispatchAttemptEntity[];
  }

  /**
   * Update dispatch attempt
   */
  updateAttempt(id: string, updates: Partial<DispatchAttemptEntity>, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as any)[k]);

    db.prepare(`UPDATE dispatch_attempts SET ${setClauses} WHERE id = ?;`).run(...values, id);
  }

  /**
   * Save evaluated candidates
   */
  saveCandidates(candidates: DispatchCandidateEntity[], customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    const stmt = db.prepare(`
      INSERT INTO dispatch_candidates (
        id, dispatch_request_id, dispatch_attempt_id, provider_id,
        responder_type, responder_reference_id, eligibility_status,
        distance_meters, distance_type, eta_seconds, eta_source,
        location_freshness, availability_state, capability_score,
        distance_score, eta_score, workload_score, overall_score,
        rank, exclusion_reason, strategy_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    for (const c of candidates) {
      stmt.run(
        c.id,
        c.dispatch_request_id,
        c.dispatch_attempt_id,
        c.provider_id,
        c.responder_type,
        c.responder_reference_id,
        c.eligibility_status,
        c.distance_meters ?? null,
        c.distance_type ?? null,
        c.eta_seconds ?? null,
        c.eta_source ?? null,
        c.location_freshness ?? null,
        c.availability_state ?? null,
        c.capability_score,
        c.distance_score,
        c.eta_score,
        c.workload_score,
        c.overall_score,
        c.rank ?? null,
        c.exclusion_reason ?? null,
        c.strategy_version,
        c.created_at
      );
    }
  }

  /**
   * Get candidates for a request
   */
  getCandidatesByRequest(requestId: string, customDb?: DatabaseSync): DispatchCandidateEntity[] {
    const db = customDb || getDatabase();
    const rows = db.prepare(`
      SELECT * FROM dispatch_candidates
      WHERE dispatch_request_id = ?
      ORDER BY rank IS NULL, rank ASC, overall_score DESC;
    `).all(requestId) as any[];

    return rows.map((r) => r as DispatchCandidateEntity);
  }

  /**
   * Upsert Tracking Projection
   */
  saveTrackingProjection(projection: DispatchTrackingProjectionEntity, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      INSERT INTO dispatch_tracking_projections (
        id, dispatch_request_id, assignment_id, assignment_domain,
        assignment_status, customer_user_id, responder_display_name, responder_unit_summary,
        latitude, longitude, accuracy_meters, location_freshness,
        location_captured_at, eta_arrival_at, eta_duration_seconds,
        eta_source, eta_calculated_at, eta_freshness, tracking_access_status,
        is_tracking_active, stale_warning, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        assignment_status = excluded.assignment_status,
        customer_user_id = COALESCE(excluded.customer_user_id, dispatch_tracking_projections.customer_user_id),
        responder_display_name = excluded.responder_display_name,
        responder_unit_summary = excluded.responder_unit_summary,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_meters = excluded.accuracy_meters,
        location_freshness = excluded.location_freshness,
        location_captured_at = excluded.location_captured_at,
        eta_arrival_at = excluded.eta_arrival_at,
        eta_duration_seconds = excluded.eta_duration_seconds,
        eta_source = excluded.eta_source,
        eta_calculated_at = excluded.eta_calculated_at,
        eta_freshness = excluded.eta_freshness,
        tracking_access_status = excluded.tracking_access_status,
        is_tracking_active = excluded.is_tracking_active,
        stale_warning = excluded.stale_warning,
        last_updated_at = excluded.last_updated_at;
    `).run(
      projection.id,
      projection.dispatch_request_id,
      projection.assignment_id,
      projection.assignment_domain,
      projection.assignment_status,
      projection.customer_user_id ?? null,
      projection.responder_display_name,
      projection.responder_unit_summary ?? null,
      projection.latitude ?? null,
      projection.longitude ?? null,
      projection.accuracy_meters ?? null,
      projection.location_freshness,
      projection.location_captured_at ?? null,
      projection.eta_arrival_at ?? null,
      projection.eta_duration_seconds ?? null,
      projection.eta_source ?? null,
      projection.eta_calculated_at ?? null,
      projection.eta_freshness,
      projection.tracking_access_status,
      projection.is_tracking_active ?? 1,
      projection.stale_warning ?? null,
      projection.last_updated_at
    );
  }

  /**
   * Get tracking projection by assignment ID
   */
  getTrackingProjectionByAssignment(assignmentId: string, customDb?: DatabaseSync): DispatchTrackingProjectionEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`
      SELECT * FROM dispatch_tracking_projections WHERE assignment_id = ?;
    `).get(assignmentId) as any;
    if (!row) return null;
    return row as DispatchTrackingProjectionEntity;
  }

  /**
   * Get tracking projection by dispatch request ID
   */
  getTrackingProjectionByRequestId(requestId: string, customDb?: DatabaseSync): DispatchTrackingProjectionEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`
      SELECT * FROM dispatch_tracking_projections WHERE dispatch_request_id = ? ORDER BY last_updated_at DESC LIMIT 1;
    `).get(requestId) as any;
    if (!row) return null;
    return row as DispatchTrackingProjectionEntity;
  }

  /**
   * Manual override persistence
   */
  createManualOverride(override: DispatchManualOverrideEntity, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      INSERT INTO dispatch_manual_overrides (
        id, dispatch_request_id, actor_id, actor_role, provider_id,
        responder_reference_id, reason, override_flags_json, eligibility_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      override.id,
      override.dispatch_request_id,
      override.actor_id,
      override.actor_role,
      override.provider_id,
      override.responder_reference_id,
      override.reason,
      override.override_flags_json ?? null,
      override.eligibility_snapshot_json ?? null,
      override.created_at
    );
  }

  /**
   * Record reconciliation record
   */
  recordReconciliationIssue(record: DispatchReconciliationRecordEntity, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      INSERT INTO dispatch_reconciliation_records (
        id, dispatch_request_id, issue_type, description, resolved, resolution_details, detected_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      record.id,
      record.dispatch_request_id,
      record.issue_type,
      record.description,
      record.resolved,
      record.resolution_details ?? null,
      record.detected_at,
      record.resolved_at ?? null
    );
  }

  /**
   * List reconciliation issues
   */
  listReconciliationIssues(unresolvedOnly = true, customDb?: DatabaseSync): DispatchReconciliationRecordEntity[] {
    const db = customDb || getDatabase();
    let query = 'SELECT * FROM dispatch_reconciliation_records';
    if (unresolvedOnly) {
      query += ' WHERE resolved = 0';
    }
    query += ' ORDER BY detected_at DESC;';
    const rows = db.prepare(query).all() as any[];
    return rows as DispatchReconciliationRecordEntity[];
  }

  /**
   * Resolve reconciliation record
   */
  resolveReconciliationIssue(id: string, details: string, resolvedAt: string, customDb?: DatabaseSync): void {
    const db = customDb || getDatabase();
    db.prepare(`
      UPDATE dispatch_reconciliation_records
      SET resolved = 1, resolution_details = ?, resolved_at = ?
      WHERE id = ?;
    `).run(details, resolvedAt, id);
  }

  /**
   * Get all active dispatches for operations command view
   */
  getOperationsOverview(customDb?: DatabaseSync): any {
    const db = customDb || getDatabase();
    const activeRequests = db.prepare(`
      SELECT dr.*, v.plate_number, v.make, v.model, sp.name as assigned_provider_name
      FROM dispatch_requests dr
      LEFT JOIN vehicles v ON dr.vehicle_id = v.id
      LEFT JOIN service_providers sp ON dr.assigned_responder_id = sp.id
      WHERE dr.status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY dr.created_at DESC;
    `).all();

    const responders = db.prepare(`
      SELECT rp.*, sp.name as provider_name, rcl.latitude, rcl.longitude,
             rcl.freshness_state, rcl.updated_at as location_updated_at
      FROM responder_presence rp
      JOIN service_providers sp ON rp.provider_id = sp.id
      LEFT JOIN responder_current_locations rcl ON rp.responder_reference_id = rcl.responder_reference_id
      WHERE rp.status != 'OFFLINE'
      ORDER BY rp.updated_at DESC;
    `).all();

    return {
      activeRequests,
      responders,
    };
  }

  private mapRequest(row: any): DispatchRequestEntity {
    return {
      id: row.id,
      dispatch_domain: row.dispatch_domain,
      source_reference_type: row.source_reference_type,
      source_reference_id: row.source_reference_id,
      required_capability: row.required_capability,
      pickup_latitude: row.pickup_latitude,
      pickup_longitude: row.pickup_longitude,
      pickup_address: row.pickup_address,
      destination_latitude: row.destination_latitude,
      destination_longitude: row.destination_longitude,
      destination_address: row.destination_address,
      vehicle_id: row.vehicle_id,
      priority: row.priority,
      status: row.status,
      strategy: row.strategy,
      strategy_version: row.strategy_version,
      current_attempt_number: row.current_attempt_number || 1,
      active_attempt_id: row.active_attempt_id,
      assigned_provider_id: row.assigned_provider_id,
      assigned_responder_type: row.assigned_responder_type,
      assigned_responder_id: row.assigned_responder_id,
      lock_version: row.lock_version || 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    };
  }
}

export const dispatchRepository = new DispatchRepository();

