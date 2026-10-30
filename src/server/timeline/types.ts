/**
 * Canonical Vehicle Timeline & Digital Vehicle Passport Domain Types (GAR-005, GAR-033 §12C, GAR-034)
 */

import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { OdometerUnit } from '../vehicle/types';

/**
 * Canonical Timeline Entry Types (GAR-005 §7)
 */
export enum TimelineEntryType {
  VEHICLE_CREATED = 'VEHICLE_CREATED',
  ODOMETER_RECORDED = 'ODOMETER_RECORDED',
  ODOMETER_CORRECTED = 'ODOMETER_CORRECTED',
  OWNERSHIP_STARTED = 'OWNERSHIP_STARTED',
  OWNERSHIP_ENDED = 'OWNERSHIP_ENDED',
  DOCUMENT_ADDED = 'DOCUMENT_ADDED',
  MAINTENANCE_COMPLETED = 'MAINTENANCE_COMPLETED',
  SERVICE_COMPLETED = 'SERVICE_COMPLETED',
  REPAIR_COMPLETED = 'REPAIR_COMPLETED',
  INSPECTION_COMPLETED = 'INSPECTION_COMPLETED',
  ISSUE_REPORTED = 'ISSUE_REPORTED',
  ISSUE_RESOLVED = 'ISSUE_RESOLVED',
  ISSUE_RECURRED = 'ISSUE_RECURRED',
  PART_INSTALLED = 'PART_INSTALLED',
  PART_REMOVED = 'PART_REMOVED',
  TYRE_INSTALLED = 'TYRE_INSTALLED',
  TYRE_ROTATED = 'TYRE_ROTATED',
  TYRE_REPLACED = 'TYRE_REPLACED',
  FUEL_RECORDED = 'FUEL_RECORDED',
  ROADSIDE_INCIDENT = 'ROADSIDE_INCIDENT',
  TOW_COMPLETED = 'TOW_COMPLETED',
  ACCIDENT_RECORDED = 'ACCIDENT_RECORDED',
  MODIFICATION_INSTALLED = 'MODIFICATION_INSTALLED',
  DTC_DETECTED = 'DTC_DETECTED',
  DIAGNOSTIC_COMPLETED = 'DIAGNOSTIC_COMPLETED',
  TELEMETRY_OBSERVATION = 'TELEMETRY_OBSERVATION',
  AI_OBSERVATION = 'AI_OBSERVATION',
  VEHICLE_ARCHIVED = 'VEHICLE_ARCHIVED',
}

/**
 * Canonical Timeline Categories (GAR-005 §8)
 */
export enum TimelineCategory {
  ALL = 'ALL',
  IDENTITY = 'IDENTITY',
  OWNERSHIP = 'OWNERSHIP',
  MILEAGE = 'MILEAGE',
  MAINTENANCE = 'MAINTENANCE',
  SERVICE = 'SERVICE',
  REPAIR = 'REPAIR',
  ISSUE = 'ISSUE',
  PARTS = 'PARTS',
  TYRES = 'TYRES',
  FUEL = 'FUEL',
  ROADSIDE = 'ROADSIDE',
  ACCIDENT = 'ACCIDENT',
  MODIFICATION = 'MODIFICATION',
  DIAGNOSTIC = 'DIAGNOSTIC',
  TELEMETRY = 'TELEMETRY',
  DOCUMENT = 'DOCUMENT',
  OTHER = 'OTHER',
}

/**
 * Timeline Source Provenance Types (GAR-005 §9, GAR-041)
 */
export enum TimelineSourceType {
  OWNER_ENTERED = 'OWNER_ENTERED',
  PROVIDER_RECORDED = 'PROVIDER_RECORDED',
  GARAGE_VERIFIED = 'GARAGE_VERIFIED',
  DOCUMENT_SUPPORTED = 'DOCUMENT_SUPPORTED',
  DEVICE_TELEMETRY = 'DEVICE_TELEMETRY',
  SYSTEM_DERIVED = 'SYSTEM_DERIVED',
  AI_INFERENCE = 'AI_INFERENCE',
  EXTERNAL_VERIFIED = 'EXTERNAL_VERIFIED',
  PLATFORM_OPERATOR = 'PLATFORM_OPERATOR',
}

/**
 * Timeline Verification Statuses (GAR-005 §15)
 */
export enum TimelineVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  OWNER_ASSERTED = 'OWNER_ASSERTED',
  PROVIDER_RECORDED = 'PROVIDER_RECORDED',
  EVIDENCE_SUPPORTED = 'EVIDENCE_SUPPORTED',
  VERIFIED = 'VERIFIED',
  DISPUTED = 'DISPUTED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

/**
 * Timeline Visibility Levels (GAR-005 §20)
 */
export enum TimelineVisibility {
  OWNER_ONLY = 'OWNER_ONLY',
  AUTHORIZED_VEHICLE_USERS = 'AUTHORIZED_VEHICLE_USERS',
  SERVICE_PROVIDER_WHEN_GRANTED = 'SERVICE_PROVIDER_WHEN_GRANTED',
  FLEET_ORGANIZATION = 'FLEET_ORGANIZATION',
  PASSPORT_SHARED = 'PASSPORT_SHARED',
  PUBLIC_SHAREABLE = 'PUBLIC_SHAREABLE',
  SYSTEM_INTERNAL = 'SYSTEM_INTERNAL',
}

/**
 * Timeline Sensitivity Levels (GAR-005 §21)
 */
export enum TimelineSensitivity {
  NORMAL = 'NORMAL',
  PERSONAL = 'PERSONAL',
  SENSITIVE = 'SENSITIVE',
  EMERGENCY = 'EMERGENCY',
  FINANCIAL = 'FINANCIAL',
  LOCATION_SENSITIVE = 'LOCATION_SENSITIVE',
}

/**
 * Timeline Correction Reasons (GAR-005 §18)
 */
export enum TimelineCorrectionReason {
  DATA_ENTRY_ERROR = 'DATA_ENTRY_ERROR',
  WRONG_DATE = 'WRONG_DATE',
  WRONG_ODOMETER = 'WRONG_ODOMETER',
  WRONG_VEHICLE = 'WRONG_VEHICLE',
  INCORRECT_PROVIDER = 'INCORRECT_PROVIDER',
  DUPLICATE_RECORD = 'DUPLICATE_RECORD',
  OTHER = 'OTHER',
}

/**
 * Passport Sharing Scope (GAR-005 §38)
 */
export enum PassportShareScope {
  FULL_STANDARD_PASSPORT = 'FULL_STANDARD_PASSPORT',
  VEHICLE_IDENTITY = 'VEHICLE_IDENTITY',
  MILEAGE_HISTORY = 'MILEAGE_HISTORY',
  SERVICE_HISTORY = 'SERVICE_HISTORY',
  REPAIR_HISTORY = 'REPAIR_HISTORY',
  ACCIDENT_HISTORY = 'ACCIDENT_HISTORY',
  PART_HISTORY = 'PART_HISTORY',
  MODIFICATION_HISTORY = 'MODIFICATION_HISTORY',
}

/**
 * Canonical Vehicle Timeline Entry Entity (GAR-005 §6)
 */
export interface VehicleTimelineEntryEntity {
  id: string; // vte_...
  vehicle_id: string;
  entry_type: TimelineEntryType;
  category: TimelineCategory;
  occurred_at: string; // Business occurrence UTC ISO
  recorded_at: string; // Platform recorded UTC ISO
  title: string;
  summary: string;
  source_type: TimelineSourceType;
  source_reference_type: string | null; // e.g. DOMAIN_EVENT, ODOMETER_OBSERVATION, DOCUMENT
  source_reference_id: string | null;
  source_event_id: string | null; // Idempotent deduplication key
  actor_type: CanonicalActorType | null;
  actor_id: string | null;
  organization_id: string | null;
  verification_status: TimelineVerificationStatus;
  confidence: number | null; // 0.0 to 1.0
  odometer_value: number | null;
  odometer_unit: OdometerUnit | null;
  location_reference: string | null;
  visibility: TimelineVisibility;
  sensitivity: TimelineSensitivity;
  supersedes_timeline_entry_id: string | null;
  corrected_by_timeline_entry_id: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Timeline Correction Audit Record (GAR-005 §17)
 */
export interface TimelineCorrectionEntity {
  id: string; // corr_...
  vehicle_id: string;
  original_entry_id: string;
  corrected_entry_id: string;
  correction_reason: TimelineCorrectionReason;
  explanation: string;
  actor_id: string;
  actor_type: string;
  created_at: string;
}

/**
 * Timeline Dispute Entity (GAR-005 §19)
 */
export interface TimelineDisputeEntity {
  id: string; // disp_...
  vehicle_id: string;
  timeline_entry_id: string;
  dispute_reason: string;
  actor_id: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

/**
 * Materialized Vehicle Passport Projection Entity (GAR-005 §22-§26)
 */
export interface VehiclePassportProjectionEntity {
  vehicle_id: string;
  version: number;
  passport_payload: string; // JSON encoded VehiclePassportDTO
  integrity_hash: string;   // Deterministic SHA-256
  source_version: number;
  is_stale: boolean;
  last_projected_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Passport Secure Share Grant Entity (GAR-005 §33-§39)
 */
export interface PassportShareGrantEntity {
  id: string; // vpsg_...
  vehicle_id: string;
  created_by: string;
  token_hash: string;
  scope: string; // JSON array of PassportShareScope or 'FULL_STANDARD_PASSPORT'
  recipient_label: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Passport Share Access Log Entity (GAR-005 §36)
 */
export interface PassportShareAccessLogEntity {
  id: string;
  share_grant_id: string;
  ip_address: string | null;
  user_agent: string | null;
  accessed_at: string;
}

/**
 * Request DTOs
 */
export interface CreateTimelineEntryDTO {
  entry_type: TimelineEntryType;
  category: TimelineCategory;
  occurred_at: string;
  title: string;
  summary: string;
  source_type: TimelineSourceType;
  source_reference_type?: string;
  source_reference_id?: string;
  source_event_id?: string;
  actor_type?: CanonicalActorType;
  actor_id?: string;
  organization_id?: string;
  verification_status?: TimelineVerificationStatus;
  confidence?: number;
  odometer_value?: number;
  odometer_unit?: OdometerUnit;
  location_reference?: string;
  visibility?: TimelineVisibility;
  sensitivity?: TimelineSensitivity;
  metadata?: Record<string, unknown>;
}

export interface SubmitTimelineCorrectionDTO {
  reason: TimelineCorrectionReason;
  explanation: string;
  updated_title?: string;
  updated_summary?: string;
  updated_occurred_at?: string;
  updated_odometer_value?: number;
  updated_odometer_unit?: OdometerUnit;
  metadata?: Record<string, unknown>;
}

export interface SubmitTimelineDisputeDTO {
  reason: string;
}

export interface TimelineFilterQueryDTO {
  category?: TimelineCategory;
  entry_type?: TimelineEntryType;
  from_date?: string;
  to_date?: string;
  limit?: number;
  cursor?: string;
  include_superseded?: boolean;
}

export interface TimelineCursorPaginatedResultDTO {
  entries: VehicleTimelineEntryEntity[];
  next_cursor: string | null;
  has_more: boolean;
  total_count: number;
}

/**
 * Canonical Digital Vehicle Passport View Structure (GAR-005 §22)
 */
export interface VehiclePassportDTO {
  metadata: {
    vehicle_id: string;
    passport_version: number;
    generated_at: string;
    data_coverage_start: string | null;
    data_coverage_end: string;
    record_count: number;
    last_updated_at: string;
    integrity_hash: string;
    is_projection_current: boolean;
  };

  vehicle_identity: {
    vehicle_id: string;
    display_name: string;
    make: string;
    model: string;
    model_year: number;
    trim: string | null;
    vin: string | null;
    vin_masked: string | null;
    chassis_number: string | null;
    registration_number: string | null;
    color: string | null;
    fuel_type: string;
    transmission: string;
    drive_type: string | null;
    body_type: string | null;
    country_of_registration: string;
    status: string;
    verification_status: string;
  };

  ownership_summary: {
    total_ownership_periods: number;
    current_ownership_type: string;
    current_period_start_date: string | null;
    privacy_note: string;
  };

  mileage_history: {
    earliest_reading: {
      reading_km: number;
      reading_value: number;
      unit: OdometerUnit;
      observed_at: string;
    } | null;
    latest_reading: {
      reading_km: number;
      reading_value: number;
      unit: OdometerUnit;
      observed_at: string;
    } | null;
    total_observations_count: number;
    flagged_anomalies_count: number;
    has_rollback_warning: boolean;
    observations: Array<{
      id: string;
      reading_km: number;
      reading_value: number;
      unit: OdometerUnit;
      observed_at: string;
      source_class: string;
      verification_status: string;
      status: string;
      flag_reason: string | null;
    }>;
  };

  maintenance_history: {
    records_count: number;
    verified_records_count: number;
    records: Array<{
      id: string;
      title: string;
      summary: string;
      occurred_at: string;
      odometer_km: number | null;
      provider_name: string | null;
      verification_status: string;
    }>;
  };

  repair_history: {
    records_count: number;
    records: Array<{
      id: string;
      title: string;
      summary: string;
      occurred_at: string;
      odometer_km: number | null;
      verification_status: string;
    }>;
  };

  known_issues_history: {
    open_count: number;
    resolved_count: number;
    records: Array<{
      id: string;
      title: string;
      status: string;
      reported_at: string;
      resolved_at: string | null;
    }>;
  };

  installed_parts: {
    parts_count: number;
    records: Array<{
      id: string;
      name: string;
      category: string;
      installed_at: string;
      odometer_km: number | null;
    }>;
  };

  tyres: {
    installed_records_count: number;
    records: Array<{
      id: string;
      brand: string;
      size: string;
      position: string;
      installed_at: string;
    }>;
  };

  accident_history: {
    known_records_count: number;
    statement: string; // e.g. "No accident records are currently recorded in Garage OS."
    records: Array<{
      id: string;
      incident_date: string;
      severity: string;
      summary: string;
    }>;
  };

  roadside_towing_history: {
    incidents_count: number;
    records: Array<{
      id: string;
      date: string;
      incident_type: string;
      summary: string;
    }>;
  };

  modifications: {
    modifications_count: number;
    records: Array<{
      id: string;
      title: string;
      installed_at: string;
      summary: string;
    }>;
  };

  inspections: {
    inspections_count: number;
    records: Array<{
      id: string;
      inspection_type: string;
      conducted_at: string;
      result: string;
      inspector: string | null;
    }>;
  };

  verification_summary: {
    vin_status: string;
    data_sources_breakdown: {
      externally_verified: number;
      provider_recorded: number;
      owner_asserted: number;
      device_observed: number;
      system_derived: number;
    };
    total_timeline_entries: number;
    coverage_statement: string;
  };
}

export interface CreatePassportShareDTO {
  scopes: PassportShareScope[];
  recipient_label?: string;
  expires_in_hours?: number; // default 72
}

export interface PassportShareResultDTO {
  share_id: string;
  token: string;
  share_url: string;
  expires_at: string;
  scopes: PassportShareScope[];
  recipient_label: string | null;
}

export interface PublicSharedPassportDTO {
  passport: Partial<VehiclePassportDTO>;
  share_info: {
    recipient_label: string | null;
    expires_at: string;
    granted_scopes: PassportShareScope[];
  };
}
