import { CareGuidanceAction } from '../carCare/types';

export type TripGuardianJourneyStatus =
  | 'PREPARED'
  | 'IN_PROGRESS'
  | 'ARRIVED'
  | 'CANCELLED';

export type TripGuardianReadinessLevel =
  | 'CANONICAL_STOP_DRIVING'
  | 'ATTENTION_RECORDED'
  | 'CHECKLIST_INCOMPLETE'
  | 'REVIEWED';

export type TripGuardianCheckInStatus =
  | 'PENDING'
  | 'RESPONDED'
  | 'MISSED'
  | 'CANCELLED';

export type TripGuardianCheckInResponse =
  | 'OKAY'
  | 'DELAYED'
  | 'NEED_HELP';

export interface TripGuardianJourney {
  id: string;
  user_id: string;
  vehicle_id: string;
  status: TripGuardianJourneyStatus;
  origin_label: string;
  destination_label: string;
  planned_departure_at: string | null;
  expected_arrival_at: string | null;
  purpose: string | null;
  pretrip_mission_id: string;
  location_sharing_enabled: boolean;
  checkins_enabled: boolean;
  checkin_interval_minutes: number | null;
  started_at: string | null;
  arrived_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  start_warning_acknowledged_at: string | null;
  start_warning_acknowledgement: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripGuardianContactShare {
  id: string;
  journey_id: string;
  contact_id: string;
  share_journey_status: boolean;
  share_vehicle_summary: boolean;
  share_location_when_available: boolean;
  status: 'CONFIGURED' | 'REVOKED';
  created_at: string;
  updated_at: string;
}

export interface TripGuardianCheckIn {
  id: string;
  journey_id: string;
  user_id: string;
  status: TripGuardianCheckInStatus;
  due_at: string;
  prompted_at: string | null;
  responded_at: string | null;
  response: TripGuardianCheckInResponse | null;
  response_notes: string | null;
  missed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripGuardianLocationSnapshot {
  id: string;
  journey_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  captured_at: string;
  source_type: 'USER_DEVICE';
  purpose: 'TRIP_GUARDIAN';
  sharing_authorized: boolean;
  expires_at: string;
  access_revoked_at: string | null;
  created_at: string;
}

export interface TripGuardianEscalationLink {
  id: string;
  journey_id: string;
  escalation_type: 'SOS';
  target_reference_id: string;
  created_by: string;
  created_at: string;
}

export interface TripGuardianReadiness {
  journey_id: string;
  vehicle_id: string;
  generated_at: string;
  level: TripGuardianReadinessLevel;
  start_allowed: boolean;
  requires_start_acknowledgement: boolean;
  pretrip_mission_status: string;
  pretrip_progress_percent: number;
  pretrip_pending_count: number;
  pretrip_concerns_reported: number;
  pretrip_professional_help_required: number;
  maintenance_overdue_count: number;
  maintenance_due_count: number;
  active_issue_count: number;
  critical_issue_count: number;
  grounding_issue_ids: string[];
  actions: CareGuidanceAction[];
  statement: string;
}

export interface TripGuardianAggregate {
  journey: TripGuardianJourney;
  readiness: TripGuardianReadiness;
  contact_shares: TripGuardianContactShare[];
  checkins: TripGuardianCheckIn[];
  latest_location: TripGuardianLocationSnapshot | null;
  escalation_links: TripGuardianEscalationLink[];
  truth: {
    live_tracking_active: false;
    crash_detection_active: false;
    automatic_emergency_escalation_active: false;
    missed_checkin_means_injury: false;
    journey_status_is_safety_certification: false;
  };
}

export interface CreateTripGuardianJourneyInput {
  vehicle_id: string;
  origin_label: string;
  destination_label: string;
  planned_departure_at?: string | null;
  expected_arrival_at?: string | null;
  purpose?: string | null;
  location_sharing_enabled?: boolean;
  checkins_enabled?: boolean;
  checkin_interval_minutes?: number | null;
  contact_ids?: string[];
}

export interface UpdateTripGuardianJourneyInput {
  origin_label?: string;
  destination_label?: string;
  planned_departure_at?: string | null;
  expected_arrival_at?: string | null;
  purpose?: string | null;
  location_sharing_enabled?: boolean;
  checkins_enabled?: boolean;
  checkin_interval_minutes?: number | null;
  contact_ids?: string[];
}

export interface RecordTripLocationInput {
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  captured_at?: string;
}

export interface StartTripInput {
  acknowledge_readiness_warnings?: boolean;
  acknowledgement_note?: string;
}

export interface EscalateTripToSosInput {
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
    captured_at?: string;
  };
}
