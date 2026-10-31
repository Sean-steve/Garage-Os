/**
 * Garage OS — Sprint 15: Emergency Circle & Human Safety Foundation (GAR-017)
 *
 * Configuration only. This module does not activate SOS, dispatch notifications,
 * infer injury, or claim notification delivery.
 */

export enum SafetyIncidentLevel {
  ASSISTANCE = 'ASSISTANCE',
  BREAKDOWN = 'BREAKDOWN',
  SERIOUS_EMERGENCY = 'SERIOUS_EMERGENCY',
}

export enum EmergencyContactStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum EmergencyContactVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
}

export interface EmergencyContactScope {
  id: string;
  contact_id: string;
  incident_level: SafetyIncidentLevel;
  notify_contact: boolean;
  share_incident_type: boolean;
  share_vehicle_summary: boolean;
  share_live_location: boolean;
  share_assistance_status: boolean;
  share_callback_number: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmergencyContact {
  id: string;
  user_id: string;
  display_name: string;
  relationship_label?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  priority: number;
  status: EmergencyContactStatus;
  verification_status: EmergencyContactVerificationStatus;
  created_at: string;
  updated_at: string;
  revoked_at?: string | null;
  scopes: EmergencyContactScope[];
}

export interface HumanSafetyPreferences {
  user_id: string;
  emergency_circle_enabled: boolean;
  allow_location_sharing: boolean;
  safety_check_enabled: boolean;
  safety_check_timeout_seconds: number;
  sos_cancel_countdown_seconds: number;
  escalation_sequence_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddEmergencyContactInput {
  display_name: string;
  relationship_label?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  priority?: number;
}

export interface UpdateEmergencyContactInput {
  display_name?: string;
  relationship_label?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  priority?: number;
}

export interface UpdateContactScopeInput {
  incident_level: SafetyIncidentLevel;
  notify_contact: boolean;
  share_incident_type: boolean;
  share_vehicle_summary: boolean;
  share_live_location: boolean;
  share_assistance_status: boolean;
  share_callback_number: boolean;
}

export interface UpdateHumanSafetyPreferencesInput {
  emergency_circle_enabled?: boolean;
  allow_location_sharing?: boolean;
  safety_check_enabled?: boolean;
  safety_check_timeout_seconds?: number;
  sos_cancel_countdown_seconds?: number;
  escalation_sequence_enabled?: boolean;
}

export interface SafetyReadiness {
  state: 'DISABLED' | 'INCOMPLETE' | 'CONFIGURED';
  active_contact_count: number;
  contacts_with_phone_count: number;
  location_sharing_enabled: boolean;
  safety_check_enabled: boolean;
  sos_engine_active: boolean;
  notification_engine_active: boolean;
  trusted_contact_portal_active: boolean;
  blockers: string[];
  notes: string[];
}

export enum SosIncidentStatus {
  COUNTDOWN = 'COUNTDOWN',
  ACTIVATED = 'ACTIVATED',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

export enum SosNotificationStatus {
  QUEUED = 'QUEUED',
  ATTEMPTED = 'ATTEMPTED',
  PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  SKIPPED = 'SKIPPED',
}

export enum SosSafetyCheckStatus {
  PENDING = 'PENDING',
  RESPONDED = 'RESPONDED',
  TIMED_OUT = 'TIMED_OUT',
}

export enum SosSafetyCheckResponse {
  OKAY = 'OKAY',
  NEED_HELP = 'NEED_HELP',
  CANNOT_CONFIRM = 'CANNOT_CONFIRM',
}

export interface SosIncident {
  id: string;
  user_id: string;
  vehicle_id?: string | null;
  incident_level: SafetyIncidentLevel;
  incident_type: string;
  status: SosIncidentStatus;
  activation_source: string;
  activation_attempted_at: string;
  server_acknowledged_at: string;
  cancel_deadline_at: string;
  activated_at?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  cancellation_reason?: string | null;
  closure_reason?: string | null;
  notification_state: string;
  safety_check_state: string;
  assistance_state: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SosLocationSnapshot {
  id: string;
  incident_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  captured_at: string;
  purpose: string;
  source_type: string;
  sharing_authorized: boolean;
  expires_at: string;
  access_revoked_at?: string | null;
  created_at: string;
}

export interface SosNotificationAttempt {
  id: string;
  incident_id: string;
  contact_id: string;
  priority: number;
  channel: 'SMS' | 'EMAIL';
  status: SosNotificationStatus;
  share_incident_type: boolean;
  share_vehicle_summary: boolean;
  share_live_location: boolean;
  share_assistance_status: boolean;
  share_callback_number: boolean;
  provider_name?: string | null;
  provider_message_id?: string | null;
  queued_at: string;
  attempted_at?: string | null;
  provider_accepted_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SosSafetyCheck {
  id: string;
  incident_id: string;
  user_id: string;
  status: SosSafetyCheckStatus;
  prompted_at: string;
  due_at: string;
  responded_at?: string | null;
  response?: SosSafetyCheckResponse | null;
  response_notes?: string | null;
  timed_out_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitiateSosInput {
  vehicle_id?: string | null;
  incident_type?: string;
  incident_level?: SafetyIncidentLevel;
  activation_source?: 'USER_SOS_BUTTON' | 'ROAD_SIDE_ESCALATION' | 'MANUAL_SAFETY_ACTION';
  client_requested_at?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
    captured_at?: string;
  };
}

export interface SosIncidentAggregate {
  incident: SosIncident;
  location: SosLocationSnapshot | null;
  notification_attempts: SosNotificationAttempt[];
  safety_check: SosSafetyCheck | null;
  acknowledgement: {
    backend_acknowledged: boolean;
    backend_acknowledged_at: string;
    activation_complete: boolean;
    trusted_contact_delivery_confirmed: boolean;
    assistance_requested: boolean;
    assistance_accepted: boolean;
    assistance_arrived: boolean;
  };
}


export enum TrustedContactGrantStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum TrustedContactResponse {
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  CONTACTING_USER = 'CONTACTING_USER',
  CANNOT_ASSIST = 'CANNOT_ASSIST',
}

export interface TrustedContactAccessGrant {
  id: string;
  incident_id: string;
  contact_id: string;
  notification_attempt_id: string;
  token_digest: string;
  status: TrustedContactGrantStatus;
  expires_at: string;
  first_accessed_at?: string | null;
  last_accessed_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrustedContactResponseRecord {
  id: string;
  grant_id: string;
  incident_id: string;
  contact_id: string;
  response: TrustedContactResponse;
  created_at: string;
}

export interface TrustedContactPortalView {
  grant: {
    expires_at: string;
    status: TrustedContactGrantStatus;
  };
  contact: {
    display_name: string;
    relationship_label?: string | null;
  };
  owner: {
    display_name: string;
    callback_number?: string | null;
  };
  incident: {
    id: string;
    status: SosIncidentStatus;
    incident_type?: string | null;
    incident_level: SafetyIncidentLevel;
    activated_at?: string | null;
    created_at: string;
  };
  vehicle?: {
    make?: string | null;
    model?: string | null;
    registration_number?: string | null;
  } | null;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number | null;
    captured_at: string;
    expires_at: string;
  } | null;
  assistance?: {
    state: string;
    requested: boolean;
    accepted: boolean;
    arrived: boolean;
  } | null;
  latest_response?: TrustedContactResponseRecord | null;
  permissions: {
    incident_type: boolean;
    vehicle_summary: boolean;
    live_location: boolean;
    assistance_status: boolean;
    callback_number: boolean;
  };
  safety_truth: {
    backend_acknowledged: boolean;
    trusted_contact_delivery_confirmed: boolean;
    assistance_requested: boolean;
    assistance_accepted: boolean;
    assistance_arrived: boolean;
  };
}
