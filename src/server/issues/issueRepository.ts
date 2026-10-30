/**
 * Canonical Vehicle Issue, Fault & Persistent Problem Repository (GAR-008, GAR-033 §12A)
 */

import { getDatabase } from '../database/connection';
import {
  VehicleIssue,
  IssueOccurrence,
  IssueObservation,
  IssueSuspectedCause,
  IssueDiagnosis,
  IssueIntervention,
  IssueResolution,
  IssueFollowup,
  IssueEvidenceLink,
  IssueMergeRecord,
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  IssuePersistenceState,
  SymptomCategory,
  ObservationType,
  SuspectedCauseStatus,
  DiagnosisOutcome,
  IssueInterventionType,
  IssueInterventionResult,
  IssueResolutionType,
  FollowupStatus,
  FollowupResponse,
} from './types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getCurrentUtcIsoString } from '../domain/time';

export class IssueRepository {
  /**
   * Creates a new VehicleIssue aggregate
   */
  public createIssue(issue: VehicleIssue): VehicleIssue {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO vehicle_issues (
        id, vehicle_id, issue_code, title, summary, category, severity, status,
        persistence_state, primary_component_category, first_observed_at, last_observed_at,
        first_observed_odometer_km, last_observed_odometer_km, occurrence_count,
        diagnosis_count, intervention_count, last_intervention_id, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      issue.id,
      issue.vehicle_id,
      issue.issue_code ?? null,
      issue.title,
      issue.summary,
      issue.category,
      issue.severity,
      issue.status,
      issue.persistence_state,
      issue.primary_component_category ?? null,
      issue.first_observed_at,
      issue.last_observed_at,
      issue.first_observed_odometer_km ?? null,
      issue.last_observed_odometer_km ?? null,
      issue.occurrence_count ?? 1,
      issue.diagnosis_count ?? 0,
      issue.intervention_count ?? 0,
      issue.last_intervention_id ?? null,
      issue.created_by,
      issue.created_at,
      issue.updated_at
    );

    return issue;
  }

  /**
   * Updates fields on an existing VehicleIssue
   */
  public updateIssue(issueId: string, updates: Partial<VehicleIssue>): void {
    const db = getDatabase();
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id') continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = ?`);
    values.push(getCurrentUtcIsoString());
    values.push(issueId);

    const sql = `UPDATE vehicle_issues SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...(values as any[]));
  }

  /**
   * Retrieves a VehicleIssue by ID
   */
  public getIssueById(issueId: string): VehicleIssue | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_issues WHERE id = ?').get(issueId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToVehicleIssue(row);
  }

  /**
   * Lists issues for a specific vehicle with optional filters
   */
  public listIssuesForVehicle(
    vehicleId: string,
    filters?: {
      status?: string;
      category?: string;
      severity?: string;
      persistence_state?: string;
    }
  ): VehicleIssue[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM vehicle_issues WHERE vehicle_id = ?';
    const params: unknown[] = [vehicleId];

    if (filters?.status && filters.status !== 'ALL') {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.category && filters.category !== 'ALL') {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters?.severity && filters.severity !== 'ALL') {
      sql += ' AND severity = ?';
      params.push(filters.severity);
    }
    if (filters?.persistence_state && filters.persistence_state !== 'ALL') {
      sql += ' AND persistence_state = ?';
      params.push(filters.persistence_state);
    }

    sql += ' ORDER BY last_observed_at DESC';
    const rows = db.prepare(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToVehicleIssue(r));
  }

  /**
   * Creates an IssueOccurrence record
   */
  public createOccurrence(occ: IssueOccurrence): IssueOccurrence {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_occurrences (
        id, vehicle_issue_id, vehicle_id, occurred_at, recorded_at, odometer_value,
        odometer_unit, odometer_km, description, symptom_category, driving_condition,
        speed_range, engine_temperature_state, weather_context, road_condition,
        source_type, actor_id, location_reference, evidence_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      occ.id,
      occ.vehicle_issue_id,
      occ.vehicle_id,
      occ.occurred_at,
      occ.recorded_at,
      occ.odometer_value ?? null,
      occ.odometer_unit ?? 'KM',
      occ.odometer_km ?? null,
      occ.description,
      occ.symptom_category,
      occ.driving_condition ?? null,
      occ.speed_range ?? null,
      occ.engine_temperature_state ?? null,
      occ.weather_context ?? null,
      occ.road_condition ?? null,
      occ.source_type,
      occ.actor_id ?? null,
      occ.location_reference ?? null,
      occ.evidence_count ?? 0,
      occ.created_at
    );

    return occ;
  }

  /**
   * Lists occurrences for an issue
   */
  public listOccurrencesForIssue(issueId: string): IssueOccurrence[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM issue_occurrences WHERE vehicle_issue_id = ? ORDER BY occurred_at DESC
    `).all(issueId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      vehicle_id: String(r.vehicle_id),
      occurred_at: String(r.occurred_at),
      recorded_at: String(r.recorded_at),
      odometer_value: r.odometer_value != null ? Number(r.odometer_value) : null,
      odometer_unit: String(r.odometer_unit || 'KM'),
      odometer_km: r.odometer_km != null ? Number(r.odometer_km) : null,
      description: String(r.description),
      symptom_category: r.symptom_category as SymptomCategory,
      driving_condition: r.driving_condition ? String(r.driving_condition) : null,
      speed_range: r.speed_range ? String(r.speed_range) : null,
      engine_temperature_state: r.engine_temperature_state ? String(r.engine_temperature_state) : null,
      weather_context: r.weather_context ? String(r.weather_context) : null,
      road_condition: r.road_condition ? String(r.road_condition) : null,
      source_type: r.source_type as DataProvenanceClass,
      actor_id: String(r.actor_id),
      location_reference: r.location_reference ? String(r.location_reference) : null,
      evidence_count: Number(r.evidence_count || 0),
      created_at: String(r.created_at),
    }));
  }

  /**
   * Creates an observation
   */
  public createObservation(obs: IssueObservation): IssueObservation {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_observations (
        id, vehicle_issue_id, vehicle_id, observation_type, description,
        source_type, source_reference_id, observed_at, recorded_at,
        actor_id, provider_id, verification_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      obs.id,
      obs.vehicle_issue_id,
      obs.vehicle_id,
      obs.observation_type,
      obs.description,
      obs.source_type,
      obs.source_reference_id,
      obs.observed_at,
      obs.recorded_at,
      obs.actor_id,
      obs.provider_id,
      obs.verification_status,
      obs.created_at
    );

    return obs;
  }

  /**
   * Lists observations for an issue
   */
  public listObservationsForIssue(issueId: string): IssueObservation[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_observations WHERE vehicle_issue_id = ? ORDER BY observed_at DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      vehicle_id: String(r.vehicle_id),
      observation_type: r.observation_type as ObservationType,
      description: String(r.description),
      source_type: r.source_type as DataProvenanceClass,
      source_reference_id: r.source_reference_id ? String(r.source_reference_id) : null,
      observed_at: String(r.observed_at),
      recorded_at: String(r.recorded_at),
      actor_id: r.actor_id ? String(r.actor_id) : null,
      provider_id: r.provider_id ? String(r.provider_id) : null,
      verification_status: String(r.verification_status || 'UNVERIFIED'),
      created_at: String(r.created_at),
    }));
  }

  /**
   * Creates suspected cause record
   */
  public createSuspectedCause(cause: IssueSuspectedCause): IssueSuspectedCause {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_suspected_causes (
        id, vehicle_issue_id, component_category, description, confidence,
        source_type, proposed_by, proposed_at, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      cause.id,
      cause.vehicle_issue_id,
      cause.component_category,
      cause.description,
      cause.confidence,
      cause.source_type,
      cause.proposed_by,
      cause.proposed_at,
      cause.status,
      cause.created_at
    );

    return cause;
  }

  /**
   * Lists suspected causes for an issue
   */
  public listSuspectedCausesForIssue(issueId: string): IssueSuspectedCause[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_suspected_causes WHERE vehicle_issue_id = ? ORDER BY proposed_at DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      component_category: String(r.component_category),
      description: String(r.description),
      confidence: r.confidence != null ? Number(r.confidence) : null,
      source_type: String(r.source_type),
      proposed_by: String(r.proposed_by),
      proposed_at: String(r.proposed_at),
      status: r.status as SuspectedCauseStatus,
      created_at: String(r.created_at),
    }));
  }

  /**
   * Creates a professional diagnosis record
   */
  public createDiagnosis(diag: IssueDiagnosis): IssueDiagnosis {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_diagnoses (
        id, vehicle_issue_id, vehicle_id, provider_id, provider_name,
        technician_id, technician_name, diagnosed_at, diagnosis_code,
        diagnosis_summary, diagnosis_details, confirmed_component, outcome,
        verification_status, evidence_reference_ids, source_work_order_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      diag.id,
      diag.vehicle_issue_id,
      diag.vehicle_id,
      diag.provider_id ?? null,
      diag.provider_name ?? null,
      diag.technician_id ?? null,
      diag.technician_name ?? null,
      diag.diagnosed_at,
      diag.diagnosis_code ?? null,
      diag.diagnosis_summary,
      diag.diagnosis_details,
      diag.confirmed_component ?? null,
      diag.outcome,
      diag.verification_status,
      JSON.stringify(diag.evidence_reference_ids || []),
      diag.source_work_order_id ?? null,
      diag.created_at
    );

    return diag;
  }

  /**
   * Lists diagnoses for an issue
   */
  public listDiagnosesForIssue(issueId: string): IssueDiagnosis[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_diagnoses WHERE vehicle_issue_id = ? ORDER BY diagnosed_at DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToDiagnosis(r));
  }

  /**
   * Lists diagnoses across all issues for a vehicle
   */
  public listDiagnosesForVehicle(vehicleId: string): IssueDiagnosis[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_diagnoses WHERE vehicle_id = ? ORDER BY diagnosed_at DESC').all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToDiagnosis(r));
  }

  /**
   * Creates an intervention record
   */
  public createIntervention(intv: IssueIntervention): IssueIntervention {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_interventions (
        id, vehicle_issue_id, vehicle_id, intervention_type, description,
        performed_at, odometer_value, odometer_unit, odometer_km, provider_id,
        provider_name, work_order_id, replaced_part_names, cost_total, currency,
        result, verification_status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      intv.id,
      intv.vehicle_issue_id,
      intv.vehicle_id,
      intv.intervention_type,
      intv.description,
      intv.performed_at,
      intv.odometer_value ?? null,
      intv.odometer_unit ?? 'KM',
      intv.odometer_km ?? null,
      intv.provider_id ?? null,
      intv.provider_name ?? null,
      intv.work_order_id ?? null,
      JSON.stringify(intv.replaced_part_names || []),
      intv.cost_total ?? 0,
      intv.currency ?? 'KES',
      intv.result ?? 'AWAITING_OBSERVATION',
      intv.verification_status,
      intv.notes ?? null,
      intv.created_at
    );

    return intv;
  }

  /**
   * Lists interventions for an issue
   */
  public listInterventionsForIssue(issueId: string): IssueIntervention[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_interventions WHERE vehicle_issue_id = ? ORDER BY performed_at DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToIntervention(r));
  }

  /**
   * Lists interventions across a vehicle
   */
  public listInterventionsForVehicle(vehicleId: string): IssueIntervention[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_interventions WHERE vehicle_id = ? ORDER BY performed_at DESC').all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToIntervention(r));
  }

  /**
   * Creates a resolution record
   */
  public createResolution(res: IssueResolution): IssueResolution {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_resolutions (
        id, vehicle_issue_id, vehicle_id, resolved_at, resolved_odometer_km,
        resolution_type, resolution_summary, resolved_by, source_type,
        confirmation_state, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      res.id,
      res.vehicle_issue_id,
      res.vehicle_id,
      res.resolved_at,
      res.resolved_odometer_km,
      res.resolution_type,
      res.resolution_summary,
      res.resolved_by,
      res.source_type,
      res.confirmation_state,
      res.notes,
      res.created_at
    );

    return res;
  }

  /**
   * Retrieves resolution for an issue
   */
  public getResolutionForIssue(issueId: string): IssueResolution | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM issue_resolutions WHERE vehicle_issue_id = ? ORDER BY resolved_at DESC LIMIT 1').get(issueId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: String(row.id),
      vehicle_issue_id: String(row.vehicle_issue_id),
      vehicle_id: String(row.vehicle_id),
      resolved_at: String(row.resolved_at),
      resolved_odometer_km: row.resolved_odometer_km != null ? Number(row.resolved_odometer_km) : null,
      resolution_type: row.resolution_type as IssueResolutionType,
      resolution_summary: String(row.resolution_summary),
      resolved_by: String(row.resolved_by),
      source_type: String(row.source_type),
      confirmation_state: String(row.confirmation_state),
      notes: row.notes ? String(row.notes) : null,
      created_at: String(row.created_at),
    };
  }

  /**
   * Creates a follow-up record
   */
  public createFollowup(followup: IssueFollowup): IssueFollowup {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_followups (
        id, vehicle_issue_id, intervention_id, scheduled_at, due_date,
        due_odometer_km, status, prompt_message, response, response_notes,
        responded_at, responded_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      followup.id,
      followup.vehicle_issue_id,
      followup.intervention_id,
      followup.scheduled_at,
      followup.due_date,
      followup.due_odometer_km ?? null,
      followup.status,
      followup.prompt_message,
      followup.response ?? null,
      followup.response_notes ?? null,
      followup.responded_at ?? null,
      followup.responded_by ?? null,
      followup.created_at,
      followup.updated_at
    );

    return followup;
  }

  /**
   * Retrieves a follow-up by ID
   */
  public getFollowupById(followupId: string): IssueFollowup | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM issue_followups WHERE id = ?').get(followupId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToFollowup(row);
  }

  /**
   * Updates a follow-up
   */
  public updateFollowup(followupId: string, updates: Partial<IssueFollowup>): void {
    const db = getDatabase();
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id') continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = ?`);
    values.push(getCurrentUtcIsoString());
    values.push(followupId);

    const sql = `UPDATE issue_followups SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...(values as any[]));
  }

  /**
   * Lists follow-ups for an issue
   */
  public listFollowupsForIssue(issueId: string): IssueFollowup[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_followups WHERE vehicle_issue_id = ? ORDER BY due_date DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToFollowup(r));
  }

  /**
   * Lists due follow-ups across the system
   */
  public listDueFollowups(nowIso: string): IssueFollowup[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM issue_followups
      WHERE status IN ('SCHEDULED', 'DUE') AND due_date <= ?
      ORDER BY due_date ASC
    `).all(nowIso) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToFollowup(r));
  }

  /**
   * Creates an evidence link
   */
  public createEvidenceLink(link: IssueEvidenceLink): IssueEvidenceLink {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_evidence_links (
        id, vehicle_issue_id, occurrence_id, file_id, file_url,
        evidence_type, title, caption, captured_at, uploaded_at, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      link.id,
      link.vehicle_issue_id,
      link.occurrence_id,
      link.file_id,
      link.file_url,
      link.evidence_type,
      link.title,
      link.caption,
      link.captured_at,
      link.uploaded_at,
      link.uploaded_by,
      link.created_at
    );

    return link;
  }

  /**
   * Lists evidence for an issue
   */
  public listEvidenceForIssue(issueId: string): IssueEvidenceLink[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM issue_evidence_links WHERE vehicle_issue_id = ? ORDER BY uploaded_at DESC').all(issueId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      occurrence_id: r.occurrence_id ? String(r.occurrence_id) : null,
      file_id: String(r.file_id),
      file_url: String(r.file_url),
      evidence_type: String(r.evidence_type),
      title: String(r.title),
      caption: r.caption ? String(r.caption) : null,
      captured_at: r.captured_at ? String(r.captured_at) : null,
      uploaded_at: String(r.uploaded_at),
      uploaded_by: String(r.uploaded_by),
      created_at: String(r.created_at),
    }));
  }

  /**
   * Creates merge record
   */
  public createMergeRecord(record: IssueMergeRecord): IssueMergeRecord {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issue_merge_records (
        id, surviving_issue_id, merged_issue_id, vehicle_id, reason, merged_by, merged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.surviving_issue_id,
      record.merged_issue_id,
      record.vehicle_id,
      record.reason,
      record.merged_by,
      record.merged_at
    );

    return record;
  }

  /**
   * Counts active issues for a vehicle
   */
  public countActiveIssuesForVehicle(vehicleId: string): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM vehicle_issues
      WHERE vehicle_id = ? AND status NOT IN ('RESOLVED', 'CLOSED')
    `).get(vehicleId) as { cnt: number } | undefined;
    return row ? Number(row.cnt) : 0;
  }

  /**
   * Counts persistent issues for a vehicle
   */
  public countPersistentIssuesForVehicle(vehicleId: string): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM vehicle_issues
      WHERE vehicle_id = ? AND persistence_state IN ('PERSISTENT', 'RECURRENT_AFTER_RESOLUTION')
    `).get(vehicleId) as { cnt: number } | undefined;
    return row ? Number(row.cnt) : 0;
  }

  /**
   * Lists active issues for a vehicle
   */
  public listActiveIssuesForVehicle(vehicleId: string): VehicleIssue[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_issues
      WHERE vehicle_id = ? AND status NOT IN ('RESOLVED', 'CLOSED')
      ORDER BY last_observed_at DESC
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToVehicleIssue(r));
  }

  /**
   * Lists persistent issues for a vehicle
   */
  public listPersistentIssuesForVehicle(vehicleId: string): VehicleIssue[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_issues
      WHERE vehicle_id = ? AND persistence_state IN ('PERSISTENT', 'RECURRENT_AFTER_RESOLUTION')
      ORDER BY last_observed_at DESC
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRowToVehicleIssue(r));
  }

  // ==========================================================================
  // Row Mappers
  // ==========================================================================

  private mapRowToVehicleIssue(r: Record<string, unknown>): VehicleIssue {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      issue_code: r.issue_code ? String(r.issue_code) : null,
      title: String(r.title),
      summary: String(r.summary),
      category: r.category as IssueCategory,
      severity: r.severity as IssueSeverity,
      status: r.status as IssueStatus,
      persistence_state: r.persistence_state as IssuePersistenceState,
      primary_component_category: r.primary_component_category ? String(r.primary_component_category) : null,
      first_observed_at: String(r.first_observed_at),
      last_observed_at: String(r.last_observed_at),
      first_observed_odometer_km: r.first_observed_odometer_km != null ? Number(r.first_observed_odometer_km) : null,
      last_observed_odometer_km: r.last_observed_odometer_km != null ? Number(r.last_observed_odometer_km) : null,
      occurrence_count: Number(r.occurrence_count || 1),
      diagnosis_count: Number(r.diagnosis_count || 0),
      intervention_count: Number(r.intervention_count || 0),
      last_intervention_id: r.last_intervention_id ? String(r.last_intervention_id) : null,
      created_by: String(r.created_by),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapRowToDiagnosis(r: Record<string, unknown>): IssueDiagnosis {
    let evidenceIds: string[] = [];
    try {
      if (typeof r.evidence_reference_ids === 'string') {
        evidenceIds = JSON.parse(r.evidence_reference_ids);
      }
    } catch {
      evidenceIds = [];
    }

    return {
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      vehicle_id: String(r.vehicle_id),
      provider_id: String(r.provider_id),
      provider_name: String(r.provider_name),
      technician_id: r.technician_id ? String(r.technician_id) : null,
      technician_name: r.technician_name ? String(r.technician_name) : null,
      diagnosed_at: String(r.diagnosed_at),
      diagnosis_code: r.diagnosis_code ? String(r.diagnosis_code) : null,
      diagnosis_summary: String(r.diagnosis_summary),
      diagnosis_details: String(r.diagnosis_details),
      confirmed_component: r.confirmed_component ? String(r.confirmed_component) : null,
      outcome: r.outcome as DiagnosisOutcome,
      verification_status: String(r.verification_status || 'PROVIDER_RECORDED'),
      evidence_reference_ids: evidenceIds,
      source_work_order_id: r.source_work_order_id ? String(r.source_work_order_id) : null,
      created_at: String(r.created_at),
    };
  }

  private mapRowToIntervention(r: Record<string, unknown>): IssueIntervention {
    let replacedParts: string[] = [];
    try {
      if (typeof r.replaced_part_names === 'string') {
        replacedParts = JSON.parse(r.replaced_part_names);
      }
    } catch {
      replacedParts = [];
    }

    return {
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      vehicle_id: String(r.vehicle_id),
      intervention_type: r.intervention_type as IssueInterventionType,
      description: String(r.description),
      performed_at: String(r.performed_at),
      odometer_value: r.odometer_value != null ? Number(r.odometer_value) : null,
      odometer_unit: String(r.odometer_unit || 'KM'),
      odometer_km: r.odometer_km != null ? Number(r.odometer_km) : null,
      provider_id: r.provider_id ? String(r.provider_id) : null,
      provider_name: r.provider_name ? String(r.provider_name) : null,
      work_order_id: r.work_order_id ? String(r.work_order_id) : null,
      replaced_part_names: replacedParts,
      cost_total: r.cost_total != null ? Number(r.cost_total) : 0,
      currency: String(r.currency || 'KES'),
      result: r.result as IssueInterventionResult,
      verification_status: String(r.verification_status || 'PROVIDER_RECORDED'),
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
    };
  }

  private mapRowToFollowup(r: Record<string, unknown>): IssueFollowup {
    return {
      id: String(r.id),
      vehicle_issue_id: String(r.vehicle_issue_id),
      intervention_id: String(r.intervention_id),
      scheduled_at: String(r.scheduled_at),
      due_date: String(r.due_date),
      due_odometer_km: r.due_odometer_km != null ? Number(r.due_odometer_km) : null,
      status: r.status as FollowupStatus,
      prompt_message: String(r.prompt_message),
      response: r.response ? (r.response as FollowupResponse) : null,
      response_notes: r.response_notes ? String(r.response_notes) : null,
      responded_at: r.responded_at ? String(r.responded_at) : null,
      responded_by: r.responded_by ? String(r.responded_by) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }
}

export const issueRepository = new IssueRepository();
