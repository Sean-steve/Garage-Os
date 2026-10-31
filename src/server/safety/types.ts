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
  sos_engine_active: false;
  notification_engine_active: false;
  trusted_contact_portal_active: false;
  blockers: string[];
  notes: string[];
}
