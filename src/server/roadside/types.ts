/**
 * GAR-014: Roadside Assistance Architecture
 * Domain Types, Enums & Interfaces
 */

export enum RoadsideIncidentStatus {
  DRAFT = 'DRAFT',
  TRIAGED = 'TRIAGED',
  REQUESTED = 'REQUESTED',
  DISPATCHED = 'DISPATCHED',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  TOW_REQUIRED = 'TOW_REQUIRED',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

export enum IncidentSeverity {
  ROUTINE = 'ROUTINE',
  ELEVATED = 'ELEVATED',
  URGENT_UNSAFE = 'URGENT_UNSAFE',
  CRITICAL_HIGHWAY = 'CRITICAL_HIGHWAY',
  SEVERE = 'SEVERE',
}

export enum IncidentType {
  PUNCTURE_OR_FLAT_TYRE = 'PUNCTURE_OR_FLAT_TYRE',
  BATTERY_DEAD = 'BATTERY_DEAD',
  ENGINE_OVERHEAT = 'ENGINE_OVERHEAT',
  ELECTRICAL_OR_STARTER = 'ELECTRICAL_OR_STARTER',
  MECHANICAL_BREAKDOWN = 'MECHANICAL_BREAKDOWN',
  FUEL_STARVATION_OR_CONTAMINATION = 'FUEL_STARVATION_OR_CONTAMINATION',
  LOCKOUT = 'LOCKOUT',
  COLLISION_OR_DITCH = 'COLLISION_OR_DITCH',
  UNKNOWN_NOISE_OR_SMOKE = 'UNKNOWN_NOISE_OR_SMOKE',
  ENGINE_FAILURE = 'ENGINE_FAILURE',
  OTHER_BREAKDOWN = 'OTHER_BREAKDOWN',
}

export enum DrivabilityState {
  DRIVABLE = 'DRIVABLE',
  RESTRICTED_LIMP = 'RESTRICTED_LIMP',
  NON_DRIVABLE = 'NON_DRIVABLE',
  DANGEROUS_TO_OPERATE = 'DANGEROUS_TO_OPERATE',
  IMMOBILE = 'IMMOBILE',
  UNKNOWN = 'UNKNOWN',
}

export enum OccupantSafetyState {
  SAFE = 'SAFE',
  HAZARDOUS_CARRIAGEWAY = 'HAZARDOUS_CARRIAGEWAY',
  UNSAFE_ENVIRONMENT = 'UNSAFE_ENVIRONMENT',
  INJURIES_REPORTED = 'INJURIES_REPORTED',
  SAFE_ROAD_SHOULDER = 'SAFE_ROAD_SHOULDER',
}

export enum AssistanceType {
  ROADSIDE_MOBILE_REPAIR = 'ROADSIDE_MOBILE_REPAIR',
  JUMP_START = 'JUMP_START',
  TYRE_CHANGE_OR_INFLATE = 'TYRE_CHANGE_OR_INFLATE',
  FUEL_DELIVERY = 'FUEL_DELIVERY',
  LOCKOUT_ENTRY = 'LOCKOUT_ENTRY',
  FLUID_TOP_UP = 'FLUID_TOP_UP',
  TOW_FLATBED = 'TOW_FLATBED',
  TOW_WHEEL_LIFT = 'TOW_WHEEL_LIFT',
  WINCH_OR_RECOVERY = 'WINCH_OR_RECOVERY',
}

export enum LocationSource {
  DEVICE_GPS = 'DEVICE_GPS',
  USER_MANUAL = 'USER_MANUAL',
  CELL_TRIANGULATION = 'CELL_TRIANGULATION',
  HIGHWAY_MARKER = 'HIGHWAY_MARKER',
}

export enum AssistanceRequestStatus {
  CREATED = 'CREATED',
  BROADCASTING = 'BROADCASTING',
  MATCHED = 'MATCHED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum DispatchMode {
  AUTOMATIC_BROADCAST = 'AUTOMATIC_BROADCAST',
  DISPATCHER_DIRECT = 'DISPATCHER_DIRECT',
  PREFERRED_PROVIDER = 'PREFERRED_PROVIDER',
}

export enum ProviderOfferStatus {
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum AssignmentStatus {
  ASSIGNED = 'ASSIGNED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  ON_SITE = 'ON_SITE',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum InterventionResult {
  REPAIRED_AND_DRIVABLE = 'REPAIRED_AND_DRIVABLE',
  TEMPORARY_LIMP_HOME = 'TEMPORARY_LIMP_HOME',
  CANNOT_REPAIR_TOW_REQUIRED = 'CANNOT_REPAIR_TOW_REQUIRED',
  TOW_REQUIRED = 'TOW_REQUIRED',
  FALSE_ALARM_OR_DRIVER_RESOLVED = 'FALSE_ALARM_OR_DRIVER_RESOLVED',
  SAFETY_ABORT = 'SAFETY_ABORT',
}

export enum InterventionActionType {
  BATTERY_BOOST = 'BATTERY_BOOST',
  BATTERY_REPLACEMENT = 'BATTERY_REPLACEMENT',
  TYRE_INSPECTION = 'TYRE_INSPECTION',
  TYRE_CHANGE_SPARE = 'TYRE_CHANGE_SPARE',
  TYRE_PUNCTURE_PLUG = 'TYRE_PUNCTURE_PLUG',
  TYRE_INFLATION = 'TYRE_INFLATION',
  FUEL_DELIVERY_PETROL = 'FUEL_DELIVERY_PETROL',
  FUEL_DELIVERY_DIESEL = 'FUEL_DELIVERY_DIESEL',
  COOLANT_LEAK_CHECK = 'COOLANT_LEAK_CHECK',
  COOLANT_TOP_UP = 'COOLANT_TOP_UP',
  OIL_TOP_UP = 'OIL_TOP_UP',
  LOCKOUT_ENTRY = 'LOCKOUT_ENTRY',
  DIAGNOSTIC_SCAN = 'DIAGNOSTIC_SCAN',
  FUSE_REPLACEMENT = 'FUSE_REPLACEMENT',
  HOSE_CLAMP_FIX = 'HOSE_CLAMP_FIX',
  BELT_INSPECTION = 'BELT_INSPECTION',
  WHEEL_NUT_TIGHTEN = 'WHEEL_NUT_TIGHTEN',
  TEMPORARY_LIMP_FIX = 'TEMPORARY_LIMP_FIX',
  TOW_PREPARATION = 'TOW_PREPARATION',
}

export enum EvidenceType {
  SCENE_PHOTO = 'SCENE_PHOTO',
  VEHICLE_DAMAGE = 'VEHICLE_DAMAGE',
  FLAT_TYRE = 'FLAT_TYRE',
  DASHBOARD_WARNING = 'DASHBOARD_WARNING',
  ODOMETER_PHOTO = 'ODOMETER_PHOTO',
  REPAIR_RESULT = 'REPAIR_RESULT',
  TOW_HOOKUP = 'TOW_HOOKUP',
  AUDIO_VOICE_NOTE = 'AUDIO_VOICE_NOTE',
}

export enum TowDestinationType {
  REPAIR_FACILITY = 'REPAIR_FACILITY',
  GARAGE = 'GARAGE',
  BODY_SHOP = 'BODY_SHOP',
  OWNER_RESIDENCE = 'OWNER_RESIDENCE',
  OWNER_LOCATION = 'OWNER_LOCATION',
  IMPOUND_OR_HOLDING = 'IMPOUND_OR_HOLDING',
  TOW_YARD = 'TOW_YARD',
  DEALERSHIP = 'DEALERSHIP',
  DEALER = 'DEALER',
  OTHER = 'OTHER',
}

export interface RoadsideIncidentEntity {
  id: string;
  incident_number: string;
  vehicle_id: string;
  organization_id?: string | null;
  reported_by_user_id: string;
  reported_by_name: string;
  reported_by_phone?: string | null;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  status: RoadsideIncidentStatus;
  initial_drivability: DrivabilityState;
  occupant_safety_state: OccupantSafetyState;
  description?: string | null;
  safety_escalation_required: boolean | number;
  safety_escalation_notes?: string | null;
  current_location_id?: string | null;
  active_assistance_request_id?: string | null;
  active_assignment_id?: string | null;
  resolved_at?: string | null;
  cancelled_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadsideLocationEntity {
  id: string;
  incident_id: string;
  source: LocationSource;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  address_line?: string | null;
  road_or_highway?: string | null;
  landmark_description?: string | null;
  direction_of_travel?: string | null;
  is_dangerous_location: boolean | number;
  is_active: boolean | number;
  recorded_at: string;
  created_at: string;
}

export interface RoadsideTriageRecordEntity {
  id: string;
  incident_id: string;
  engine_version: string;
  triage_result: string;
  recommended_assistance_type: AssistanceType;
  safety_escalation_required: boolean | number;
  tow_required: boolean | number;
  guidance_notes?: string | null;
  conducted_by_user_id?: string | null;
  conducted_at: string;
  metadata_json?: string | null;
}

export interface RoadsideTriageAnswerEntity {
  id: string;
  triage_record_id: string;
  question_key: string;
  answer_value: string;
  risk_flag: boolean | number;
  created_at: string;
}

export interface RoadsideAssistanceRequestEntity {
  id: string;
  incident_id: string;
  requested_assistance_type: AssistanceType;
  status: AssistanceRequestStatus;
  dispatch_mode: DispatchMode;
  search_radius_km: number;
  created_at: string;
  expires_at?: string | null;
  fulfilled_assignment_id?: string | null;
  metadata_json?: string | null;
}

export interface RoadsideProviderOfferEntity {
  id: string;
  request_id: string;
  incident_id: string;
  provider_id: string;
  provider_branch_id?: string | null;
  status: ProviderOfferStatus;
  offered_at: string;
  expires_at: string;
  responded_at?: string | null;
  decline_reason?: string | null;
  estimated_arrival_minutes?: number | null;
  callout_charge_minor: number;
  currency: string;
  metadata_json?: string | null;
}

export interface RoadsideAssignmentEntity {
  id: string;
  incident_id: string;
  request_id?: string | null;
  offer_id?: string | null;
  provider_id: string;
  provider_branch_id?: string | null;
  assigned_technician_id?: string | null;
  technician_id?: string | null;
  assigned_technician_name?: string | null;
  assigned_technician_phone?: string | null;
  assigned_vehicle_reg?: string | null;
  status: AssignmentStatus | string;
  eta_minutes?: number | null;
  assigned_at?: string | null;
  dispatched_at?: string | null;
  en_route_at?: string | null;
  arrived_at?: string | null;
  in_progress_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  last_known_latitude?: number | null;
  last_known_longitude?: number | null;
  last_location_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadsideInterventionEntity {
  id: string;
  incident_id: string;
  assignment_id: string;
  provider_id: string;
  technician_id?: string | null;
  technician_name?: string | null;
  result: InterventionResult;
  summary_notes: string;
  labor_duration_minutes: number;
  final_drivability: DrivabilityState;
  odometer_reading_km?: number | null;
  tow_required: boolean | number;
  tow_destination?: string | null;
  related_issue_id?: string | null;
  related_component_id?: string | null;
  related_tyre_id?: string | null;
  fee_minor: number;
  currency: string;
  recorded_at: string;
  created_at: string;
}

export interface RoadsideInterventionActionEntity {
  id: string;
  intervention_id: string;
  action_type: InterventionActionType;
  description: string;
  part_name?: string | null;
  part_number?: string | null;
  quantity: number;
  cost_minor: number;
  created_at: string;
}

export interface RoadsideIncidentEvidenceEntity {
  id: string;
  incident_id: string;
  storage_object_id?: string | null;
  evidence_type: EvidenceType;
  caption?: string | null;
  file_url?: string | null;
  captured_by_role: string;
  uploaded_by_user_id: string;
  created_at: string;
}

export interface RoadsideIncidentActivityEntity {
  id: string;
  incident_id: string;
  activity_type: string;
  actor_id?: string | null;
  actor_type?: string | null;
  actor_name?: string | null;
  title: string;
  details?: string | null;
  created_at: string;
}

export interface RoadsideCancellationEntity {
  id: string;
  incident_id: string;
  cancelled_by_user_id: string;
  cancelled_by_role: string;
  reason: string;
  notes?: string | null;
  fee_incurred_minor: number;
  cancelled_at: string;
}

export interface RoadsideTowHandoffEntity {
  id: string;
  incident_id: string;
  intervention_id?: string | null;
  destination_type: TowDestinationType;
  destination_provider_id?: string | null;
  destination_name: string;
  destination_address?: string | null;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  special_instructions?: string | null;
  status: string;
  created_at: string;
}

export interface FullRoadsideIncidentAggregate {
  incident: RoadsideIncidentEntity;
  current_location: RoadsideLocationEntity | null;
  triage_record: (RoadsideTriageRecordEntity & { answers: RoadsideTriageAnswerEntity[] }) | null;
  active_request: RoadsideAssistanceRequestEntity | null;
  offers: RoadsideProviderOfferEntity[];
  active_assignment: (RoadsideAssignmentEntity & { provider_name?: string }) | null;
  intervention: (RoadsideInterventionEntity & { actions: RoadsideInterventionActionEntity[] }) | null;
  tow_handoff: RoadsideTowHandoffEntity | null;
  evidence: RoadsideIncidentEvidenceEntity[];
  activity_log: RoadsideIncidentActivityEntity[];
}
