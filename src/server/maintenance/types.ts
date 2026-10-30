/**
 * Canonical Vehicle Maintenance, Service Scheduling & Due-State Intelligence Domain Types (GAR-006, GAR-033 §12D, GAR-034)
 */

import { OdometerUnit } from '../vehicle/types';

/**
 * Maintenance Categories (GAR-006 §7)
 */
export enum MaintenanceCategory {
  ENGINE = 'ENGINE',
  TRANSMISSION = 'TRANSMISSION',
  BRAKES = 'BRAKES',
  SUSPENSION = 'SUSPENSION',
  STEERING = 'STEERING',
  TYRES = 'TYRES',
  BATTERY = 'BATTERY',
  ELECTRICAL = 'ELECTRICAL',
  COOLING = 'COOLING',
  FLUIDS = 'FLUIDS',
  FILTERS = 'FILTERS',
  AIR_CONDITIONING = 'AIR_CONDITIONING',
  SAFETY = 'SAFETY',
  BODY = 'BODY',
  OTHER = 'OTHER',
}

/**
 * Interval Types (GAR-006 §9)
 */
export enum MaintenanceIntervalType {
  DISTANCE = 'DISTANCE',
  TIME = 'TIME',
  DISTANCE_OR_TIME = 'DISTANCE_OR_TIME',
  ONE_TIME = 'ONE_TIME',
  MANUAL = 'MANUAL',
  CONDITION_BASED_RESERVED = 'CONDITION_BASED_RESERVED',
}

/**
 * Trigger Policy for combined rules (GAR-006 §12)
 */
export enum MaintenanceTriggerPolicy {
  WHICHEVER_COMES_FIRST = 'WHICHEVER_COMES_FIRST',
  WHICHEVER_COMES_LAST = 'WHICHEVER_COMES_LAST',
  DISTANCE_ONLY = 'DISTANCE_ONLY',
  TIME_ONLY = 'TIME_ONLY',
}

/**
 * Rule Source Provenance (GAR-006 §13)
 */
export enum MaintenanceRuleSourceType {
  MANUFACTURER_SCHEDULE = 'MANUFACTURER_SCHEDULE',
  GARAGE_OS_CATALOG = 'GARAGE_OS_CATALOG',
  SERVICE_PROVIDER_RECOMMENDATION = 'SERVICE_PROVIDER_RECOMMENDATION',
  OWNER_DEFINED = 'OWNER_DEFINED',
  FLEET_POLICY = 'FLEET_POLICY',
  EXTERNAL_DATA_PROVIDER = 'EXTERNAL_DATA_PROVIDER',
}

/**
 * Rule and Completion Verification Status (GAR-006 §14)
 */
export enum MaintenanceVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  CATALOG_DEFINED = 'CATALOG_DEFINED',
  OWNER_ASSERTED = 'OWNER_ASSERTED',
  PROVIDER_CONFIRMED = 'PROVIDER_CONFIRMED',
  DOCUMENT_SUPPORTED = 'DOCUMENT_SUPPORTED',
  EXTERNAL_VERIFIED = 'EXTERNAL_VERIFIED',
}

/**
 * Maintenance Plan Status (GAR-006 §15)
 */
export enum MaintenancePlanStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
  DRAFT = 'DRAFT',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Plan Sources & Precedence (GAR-006 §17)
 * Precedence: OWNER_DEFINED (5) > SERVICE_PROVIDER_RECOMMENDATION (4) > FLEET_POLICY (3) > MANUFACTURER_SCHEDULE (2) > GARAGE_OS_CATALOG (1)
 */
export enum MaintenancePlanSource {
  OWNER_DEFINED = 'OWNER_DEFINED',
  SERVICE_PROVIDER_RECOMMENDATION = 'SERVICE_PROVIDER_RECOMMENDATION',
  FLEET_POLICY = 'FLEET_POLICY',
  MANUFACTURER_SCHEDULE = 'MANUFACTURER_SCHEDULE',
  GARAGE_OS_CATALOG = 'GARAGE_OS_CATALOG',
}

export const PLAN_SOURCE_PRECEDENCE: Record<MaintenancePlanSource, number> = {
  [MaintenancePlanSource.OWNER_DEFINED]: 5,
  [MaintenancePlanSource.SERVICE_PROVIDER_RECOMMENDATION]: 4,
  [MaintenancePlanSource.FLEET_POLICY]: 3,
  [MaintenancePlanSource.MANUFACTURER_SCHEDULE]: 2,
  [MaintenancePlanSource.GARAGE_OS_CATALOG]: 1,
};

/**
 * Maintenance Cycle / Due Status (GAR-006 §6-§12)
 */
export enum MaintenanceCycleStatus {
  OK = 'OK',                           // Within schedule, comfortable margin
  APPROACHING_DUE = 'APPROACHING_DUE', // Within approaching threshold (e.g. <= 1000 km or <= 30 days)
  DUE = 'DUE',                         // Within due threshold (e.g. <= 200 km or <= 7 days)
  OVERDUE = 'OVERDUE',                 // Target exceeded (negative remaining distance or past due date)
  DEFERRED = 'DEFERRED',               // Explicitly deferred by owner with valid target
  COMPLETED = 'COMPLETED',             // Work verified completed
  DISMISSED = 'DISMISSED',             // Dismissed by owner
  UNKNOWN = 'UNKNOWN',                 // Insufficient baseline or odometer data
}

export enum MaintenanceSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum MaintenanceReminderType {
  APPROACHING_DUE = 'APPROACHING_DUE',
  DUE = 'DUE',
  OVERDUE = 'OVERDUE',
  DEFERRED_EXPIRING = 'DEFERRED_EXPIRING',
}

export enum MaintenanceReminderChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export enum MaintenanceReminderStatus {
  SCHEDULED = 'SCHEDULED',
  SENT = 'SENT',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  DISMISSED = 'DISMISSED',
}

// -------------------------------------------------------------
// Database Entities
// -------------------------------------------------------------

export interface MaintenanceRequirementEntity {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: MaintenanceCategory;
  component_system: string;
  default_severity: MaintenanceSeverity;
  default_priority: number;
  recommended_action: string | null;
  recurring: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceRuleEntity {
  id: string;
  requirement_id: string;
  interval_type: MaintenanceIntervalType;
  distance_interval: number | null; // Always stored in KM
  distance_unit: OdometerUnit;
  time_interval_value: number | null;
  time_interval_unit: string | null; // DAYS, WEEKS, MONTHS, YEARS
  trigger_policy: MaintenanceTriggerPolicy;
  initial_distance: number | null;
  initial_time_offset_days: number | null;
  approaching_distance_threshold: number; // default 1000 km
  approaching_time_threshold_days: number; // default 30 days
  applicability_conditions: Record<string, unknown>;
  source_type: MaintenanceRuleSourceType;
  source_reference: string | null;
  verification_status: MaintenanceVerificationStatus;
  effective_from: string | null;
  effective_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleMaintenancePlanEntity {
  id: string;
  vehicle_id: string;
  name: string;
  status: MaintenancePlanStatus;
  source: MaintenancePlanSource;
  notes: string | null;
  created_at: string;
  activated_at: string | null;
  updated_at: string;
}

export interface VehicleMaintenancePlanEntryEntity {
  id: string;
  plan_id: string;
  requirement_id: string;
  rule_id: string;
  enabled: boolean;
  priority_override: number | null;
  custom_distance_interval: number | null; // KM
  custom_time_interval_value: number | null;
  custom_time_interval_unit: string | null;
  last_known_completion_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceCycleEntity {
  id: string;
  vehicle_id: string;
  plan_entry_id: string;
  requirement_id: string;
  rule_id: string;
  cycle_number: number;
  baseline_distance_km: number;
  baseline_date: string;
  due_distance_km: number | null;
  due_date: string | null;
  status: MaintenanceCycleStatus;
  trigger_reason: string | null;
  distance_remaining_km: number | null;
  days_remaining: number | null;
  deferred_until_date: string | null;
  deferred_until_distance_km: number | null;
  deferral_reason: string | null;
  completed_at: string | null;
  completion_id: string | null;
  last_evaluated_at: string;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceReplacedPart {
  part_number?: string;
  name: string;
  quantity: number;
  unit_price?: number;
  brand?: string;
}

export interface MaintenanceCompletionEntity {
  id: string;
  vehicle_id: string;
  plan_entry_id: string | null;
  requirement_id: string;
  cycle_id: string | null;
  completed_at: string;
  odometer_value: number;
  odometer_unit: OdometerUnit;
  service_provider_id: string | null;
  service_provider_name: string | null;
  service_record_id: string | null;
  performed_actions: string[]; // Parsed from JSON in repository
  replaced_parts: MaintenanceReplacedPart[]; // Parsed from JSON in repository
  cost_total: number;
  currency: string;
  notes: string | null;
  recorded_by: string;
  verification_status: MaintenanceVerificationStatus;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceDeferralEntity {
  id: string;
  vehicle_id: string;
  cycle_id: string;
  plan_entry_id: string;
  deferred_at: string;
  deferred_by: string;
  reason: string;
  deferred_until_date: string | null;
  deferred_until_distance_km: number | null;
  created_at: string;
}

export interface MaintenanceReminderEntity {
  id: string;
  vehicle_id: string;
  cycle_id: string;
  requirement_id: string;
  reminder_type: MaintenanceReminderType;
  channel: MaintenanceReminderChannel;
  target_date: string;
  status: MaintenanceReminderStatus;
  message: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

// -------------------------------------------------------------
// DTOs & Aggregated Models
// -------------------------------------------------------------

export interface EnrichedMaintenanceCycle {
  cycle: MaintenanceCycleEntity;
  requirement: MaintenanceRequirementEntity;
  rule: MaintenanceRuleEntity;
  plan_entry: VehicleMaintenancePlanEntryEntity;
  last_completion?: MaintenanceCompletionEntity | null;
  // Computed progress metrics
  distance_progress_percent: number | null; // 0 to 100+ %
  time_progress_percent: number | null;     // 0 to 100+ %
  effective_urgency_score: number;          // higher = more urgent
}

export interface VehicleMaintenanceStatusSummary {
  vehicle_id: string;
  overall_status: MaintenanceCycleStatus;
  total_requirements: number;
  overdue_count: number;
  due_count: number;
  approaching_count: number;
  ok_count: number;
  deferred_count: number;
  next_due_item: {
    requirement_name: string;
    category: MaintenanceCategory;
    status: MaintenanceCycleStatus;
    due_date: string | null;
    due_distance_km: number | null;
    distance_remaining_km: number | null;
    days_remaining: number | null;
  } | null;
  active_cycles: EnrichedMaintenanceCycle[];
  evaluated_at: string;
}

export interface RecordCompletionInput {
  requirement_id: string;
  cycle_id?: string;
  plan_entry_id?: string;
  completed_at: string;
  odometer_value: number;
  odometer_unit?: OdometerUnit | 'KM' | 'MILES';
  service_provider_id?: string;
  service_provider_name?: string;
  performed_actions?: string[];
  replaced_parts?: MaintenanceReplacedPart[];
  cost_total?: number;
  currency?: string;
  notes?: string;
  verification_status?: MaintenanceVerificationStatus;
  document_id?: string;
}

export interface RecordDeferralInput {
  cycle_id: string;
  reason: string;
  deferred_until_date?: string | null;
  deferred_until_distance_km?: number | null;
}

export interface AddPlanEntryInput {
  requirement_id: string;
  custom_distance_interval?: number | null;
  custom_time_interval_value?: number | null;
  custom_time_interval_unit?: string | null;
  priority_override?: number | null;
  notes?: string | null;
}

export interface UpdatePlanEntryInput {
  enabled?: boolean;
  custom_distance_interval?: number | null;
  custom_time_interval_value?: number | null;
  custom_time_interval_unit?: string | null;
  priority_override?: number | null;
  notes?: string | null;
}
