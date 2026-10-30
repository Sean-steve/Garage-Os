/**
 * Canonical Vehicle Issue, Fault & Persistent Problem Domain Types (GAR-008, GAR-033, GAR-034, GAR-035)
 */

import { DataProvenanceClass } from '../../shared/provenance';

// Canonical Issue Categories (GAR-008 §7)
export enum IssueCategory {
  ENGINE = 'ENGINE',
  TRANSMISSION = 'TRANSMISSION',
  BRAKES = 'BRAKES',
  STEERING = 'STEERING',
  SUSPENSION = 'SUSPENSION',
  TYRES_WHEELS = 'TYRES_WHEELS',
  ELECTRICAL = 'ELECTRICAL',
  BATTERY = 'BATTERY',
  COOLING = 'COOLING',
  AIR_CONDITIONING = 'AIR_CONDITIONING',
  FUEL_SYSTEM = 'FUEL_SYSTEM',
  EXHAUST = 'EXHAUST',
  BODY = 'BODY',
  INTERIOR = 'INTERIOR',
  SAFETY_SYSTEM = 'SAFETY_SYSTEM',
  DRIVETRAIN = 'DRIVETRAIN',
  UNKNOWN = 'UNKNOWN',
  OTHER = 'OTHER',
}

// Canonical Issue Severity (GAR-008 §10)
export enum IssueSeverity {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
  UNKNOWN = 'UNKNOWN',
}

// Canonical Issue Lifecycle Status (GAR-008 §8, §72)
export enum IssueStatus {
  REPORTED = 'REPORTED',
  UNDER_OBSERVATION = 'UNDER_OBSERVATION',
  DIAGNOSIS_PENDING = 'DIAGNOSIS_PENDING',
  DIAGNOSED = 'DIAGNOSED',
  REPAIR_PENDING = 'REPAIR_PENDING',
  REPAIR_IN_PROGRESS = 'REPAIR_IN_PROGRESS',
  MONITORING = 'MONITORING',
  RESOLVED = 'RESOLVED',
  RECURRED = 'RECURRED',
  CLOSED = 'CLOSED',
  DISPUTED = 'DISPUTED',
}

// Canonical Issue Persistence State (GAR-008 §9, §30)
export enum IssuePersistenceState {
  SINGLE_OCCURRENCE = 'SINGLE_OCCURRENCE',
  REPEATED = 'REPEATED',
  PERSISTENT = 'PERSISTENT',
  INTERMITTENT = 'INTERMITTENT',
  RECURRENT_AFTER_RESOLUTION = 'RECURRENT_AFTER_RESOLUTION',
  UNKNOWN = 'UNKNOWN',
}

// Canonical Symptom Taxonomy (GAR-008 §13)
export enum SymptomCategory {
  NOISE = 'NOISE',
  VIBRATION = 'VIBRATION',
  SMELL = 'SMELL',
  SMOKE = 'SMOKE',
  WARNING_LIGHT = 'WARNING_LIGHT',
  LOSS_OF_POWER = 'LOSS_OF_POWER',
  OVERHEATING = 'OVERHEATING',
  LEAK = 'LEAK',
  HARD_START = 'HARD_START',
  NO_START = 'NO_START',
  ROUGH_IDLE = 'ROUGH_IDLE',
  BRAKING_BEHAVIOR = 'BRAKING_BEHAVIOR',
  STEERING_BEHAVIOR = 'STEERING_BEHAVIOR',
  FLUID_LOSS = 'FLUID_LOSS',
  ELECTRICAL_FAILURE = 'ELECTRICAL_FAILURE',
  OTHER = 'OTHER',
}

// Driving Conditions Context (GAR-008 §12)
export enum DrivingCondition {
  WHEN_STARTING = 'WHEN_STARTING',
  AT_IDLE = 'AT_IDLE',
  UNDER_ACCELERATION = 'UNDER_ACCELERATION',
  WHILE_BRAKING = 'WHILE_BRAKING',
  WHILE_TURNING = 'WHILE_TURNING',
  AT_HIGH_SPEED = 'AT_HIGH_SPEED',
  AT_LOW_SPEED = 'AT_LOW_SPEED',
  WHEN_COLD = 'WHEN_COLD',
  WHEN_HOT = 'WHEN_HOT',
  ON_ROUGH_ROAD = 'ON_ROUGH_ROAD',
  INTERMITTENT = 'INTERMITTENT',
  CONSTANT = 'CONSTANT',
  UNKNOWN = 'UNKNOWN',
}

// Observation Type (GAR-008 §14)
export enum ObservationType {
  VISUAL = 'VISUAL',
  AUDITORY = 'AUDITORY',
  SCAN_TOOL = 'SCAN_TOOL',
  TELEMETRY_STREAM = 'TELEMETRY_STREAM',
  MANUAL_INSPECTION = 'MANUAL_INSPECTION',
  DYNAMIC_ROAD_TEST = 'DYNAMIC_ROAD_TEST',
  OTHER = 'OTHER',
}

// Suspected Cause Status (GAR-008 §16)
export enum SuspectedCauseStatus {
  POSSIBLE = 'POSSIBLE',
  LIKELY = 'LIKELY',
  RULED_OUT = 'RULED_OUT',
  CONFIRMED = 'CONFIRMED',
  SUPERSEDED = 'SUPERSEDED',
}

// Diagnosis Outcome (GAR-008 §19)
export enum DiagnosisOutcome {
  PROPOSED = 'PROPOSED',
  CONFIRMED = 'CONFIRMED',
  RULED_OUT = 'RULED_OUT',
  SUPERSEDED = 'SUPERSEDED',
  INCONCLUSIVE = 'INCONCLUSIVE',
}

// Intervention Type (GAR-008 §21)
export enum IssueInterventionType {
  ADJUSTMENT = 'ADJUSTMENT',
  REPAIR = 'REPAIR',
  REPLACEMENT = 'REPLACEMENT',
  ALIGNMENT = 'ALIGNMENT',
  BALANCING = 'BALANCING',
  CLEANING = 'CLEANING',
  SOFTWARE_RESET = 'SOFTWARE_RESET',
  FLUID_SERVICE = 'FLUID_SERVICE',
  WIRING_REPAIR = 'WIRING_REPAIR',
  INSPECTION_ONLY = 'INSPECTION_ONLY',
  OTHER = 'OTHER',
}

// Intervention Result (GAR-008 §22)
export enum IssueInterventionResult {
  SYMPTOM_RESOLVED = 'SYMPTOM_RESOLVED',
  SYMPTOM_REDUCED = 'SYMPTOM_REDUCED',
  NO_CHANGE = 'NO_CHANGE',
  WORSENED = 'WORSENED',
  UNKNOWN = 'UNKNOWN',
  AWAITING_OBSERVATION = 'AWAITING_OBSERVATION',
}

// Resolution Type (GAR-008 §26)
export enum IssueResolutionType {
  REPAIR_CONFIRMED = 'REPAIR_CONFIRMED',
  SYMPTOM_NO_LONGER_PRESENT = 'SYMPTOM_NO_LONGER_PRESENT',
  DIAGNOSTIC_CORRECTION = 'DIAGNOSTIC_CORRECTION',
  OWNER_CONFIRMED = 'OWNER_CONFIRMED',
  PROVIDER_CONFIRMED = 'PROVIDER_CONFIRMED',
  AUTO_CLOSED_AFTER_MONITORING = 'AUTO_CLOSED_AFTER_MONITORING',
  OTHER = 'OTHER',
}

// Follow-up Status (GAR-008 §51-§53)
export enum FollowupStatus {
  SCHEDULED = 'SCHEDULED',
  DUE = 'DUE',
  SENT = 'SENT',
  RESPONDED = 'RESPONDED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum FollowupResponse {
  YES = 'YES',       // Problem still happening
  NO = 'NO',         // Problem stopped
  NOT_SURE = 'NOT_SURE',
}

// Next Recommended Action (GAR-008 §54-§55)
export interface NextRecommendedAction {
  action_type: 'STOP_DRIVING_SAFETY_WARNING' | 'BOOK_INSPECTION' | 'BOOK_REPAIR' | 'MONITOR' | 'AWAITING_FOLLOW_UP' | 'RESOLVED_NO_ACTION' | 'BOOK_DIAGNOSTIC';
  label: string;
  reason: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommended_provider_type?: string;
}

// ============================================================================
// Canonical Entities
// ============================================================================

export interface VehicleIssue {
  id: string;
  vehicle_id: string;
  issue_code: string | null;
  title: string;
  summary: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  persistence_state: IssuePersistenceState;
  primary_component_category: string | null;
  first_observed_at: string;
  last_observed_at: string;
  first_observed_odometer_km: number | null;
  last_observed_odometer_km: number | null;
  occurrence_count: number;
  diagnosis_count: number;
  intervention_count: number;
  last_intervention_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface IssueOccurrence {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  occurred_at: string;
  recorded_at: string;
  odometer_value: number | null;
  odometer_unit: string;
  odometer_km: number | null;
  description: string;
  symptom_category: SymptomCategory;
  driving_condition: string | null;
  speed_range: string | null;
  engine_temperature_state: string | null;
  weather_context: string | null;
  road_condition: string | null;
  source_type: DataProvenanceClass;
  actor_id: string;
  location_reference: string | null;
  evidence_count: number;
  created_at: string;
}

export interface IssueObservation {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  observation_type: ObservationType;
  description: string;
  source_type: DataProvenanceClass;
  source_reference_id: string | null;
  observed_at: string;
  recorded_at: string;
  actor_id: string | null;
  provider_id: string | null;
  verification_status: string;
  created_at: string;
}

export interface IssueSuspectedCause {
  id: string;
  vehicle_issue_id: string;
  component_category: string;
  description: string;
  confidence: number | null;
  source_type: string;
  proposed_by: string;
  proposed_at: string;
  status: SuspectedCauseStatus;
  created_at: string;
}

export interface IssueDiagnosis {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  provider_id: string;
  provider_name: string;
  technician_id: string | null;
  technician_name: string | null;
  diagnosed_at: string;
  diagnosis_code: string | null;
  diagnosis_summary: string;
  diagnosis_details: string;
  confirmed_component: string | null;
  outcome: DiagnosisOutcome;
  verification_status: string; // PROVIDER_RECORDED
  evidence_reference_ids: string[];
  source_work_order_id: string | null;
  created_at: string;
}

export interface IssueIntervention {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  diagnosis_id?: string | null;
  intervention_type: IssueInterventionType;
  description: string;
  performed_at: string;
  odometer_value: number | null;
  odometer_unit: string;
  odometer_km: number | null;
  provider_id: string | null;
  provider_name: string | null;
  work_order_id: string | null;
  replaced_part_names: string[];
  cost_total: number | null;
  currency: string | null;
  result: IssueInterventionResult;
  verification_status: string;
  notes: string | null;
  created_at: string;
}

export interface IssueResolution {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  resolved_at: string;
  resolved_odometer_km: number | null;
  resolution_type: IssueResolutionType;
  resolution_summary: string;
  resolved_by: string;
  source_type: string;
  confirmation_state: string;
  notes: string | null;
  created_at: string;
}

export interface IssueFollowup {
  id: string;
  vehicle_issue_id: string;
  intervention_id: string;
  scheduled_at: string;
  due_date: string;
  due_odometer_km: number | null;
  status: FollowupStatus;
  prompt_message: string;
  response: FollowupResponse | null;
  response_notes: string | null;
  responded_at: string | null;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueEvidenceLink {
  id: string;
  vehicle_issue_id: string;
  occurrence_id: string | null;
  file_id: string;
  file_url: string;
  evidence_type: string;
  title: string;
  caption: string | null;
  captured_at: string | null;
  uploaded_at: string;
  uploaded_by: string;
  created_at: string;
}

export interface IssueMergeRecord {
  id: string;
  surviving_issue_id: string;
  merged_issue_id: string;
  vehicle_id: string;
  reason: string;
  merged_by: string;
  merged_at: string;
}

// ============================================================================
// Projections & Aggregates
// ============================================================================

export interface EnrichedVehicleIssue extends VehicleIssue {
  occurrences: IssueOccurrence[];
  observations: IssueObservation[];
  suspected_causes: IssueSuspectedCause[];
  diagnoses: IssueDiagnosis[];
  interventions: IssueIntervention[];
  resolution: IssueResolution | null;
  followups: IssueFollowup[];
  evidence: IssueEvidenceLink[];
  next_recommended_action: NextRecommendedAction;
  days_open: number;
  days_since_last_occurrence: number;
}

export interface PersistentIssueSummary {
  issue_id: string;
  vehicle_id: string;
  title: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  persistence_state: IssuePersistenceState;
  first_observed_at: string;
  last_observed_at: string;
  occurrence_count: number;
  previous_diagnoses: Array<{
    provider_name: string;
    diagnosed_at: string;
    diagnosis_summary: string;
    confirmed_component: string | null;
  }>;
  previous_interventions: Array<{
    intervention_type: IssueInterventionType;
    description: string;
    performed_at: string;
    provider_name: string | null;
    result: IssueInterventionResult;
    replaced_parts: string[];
  }>;
  current_state_summary: string;
  next_recommended_action: NextRecommendedAction;
}

export interface IssueChronologyItem {
  id: string;
  timestamp: string;
  event_type: 'REPORTED' | 'OCCURRENCE' | 'OBSERVATION' | 'SUSPECTED_CAUSE' | 'DIAGNOSIS' | 'INTERVENTION' | 'MONITORING' | 'FOLLOWUP' | 'RESOLVED' | 'RECURRED' | 'MERGED';
  title: string;
  description: string;
  actor_name: string;
  actor_type: string;
  odometer_km: number | null;
  verification_status?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// DTOs
// ============================================================================

export interface ReportIssueDTO {
  title: string;
  summary: string;
  category: IssueCategory;
  severity?: IssueSeverity;
  primary_component_category?: string;
  occurred_at?: string;
  odometer_value?: number;
  odometer_unit?: string;
  symptom_category?: SymptomCategory;
  driving_condition?: string;
  speed_range?: string;
  engine_temperature_state?: string;
  weather_context?: string;
  road_condition?: string;
  symptom_description?: string;
  link_existing_issue_id?: string;
}

export interface RecordOccurrenceDTO {
  occurred_at?: string;
  odometer_value?: number;
  odometer_unit?: string;
  description: string;
  symptom_category?: SymptomCategory;
  driving_condition?: string;
  speed_range?: string;
  engine_temperature_state?: string;
  weather_context?: string;
  road_condition?: string;
}

export interface RecordDiagnosisDTO {
  provider_id?: string;
  provider_name: string;
  technician_id?: string;
  technician_name?: string;
  diagnosed_at?: string;
  diagnosis_code?: string;
  diagnosis_summary: string;
  diagnosis_details: string;
  confirmed_component?: string;
  outcome?: DiagnosisOutcome;
  source_work_order_id?: string;
}

export interface RecordInterventionDTO {
  diagnosis_id?: string;
  intervention_type: IssueInterventionType;
  description: string;
  performed_at?: string;
  odometer_value?: number;
  odometer_unit?: string;
  provider_id?: string;
  provider_name?: string;
  work_order_id?: string;
  replaced_part_names?: string[];
  cost_total?: number;
  currency?: string;
  result?: IssueInterventionResult;
  notes?: string;
  schedule_followup_days?: number;
  schedule_followup_km?: number;
}

export interface ResolveIssueDTO {
  resolution_type: IssueResolutionType;
  resolution_summary: string;
  resolved_at?: string;
  resolved_odometer_km?: number;
  notes?: string;
}

export interface RecurIssueDTO {
  recurred_at?: string;
  odometer_value?: number;
  odometer_unit?: string;
  description: string;
  driving_condition?: string;
  speed_range?: string;
}

export interface FollowupResponseDTO {
  response: FollowupResponse;
  notes?: string;
}

export interface MergeIssuesDTO {
  surviving_issue_id: string;
  merged_issue_id: string;
  reason: string;
}
