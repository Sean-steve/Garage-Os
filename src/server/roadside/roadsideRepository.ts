/**
 * GAR-014: Roadside Assistance Core Architecture
 * Data Access Repository
 */

import { getDatabase } from '../database/connection';
import {
  RoadsideIncidentEntity,
  RoadsideLocationEntity,
  RoadsideTriageRecordEntity,
  RoadsideTriageAnswerEntity,
  RoadsideAssistanceRequestEntity,
  RoadsideProviderOfferEntity,
  RoadsideAssignmentEntity,
  RoadsideInterventionEntity,
  RoadsideInterventionActionEntity,
  RoadsideIncidentEvidenceEntity,
  RoadsideIncidentActivityEntity,
  RoadsideCancellationEntity,
  RoadsideTowHandoffEntity,
  RoadsideIncidentStatus,
  ProviderOfferStatus,
  AssignmentStatus,
} from './types';

export class RoadsideRepository {
  // --- INCIDENTS ---

  createIncident(incident: RoadsideIncidentEntity): RoadsideIncidentEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_incidents (
        id, incident_number, vehicle_id, organization_id, reported_by_user_id,
        reported_by_name, reported_by_phone, incident_type, severity, status,
        initial_drivability, occupant_safety_state, description,
        safety_escalation_required, safety_escalation_notes, current_location_id,
        active_assistance_request_id, active_assignment_id, resolved_at,
        cancelled_at, closed_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      incident.id,
      incident.incident_number,
      incident.vehicle_id,
      incident.organization_id || null,
      incident.reported_by_user_id,
      incident.reported_by_name,
      incident.reported_by_phone || null,
      incident.incident_type,
      incident.severity,
      incident.status,
      incident.initial_drivability,
      incident.occupant_safety_state,
      incident.description || null,
      incident.safety_escalation_required ? 1 : 0,
      incident.safety_escalation_notes || null,
      incident.current_location_id || null,
      incident.active_assistance_request_id || null,
      incident.active_assignment_id || null,
      incident.resolved_at || null,
      incident.cancelled_at || null,
      incident.closed_at || null,
      incident.created_at,
      incident.updated_at
    );

    return incident;
  }

  getIncidentById(id: string): RoadsideIncidentEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_incidents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapIncident(row);
  }

  getIncidentByNumber(incidentNumber: string): RoadsideIncidentEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_incidents WHERE incident_number = ?').get(incidentNumber) as any;
    if (!row) return null;
    return this.mapIncident(row);
  }

  updateIncident(id: string, updates: Partial<RoadsideIncidentEntity>): RoadsideIncidentEntity | null {
    const db = getDatabase();
    const existing = this.getIncidentById(id);
    if (!existing) return null;

    const merged: RoadsideIncidentEntity = {
      ...existing,
      ...updates,
      updated_at: updates.updated_at || new Date().toISOString(),
    };

    const stmt = db.prepare(`
      UPDATE roadside_incidents SET
        incident_type = ?,
        severity = ?,
        status = ?,
        initial_drivability = ?,
        occupant_safety_state = ?,
        description = ?,
        safety_escalation_required = ?,
        safety_escalation_notes = ?,
        current_location_id = ?,
        active_assistance_request_id = ?,
        active_assignment_id = ?,
        resolved_at = ?,
        cancelled_at = ?,
        closed_at = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.incident_type,
      merged.severity,
      merged.status,
      merged.initial_drivability,
      merged.occupant_safety_state,
      merged.description || null,
      merged.safety_escalation_required ? 1 : 0,
      merged.safety_escalation_notes || null,
      merged.current_location_id || null,
      merged.active_assistance_request_id || null,
      merged.active_assignment_id || null,
      merged.resolved_at || null,
      merged.cancelled_at || null,
      merged.closed_at || null,
      merged.updated_at,
      id
    );

    return merged;
  }

  listIncidents(filters?: {
    vehicle_id?: string;
    organization_id?: string;
    reported_by_user_id?: string;
    status?: RoadsideIncidentStatus;
    statuses?: RoadsideIncidentStatus[];
    limit?: number;
    offset?: number;
  }): RoadsideIncidentEntity[] {
    const db = getDatabase();
    let query = 'SELECT * FROM roadside_incidents WHERE 1=1';
    const params: any[] = [];

    if (filters?.vehicle_id) {
      query += ' AND vehicle_id = ?';
      params.push(filters.vehicle_id);
    }
    if (filters?.organization_id) {
      query += ' AND organization_id = ?';
      params.push(filters.organization_id);
    }
    if (filters?.reported_by_user_id) {
      query += ' AND reported_by_user_id = ?';
      params.push(filters.reported_by_user_id);
    }
    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    } else if (filters?.statuses && filters.statuses.length > 0) {
      const placeholders = filters.statuses.map(() => '?').join(',');
      query += ` AND status IN (${placeholders})`;
      params.push(...filters.statuses);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
      if (filters?.offset) {
        query += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapIncident(r));
  }

  getNextIncidentSequenceNumber(): string {
    const db = getDatabase();
    const year = new Date().getFullYear();
    const countRow = db
      .prepare("SELECT COUNT(*) as count FROM roadside_incidents WHERE incident_number LIKE ?")
      .get(`RSA-${year}-%`) as { count: number };
    const nextSeq = (countRow?.count || 0) + 1;
    return `RSA-${year}-${String(nextSeq).padStart(5, '0')}`;
  }

  private mapIncident(row: any): RoadsideIncidentEntity {
    return {
      ...row,
      safety_escalation_required: Boolean(row.safety_escalation_required),
    };
  }

  // --- LOCATIONS ---

  createLocation(location: RoadsideLocationEntity): RoadsideLocationEntity {
    const db = getDatabase();
    // Deactivate previous locations for this incident
    db.prepare('UPDATE roadside_locations SET is_active = 0 WHERE incident_id = ?').run(location.incident_id);

    const stmt = db.prepare(`
      INSERT INTO roadside_locations (
        id, incident_id, source, latitude, longitude, accuracy_meters,
        address_line, road_or_highway, landmark_description, direction_of_travel,
        is_dangerous_location, is_active, recorded_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      location.id,
      location.incident_id,
      location.source,
      location.latitude,
      location.longitude,
      location.accuracy_meters || null,
      location.address_line || null,
      location.road_or_highway || null,
      location.landmark_description || null,
      location.direction_of_travel || null,
      location.is_dangerous_location ? 1 : 0,
      location.is_active ? 1 : 0,
      location.recorded_at,
      location.created_at
    );

    return location;
  }

  getActiveLocation(incidentId: string): RoadsideLocationEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_locations WHERE incident_id = ? AND is_active = 1 ORDER BY recorded_at DESC LIMIT 1')
      .get(incidentId) as any;
    if (!row) return null;
    return {
      ...row,
      is_dangerous_location: Boolean(row.is_dangerous_location),
      is_active: Boolean(row.is_active),
    };
  }

  getLocationById(id: string): RoadsideLocationEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_locations WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      is_dangerous_location: Boolean(row.is_dangerous_location),
      is_active: Boolean(row.is_active),
    };
  }

  // --- TRIAGE ---

  createTriageRecord(record: RoadsideTriageRecordEntity): RoadsideTriageRecordEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_triage_records (
        id, incident_id, engine_version, triage_result, recommended_assistance_type,
        safety_escalation_required, tow_required, guidance_notes, conducted_by_user_id,
        conducted_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.incident_id,
      record.engine_version,
      record.triage_result,
      record.recommended_assistance_type,
      record.safety_escalation_required ? 1 : 0,
      record.tow_required ? 1 : 0,
      record.guidance_notes || null,
      record.conducted_by_user_id || null,
      record.conducted_at,
      record.metadata_json || null
    );

    return record;
  }

  createTriageAnswer(answer: RoadsideTriageAnswerEntity): RoadsideTriageAnswerEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_triage_answers (
        id, triage_record_id, question_key, answer_value, risk_flag, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      answer.id,
      answer.triage_record_id,
      answer.question_key,
      answer.answer_value,
      answer.risk_flag ? 1 : 0,
      answer.created_at
    );

    return answer;
  }

  getLatestTriageRecord(incidentId: string): RoadsideTriageRecordEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_triage_records WHERE incident_id = ? ORDER BY conducted_at DESC LIMIT 1')
      .get(incidentId) as any;
    if (!row) return null;
    return {
      ...row,
      safety_escalation_required: Boolean(row.safety_escalation_required),
      tow_required: Boolean(row.tow_required),
    };
  }

  getTriageRecordByIncidentId(incidentId: string): RoadsideTriageRecordEntity | null {
    return this.getLatestTriageRecord(incidentId);
  }

  getTriageAnswers(triageRecordId: string): RoadsideTriageAnswerEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM roadside_triage_answers WHERE triage_record_id = ? ORDER BY created_at ASC')
      .all(triageRecordId) as any[];
    return rows.map((r) => ({
      ...r,
      risk_flag: Boolean(r.risk_flag),
    }));
  }

  listTriageAnswers(triageRecordId: string): RoadsideTriageAnswerEntity[] {
    return this.getTriageAnswers(triageRecordId);
  }

  // --- ASSISTANCE REQUESTS ---

  createAssistanceRequest(req: RoadsideAssistanceRequestEntity): RoadsideAssistanceRequestEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_assistance_requests (
        id, incident_id, requested_assistance_type, status, dispatch_mode,
        search_radius_km, created_at, expires_at, fulfilled_assignment_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      req.id,
      req.incident_id,
      req.requested_assistance_type,
      req.status,
      req.dispatch_mode,
      req.search_radius_km,
      req.created_at,
      req.expires_at || null,
      req.fulfilled_assignment_id || null,
      req.metadata_json || null
    );

    return req;
  }

  getAssistanceRequestById(id: string): RoadsideAssistanceRequestEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_assistance_requests WHERE id = ?').get(id) as any;
    return row || null;
  }

  getActiveAssistanceRequest(incidentId: string): RoadsideAssistanceRequestEntity | null {
    const db = getDatabase();
    const row = db
      .prepare("SELECT * FROM roadside_assistance_requests WHERE incident_id = ? AND status IN ('CREATED', 'BROADCASTING', 'MATCHED') ORDER BY created_at DESC LIMIT 1")
      .get(incidentId) as any;
    return row || null;
  }

  updateAssistanceRequest(
    id: string,
    updates: Partial<RoadsideAssistanceRequestEntity>
  ): RoadsideAssistanceRequestEntity | null {
    const db = getDatabase();
    const existing = this.getAssistanceRequestById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    db.prepare(`
      UPDATE roadside_assistance_requests SET
        status = ?,
        fulfilled_assignment_id = ?,
        expires_at = ?,
        metadata_json = ?
      WHERE id = ?
    `).run(
      merged.status,
      merged.fulfilled_assignment_id || null,
      merged.expires_at || null,
      merged.metadata_json || null,
      id
    );

    return merged;
  }

  // --- PROVIDER OFFERS ---

  createProviderOffer(offer: RoadsideProviderOfferEntity): RoadsideProviderOfferEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_provider_offers (
        id, request_id, incident_id, provider_id, provider_branch_id, status,
        offered_at, expires_at, responded_at, decline_reason, estimated_arrival_minutes,
        callout_charge_minor, currency, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      offer.id,
      offer.request_id,
      offer.incident_id,
      offer.provider_id,
      offer.provider_branch_id || null,
      offer.status,
      offer.offered_at,
      offer.expires_at,
      offer.responded_at || null,
      offer.decline_reason || null,
      offer.estimated_arrival_minutes || null,
      offer.callout_charge_minor,
      offer.currency,
      offer.metadata_json || null
    );

    return offer;
  }

  getProviderOfferById(id: string): RoadsideProviderOfferEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_provider_offers WHERE id = ?').get(id) as any;
    return row || null;
  }

  getOffersByRequestId(requestId: string): RoadsideProviderOfferEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM roadside_provider_offers WHERE request_id = ? ORDER BY offered_at DESC')
      .all(requestId) as any[];
  }

  getOffersByIncidentId(incidentId: string): RoadsideProviderOfferEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM roadside_provider_offers WHERE incident_id = ? ORDER BY offered_at DESC')
      .all(incidentId) as any[];
  }

  getOffersByProviderId(providerId: string, status?: ProviderOfferStatus): RoadsideProviderOfferEntity[] {
    const db = getDatabase();
    if (status) {
      return db
        .prepare('SELECT * FROM roadside_provider_offers WHERE provider_id = ? AND status = ? ORDER BY offered_at DESC')
        .all(providerId, status) as any[];
    }
    return db
      .prepare('SELECT * FROM roadside_provider_offers WHERE provider_id = ? ORDER BY offered_at DESC')
      .all(providerId) as any[];
  }

  updateProviderOffer(id: string, updates: Partial<RoadsideProviderOfferEntity>): RoadsideProviderOfferEntity | null {
    const db = getDatabase();
    const existing = this.getProviderOfferById(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    db.prepare(`
      UPDATE roadside_provider_offers SET
        status = ?,
        responded_at = ?,
        decline_reason = ?,
        estimated_arrival_minutes = ?,
        callout_charge_minor = ?,
        metadata_json = ?
      WHERE id = ?
    `).run(
      merged.status,
      merged.responded_at || null,
      merged.decline_reason || null,
      merged.estimated_arrival_minutes || null,
      merged.callout_charge_minor,
      merged.metadata_json || null,
      id
    );

    return merged;
  }

  withdrawPendingOffers(requestId: string, exceptOfferId?: string): void {
    const db = getDatabase();
    if (exceptOfferId) {
      db.prepare(`
        UPDATE roadside_provider_offers 
        SET status = 'WITHDRAWN' 
        WHERE request_id = ? AND status = 'OFFERED' AND id != ?
      `).run(requestId, exceptOfferId);
    } else {
      db.prepare(`
        UPDATE roadside_provider_offers 
        SET status = 'WITHDRAWN' 
        WHERE request_id = ? AND status = 'OFFERED'
      `).run(requestId);
    }
  }

  // --- ASSIGNMENTS ---

  createAssignment(assignment: RoadsideAssignmentEntity): RoadsideAssignmentEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_assignments (
        id, incident_id, request_id, offer_id, provider_id, provider_branch_id,
        assigned_technician_id, assigned_technician_name, assigned_technician_phone,
        assigned_vehicle_reg, status, eta_minutes, en_route_at, arrived_at,
        in_progress_at, completed_at, cancelled_at, last_known_latitude,
        last_known_longitude, last_location_updated_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      assignment.id,
      assignment.incident_id,
      assignment.request_id || assignment.incident_id,
      assignment.offer_id || null,
      assignment.provider_id,
      assignment.provider_branch_id || null,
      assignment.assigned_technician_id || (assignment as any).technician_id || null,
      assignment.assigned_technician_name || null,
      assignment.assigned_technician_phone || null,
      assignment.assigned_vehicle_reg || null,
      assignment.status || 'ASSIGNED',
      assignment.eta_minutes ?? null,
      assignment.en_route_at || null,
      assignment.arrived_at || null,
      assignment.in_progress_at || null,
      assignment.completed_at || null,
      assignment.cancelled_at || null,
      assignment.last_known_latitude ?? null,
      assignment.last_known_longitude ?? null,
      assignment.last_location_updated_at || null,
      assignment.created_at || new Date().toISOString(),
      assignment.updated_at || new Date().toISOString()
    );

    return assignment;
  }

  getAssignmentById(id: string): RoadsideAssignmentEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM roadside_assignments WHERE id = ?').get(id) as any;
    return row || null;
  }

  getActiveAssignment(incidentId: string): RoadsideAssignmentEntity | null {
    const db = getDatabase();
    const row = db
      .prepare(`
        SELECT * FROM roadside_assignments 
        WHERE incident_id = ? 
        AND status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS')
        LIMIT 1
      `)
      .get(incidentId) as any;
    return row || null;
  }

  getAssignmentsByProviderId(providerId: string, status?: AssignmentStatus): RoadsideAssignmentEntity[] {
    const db = getDatabase();
    if (status) {
      return db
        .prepare('SELECT * FROM roadside_assignments WHERE provider_id = ? AND status = ? ORDER BY created_at DESC')
        .all(providerId, status) as any[];
    }
    return db
      .prepare('SELECT * FROM roadside_assignments WHERE provider_id = ? ORDER BY created_at DESC')
      .all(providerId) as any[];
  }

  updateAssignment(id: string, updates: Partial<RoadsideAssignmentEntity>): RoadsideAssignmentEntity | null {
    const db = getDatabase();
    const existing = this.getAssignmentById(id);
    if (!existing) return null;

    const merged = {
      ...existing,
      ...updates,
      updated_at: updates.updated_at || new Date().toISOString(),
    };

    db.prepare(`
      UPDATE roadside_assignments SET
        assigned_technician_id = ?,
        assigned_technician_name = ?,
        assigned_technician_phone = ?,
        assigned_vehicle_reg = ?,
        status = ?,
        eta_minutes = ?,
        en_route_at = ?,
        arrived_at = ?,
        in_progress_at = ?,
        completed_at = ?,
        cancelled_at = ?,
        last_known_latitude = ?,
        last_known_longitude = ?,
        last_location_updated_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      merged.assigned_technician_id || null,
      merged.assigned_technician_name || null,
      merged.assigned_technician_phone || null,
      merged.assigned_vehicle_reg || null,
      merged.status,
      merged.eta_minutes || null,
      merged.en_route_at || null,
      merged.arrived_at || null,
      merged.in_progress_at || null,
      merged.completed_at || null,
      merged.cancelled_at || null,
      merged.last_known_latitude || null,
      merged.last_known_longitude || null,
      merged.last_location_updated_at || null,
      merged.updated_at,
      id
    );

    return merged;
  }

  // --- INTERVENTIONS ---

  createIntervention(intervention: RoadsideInterventionEntity): RoadsideInterventionEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_interventions (
        id, incident_id, assignment_id, provider_id, technician_id,
        technician_name, result, summary_notes, labor_duration_minutes,
        final_drivability, odometer_reading_km, tow_required, tow_destination,
        related_issue_id, related_component_id, related_tyre_id, fee_minor,
        currency, recorded_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      intervention.id,
      intervention.incident_id,
      intervention.assignment_id,
      intervention.provider_id,
      intervention.technician_id || null,
      intervention.technician_name || null,
      intervention.result,
      intervention.summary_notes,
      intervention.labor_duration_minutes,
      intervention.final_drivability,
      intervention.odometer_reading_km || null,
      intervention.tow_required ? 1 : 0,
      intervention.tow_destination || null,
      intervention.related_issue_id || null,
      intervention.related_component_id || null,
      intervention.related_tyre_id || null,
      intervention.fee_minor,
      intervention.currency,
      intervention.recorded_at,
      intervention.created_at
    );

    return intervention;
  }

  getInterventionByIncidentId(incidentId: string): RoadsideInterventionEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_interventions WHERE incident_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get(incidentId) as any;
    if (!row) return null;
    return {
      ...row,
      tow_required: Boolean(row.tow_required),
    };
  }

  getInterventionByAssignmentId(assignmentId: string): RoadsideInterventionEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_interventions WHERE assignment_id = ? LIMIT 1')
      .get(assignmentId) as any;
    if (!row) return null;
    return {
      ...row,
      tow_required: Boolean(row.tow_required),
    };
  }

  createInterventionAction(action: RoadsideInterventionActionEntity): RoadsideInterventionActionEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_intervention_actions (
        id, intervention_id, action_type, description, part_name,
        part_number, quantity, cost_minor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      action.id,
      action.intervention_id,
      action.action_type,
      action.description,
      action.part_name || null,
      action.part_number || null,
      action.quantity,
      action.cost_minor,
      action.created_at
    );

    return action;
  }

  getInterventionActions(interventionId: string): RoadsideInterventionActionEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM roadside_intervention_actions WHERE intervention_id = ? ORDER BY created_at ASC')
      .all(interventionId) as any[];
  }

  // --- EVIDENCE ---

  createEvidence(evidence: RoadsideIncidentEvidenceEntity): RoadsideIncidentEvidenceEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_incident_evidence (
        id, incident_id, storage_object_id, evidence_type, caption,
        file_url, captured_by_role, uploaded_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      evidence.id,
      evidence.incident_id,
      evidence.storage_object_id || null,
      evidence.evidence_type,
      evidence.caption || null,
      evidence.file_url || null,
      evidence.captured_by_role,
      evidence.uploaded_by_user_id,
      evidence.created_at
    );

    return evidence;
  }

  getEvidenceByIncidentId(incidentId: string): RoadsideIncidentEvidenceEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM roadside_incident_evidence WHERE incident_id = ? ORDER BY created_at ASC')
      .all(incidentId) as any[];
  }

  // --- ACTIVITY LOG ---

  logActivity(activity: RoadsideIncidentActivityEntity): RoadsideIncidentActivityEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_incident_activity (
        id, incident_id, activity_type, actor_id, actor_type,
        actor_name, title, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      activity.id,
      activity.incident_id,
      activity.activity_type,
      activity.actor_id || null,
      activity.actor_type || null,
      activity.actor_name || null,
      activity.title,
      activity.details || null,
      activity.created_at
    );

    return activity;
  }

  getActivityLog(incidentId: string): RoadsideIncidentActivityEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM roadside_incident_activity WHERE incident_id = ? ORDER BY created_at ASC')
      .all(incidentId) as any[];
  }

  // --- CANCELLATIONS ---

  createCancellation(cancellation: RoadsideCancellationEntity): RoadsideCancellationEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_cancellations (
        id, incident_id, cancelled_by_user_id, cancelled_by_role, reason,
        notes, fee_incurred_minor, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      cancellation.id,
      cancellation.incident_id,
      cancellation.cancelled_by_user_id,
      cancellation.cancelled_by_role,
      cancellation.reason,
      cancellation.notes || null,
      cancellation.fee_incurred_minor,
      cancellation.cancelled_at
    );

    return cancellation;
  }

  getCancellation(incidentId: string): RoadsideCancellationEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_cancellations WHERE incident_id = ? ORDER BY cancelled_at DESC LIMIT 1')
      .get(incidentId) as any;
    return row || null;
  }

  // --- TOW HANDOFFS ---

  createTowHandoff(handoff: RoadsideTowHandoffEntity): RoadsideTowHandoffEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO roadside_tow_handoffs (
        id, incident_id, intervention_id, destination_type, destination_provider_id,
        destination_name, destination_address, destination_latitude, destination_longitude,
        special_instructions, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      handoff.id,
      handoff.incident_id,
      handoff.intervention_id || null,
      handoff.destination_type,
      handoff.destination_provider_id || null,
      handoff.destination_name,
      handoff.destination_address || null,
      handoff.destination_latitude || null,
      handoff.destination_longitude || null,
      handoff.special_instructions || null,
      handoff.status,
      handoff.created_at
    );

    return handoff;
  }

  getTowHandoff(incidentId: string): RoadsideTowHandoffEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM roadside_tow_handoffs WHERE incident_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(incidentId) as any;
    return row || null;
  }

  updateTowHandoff(id: string, updates: Partial<RoadsideTowHandoffEntity>): RoadsideTowHandoffEntity | null {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM roadside_tow_handoffs WHERE id = ?').get(id) as any;
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    db.prepare(`
      UPDATE roadside_tow_handoffs SET
        destination_type = ?,
        destination_provider_id = ?,
        destination_name = ?,
        destination_address = ?,
        special_instructions = ?,
        status = ?
      WHERE id = ?
    `).run(
      merged.destination_type,
      merged.destination_provider_id || null,
      merged.destination_name,
      merged.destination_address || null,
      merged.special_instructions || null,
      merged.status,
      id
    );

    return merged;
  }

  // -------------------------------------------------------------------------
  // Technicians
  // -------------------------------------------------------------------------
  private techniciansMap = new Map<string, any>();

  createTechnician(tech: any): any {
    this.techniciansMap.set(tech.id, tech);
    return tech;
  }

  getTechnicianById(id: string): any {
    return this.techniciansMap.get(id) || null;
  }
}

export const roadsideRepository = new RoadsideRepository();
