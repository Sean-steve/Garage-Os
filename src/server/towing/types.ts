/**
 * Canonical Towing & Recovery Domain Architecture Types (GAR-015)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

export enum TowSourceType {
  ROADSIDE_INCIDENT = 'ROADSIDE_INCIDENT',
  ACCIDENT = 'ACCIDENT',
  OWNER_REQUEST = 'OWNER_REQUEST',
  GARAGE_REQUEST = 'GARAGE_REQUEST',
  FLEET_REQUEST = 'FLEET_REQUEST',
  INSURANCE_REQUEST = 'INSURANCE_REQUEST',
  PLATFORM_OPERATIONS = 'PLATFORM_OPERATIONS',
  OTHER = 'OTHER',
}

export enum TowRequestStatus {
  DRAFT = 'DRAFT',
  REQUESTED = 'REQUESTED',
  PENDING_DISPATCH = 'PENDING_DISPATCH',
  SEARCHING_PROVIDER = 'SEARCHING_PROVIDER',
  AWAITING_PROVIDER = 'AWAITING_PROVIDER',
  PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED',
  ASSIGNED = 'ASSIGNED',
  EN_ROUTE = 'EN_ROUTE',
  AT_PICKUP = 'AT_PICKUP',
  LOADING = 'LOADING',
  VEHICLE_LOADED = 'VEHICLE_LOADED',
  IN_TRANSIT = 'IN_TRANSIT',
  AT_DESTINATION = 'AT_DESTINATION',
  UNLOADING = 'UNLOADING',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  RECOVERY_FAILED = 'RECOVERY_FAILED',
}

export enum TowReason {
  BREAKDOWN = 'BREAKDOWN',
  MECHANICAL_BREAKDOWN = 'MECHANICAL_BREAKDOWN',
  FLAT_TYRE = 'FLAT_TYRE',
  DITCH_RECOVERY = 'DITCH_RECOVERY',
  ACCIDENT = 'ACCIDENT',
  ACCIDENT_DAMAGE = 'ACCIDENT_DAMAGE',
  NON_START = 'NON_START',
  OVERHEATING = 'OVERHEATING',
  TYRE_FAILURE = 'TYRE_FAILURE',
  MECHANICAL_FAILURE = 'MECHANICAL_FAILURE',
  ELECTRICAL_FAILURE = 'ELECTRICAL_FAILURE',
  RECOVERY_FROM_UNSAFE_POSITION = 'RECOVERY_FROM_UNSAFE_POSITION',
  TRANSPORT_TO_GARAGE = 'TRANSPORT_TO_GARAGE',
  VEHICLE_RELOCATION = 'VEHICLE_RELOCATION',
  OTHER = 'OTHER',
}

export enum RecoveryType {
  STANDARD_TOW = 'STANDARD_TOW',
  FLATBED_TRANSPORT = 'FLATBED_TRANSPORT',
  WHEEL_LIFT = 'WHEEL_LIFT',
  WINCH_OUT = 'WINCH_OUT',
  ACCIDENT_TOW = 'ACCIDENT_TOW',
  FULL_RECOVERY = 'FULL_RECOVERY',
  WINCH_RECOVERY = 'WINCH_RECOVERY',
  MOTORCYCLE_RECOVERY = 'MOTORCYCLE_RECOVERY',
  COMMERCIAL_VEHICLE_RECOVERY = 'COMMERCIAL_VEHICLE_RECOVERY',
  SPECIALIST_RECOVERY = 'SPECIALIST_RECOVERY',
}

export enum VehicleMobilityState {
  ROLLS_AND_STEERS = 'ROLLS_AND_STEERS',
  ROLLING = 'ROLLING',
  NON_ROLLING = 'NON_ROLLING',
  ROLLS_NOT_STEERS = 'ROLLS_NOT_STEERS',
  STEERS_NOT_ROLLS = 'STEERS_NOT_ROLLS',
  IMMOBILE = 'IMMOBILE',
  WHEELS_LOCKED = 'WHEELS_LOCKED',
  DAMAGED_SUSPENSION = 'DAMAGED_SUSPENSION',
  UNKNOWN = 'UNKNOWN',
}

export enum VehicleConditionState {
  NORMAL_BREAKDOWN = 'NORMAL_BREAKDOWN',
  OPERATIONAL_STEERING = 'OPERATIONAL_STEERING',
  COLLISION_DAMAGED = 'COLLISION_DAMAGED',
  ROLLOVER = 'ROLLOVER',
  OFF_ROAD = 'OFF_ROAD',
  STUCK = 'STUCK',
  FIRE_DAMAGED = 'FIRE_DAMAGED',
  FLOOD_DAMAGED = 'FLOOD_DAMAGED',
  UNKNOWN = 'UNKNOWN',
}

export enum TowDestinationType {
  GARAGE = 'GARAGE',
  BODY_SHOP = 'BODY_SHOP',
  OWNER_LOCATION = 'OWNER_LOCATION',
  OWNER_HOME = 'OWNER_HOME',
  TOW_YARD = 'TOW_YARD',
  DEALER = 'DEALER',
  INSURANCE_ASSESSMENT_CENTER = 'INSURANCE_ASSESSMENT_CENTER',
  OTHER = 'OTHER',
}

export enum RecoveryUnitType {
  FLATBED = 'FLATBED',
  WHEEL_LIFT = 'WHEEL_LIFT',
  HOOK_AND_CHAIN = 'HOOK_AND_CHAIN',
  INTEGRATED_TOW_TRUCK = 'INTEGRATED_TOW_TRUCK',
  HEAVY_RECOVERY = 'HEAVY_RECOVERY',
  MOTORCYCLE_TRAILER = 'MOTORCYCLE_TRAILER',
  SPECIALIST = 'SPECIALIST',
  OTHER = 'OTHER',
}

export enum RecoveryUnitStatus {
  AVAILABLE = 'AVAILABLE',
  EN_ROUTE = 'EN_ROUTE',
  BUSY = 'BUSY',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  MAINTENANCE = 'MAINTENANCE',
  OFFLINE = 'OFFLINE',
  SUSPENDED = 'SUSPENDED',
  UNKNOWN = 'UNKNOWN',
}

export enum EquipmentType {
  WINCH = 'WINCH',
  DOLLIES = 'DOLLIES',
  TOW_DOLLIES = 'TOW_DOLLIES',
  LOW_CLEARANCE_RAMPS = 'LOW_CLEARANCE_RAMPS',
  WHEEL_LIFT = 'WHEEL_LIFT',
  FLATBED = 'FLATBED',
  HYDRAULIC_TILT_TRAY = 'HYDRAULIC_TILT_TRAY',
  SOFT_STRAPS = 'SOFT_STRAPS',
  WHEEL_SKATES = 'WHEEL_SKATES',
  CRANE_BOOM = 'CRANE_BOOM',
  HEAVY_RIGGING = 'HEAVY_RIGGING',
  EXTENDED_CABLES = 'EXTENDED_CABLES',
  SNATCH_BLOCKS = 'SNATCH_BLOCKS',
  HEAVY_RECOVERY_BOOM = 'HEAVY_RECOVERY_BOOM',
  MOTORCYCLE_CRADLE = 'MOTORCYCLE_CRADLE',
  JUMP_START_EQUIPMENT = 'JUMP_START_EQUIPMENT',
  SAFETY_CONES = 'SAFETY_CONES',
  OTHER = 'OTHER',
}

export enum TowVehicleClass {
  PASSENGER = 'PASSENGER',
  PASSENGER_CAR = 'PASSENGER_CAR',
  SUV = 'SUV',
  SUV_CROSSOVER = 'SUV_CROSSOVER',
  PICKUP = 'PICKUP',
  VAN = 'VAN',
  MOTORCYCLE = 'MOTORCYCLE',
  LIGHT_COMMERCIAL = 'LIGHT_COMMERCIAL',
  HEAVY_COMMERCIAL = 'HEAVY_COMMERCIAL',
  HEAVY_TRUCK = 'HEAVY_TRUCK',
  BUS = 'BUS',
  UNKNOWN = 'UNKNOWN',
}

export enum TowCompatibilityStatus {
  CONFIRMED = 'CONFIRMED',
  LIKELY = 'LIKELY',
  UNKNOWN = 'UNKNOWN',
  INCOMPATIBLE = 'INCOMPATIBLE',
}

export enum TowOfferStatus {
  OFFERED = 'OFFERED',
  VIEWED = 'VIEWED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum TowAssignmentStatus {
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  EN_ROUTE_TO_PICKUP = 'EN_ROUTE_TO_PICKUP',
  ARRIVED_AT_PICKUP = 'ARRIVED_AT_PICKUP',
  LOADING = 'LOADING',
  VEHICLE_LOADED = 'VEHICLE_LOADED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_AT_DESTINATION = 'ARRIVED_AT_DESTINATION',
  UNLOADING = 'UNLOADING',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  LOADING_FAILED = 'LOADING_FAILED',
}

export enum TowPickupEvidenceType {
  FRONT = 'FRONT',
  PHOTO_FRONT = 'PHOTO_FRONT',
  REAR = 'REAR',
  LEFT_SIDE = 'LEFT_SIDE',
  RIGHT_SIDE = 'RIGHT_SIDE',
  DAMAGE_DETAIL = 'DAMAGE_DETAIL',
  WHEEL_SUSPENSION = 'WHEEL_SUSPENSION',
  LOADED_ON_BED = 'LOADED_ON_BED',
  OTHER = 'OTHER',
}

export enum TowCustodyEventType {
  VEHICLE_RECEIVED_FOR_TOW = 'VEHICLE_RECEIVED_FOR_TOW',
  VEHICLE_LOADED = 'VEHICLE_LOADED',
  VEHICLE_DEPARTED_PICKUP = 'VEHICLE_DEPARTED_PICKUP',
  VEHICLE_ARRIVED_DESTINATION = 'VEHICLE_ARRIVED_DESTINATION',
  VEHICLE_UNLOADED = 'VEHICLE_UNLOADED',
  VEHICLE_HANDOVER_CONFIRMED = 'VEHICLE_HANDOVER_CONFIRMED',
}

export enum TowPartyType {
  OWNER = 'OWNER',
  AUTHORIZED_CUSTODIAN = 'AUTHORIZED_CUSTODIAN',
  TOW_PROVIDER = 'TOW_PROVIDER',
  GARAGE_STAFF = 'GARAGE_STAFF',
  DESTINATION_PROVIDER = 'DESTINATION_PROVIDER',
  TOW_YARD = 'TOW_YARD',
  OTHER = 'OTHER',
}

export enum TowDeliveryRecipientType {
  OWNER = 'OWNER',
  AUTHORIZED_USER = 'AUTHORIZED_USER',
  GARAGE_STAFF = 'GARAGE_STAFF',
  BODY_SHOP = 'BODY_SHOP',
  TOW_YARD_STAFF = 'TOW_YARD_STAFF',
  FLEET_OPERATOR = 'FLEET_OPERATOR',
  OTHER_AUTHORIZED_RECIPIENT = 'OTHER_AUTHORIZED_RECIPIENT',
}

export enum TowDeliveryAcknowledgementMethod {
  DIGITAL_SIGNATURE = 'DIGITAL_SIGNATURE',
  PHOTO_CONFIRMATION = 'PHOTO_CONFIRMATION',
  VERBAL_CODE = 'VERBAL_CODE',
  STAFF_BADGE = 'STAFF_BADGE',
  PIN = 'PIN',
  PHYSICAL_SIGNATURE = 'PHYSICAL_SIGNATURE',
}

export enum TowDeliveryEvidenceType {
  DESTINATION_EXTERIOR = 'DESTINATION_EXTERIOR',
  UNLOADED_VEHICLE = 'UNLOADED_VEHICLE',
  SIGNED_NOTE = 'SIGNED_NOTE',
  KEYS_HANDOVER = 'KEYS_HANDOVER',
  OTHER = 'OTHER',
}

export enum TowFailureType {
  VEHICLE_TOO_HEAVY = 'VEHICLE_TOO_HEAVY',
  ACCESS_RESTRICTED = 'ACCESS_RESTRICTED',
  EQUIPMENT_INSUFFICIENT = 'EQUIPMENT_INSUFFICIENT',
  VEHICLE_CONDITION_UNSAFE = 'VEHICLE_CONDITION_UNSAFE',
  LOCATION_UNSAFE = 'LOCATION_UNSAFE',
  CUSTOMER_CANCELLED = 'CUSTOMER_CANCELLED',
  UNIT_BREAKDOWN = 'UNIT_BREAKDOWN',
  OPERATOR_UNAVAILABLE = 'OPERATOR_UNAVAILABLE',
  SAFETY_ABORT = 'SAFETY_ABORT',
  PHYSICAL_OBSTRUCTION_BLOCKED = 'PHYSICAL_OBSTRUCTION_BLOCKED',
  OTHER = 'OTHER',
}

// ---------------------------------------------------------------------------
// Entity Interfaces
// ---------------------------------------------------------------------------

export interface TowCapabilityProfileEntity {
  id: string;
  name: string;
  supported_classes_json: string; // string[]
  supported_mobility_states_json: string; // string[]
  supported_recovery_types_json: string; // string[]
  required_equipment_json?: string | null; // string[]
  max_weight_kg?: number | null;
  created_at: string;
}

export interface RecoveryUnitEntity {
  id: string;
  provider_id: string;
  unit_type: RecoveryUnitType;
  registration_identifier: string;
  fleet_identifier?: string | null;
  status: RecoveryUnitStatus;
  max_vehicle_weight_kg?: number | null;
  max_vehicle_length_mm?: number | null;
  max_vehicle_width_mm?: number | null;
  equipment_profile_id?: string | null;
  base_location_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecoveryUnitEquipmentEntity {
  id: string;
  recovery_unit_id: string;
  equipment_type: EquipmentType;
  rating_capacity_kg?: number | null;
  is_operational: number | boolean;
  created_at: string;
}

export interface RecoveryUnitVehicleClassSupportEntity {
  id: string;
  recovery_unit_id: string;
  vehicle_class: TowVehicleClass;
}

export interface TowRequestEntity {
  id: string;
  request_number: string;
  sequence_number?: string;
  vehicle_id: string;
  requesting_user_id: string;
  organization_id?: string | null;
  source_type: TowSourceType;
  source_reference_id?: string | null;
  created_from_roadside_incident_id?: string | null;
  status: TowRequestStatus;
  tow_reason: TowReason;
  recovery_type: RecoveryType;
  vehicle_mobility_state: VehicleMobilityState;
  vehicle_condition_state: VehicleConditionState;
  required_capability_profile_id?: string | null;
  preferred_provider_id?: string | null;
  assigned_provider_id?: string | null;
  active_assignment_id?: string | null;
  related_issue_id?: string | null;
  special_instructions?: string | null;
  requested_at: string;
  assigned_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TowPickupLocationEntity {
  id: string;
  tow_request_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  address_summary: string;
  road_name?: string | null;
  landmark?: string | null;
  access_notes?: string | null;
  access_instructions?: string | null;
  source_type: string;
  captured_at: string;
  created_at: string;
}

export interface TowDestinationEntity {
  id: string;
  tow_request_id: string;
  destination_type: TowDestinationType;
  provider_id?: string | null;
  branch_id?: string | null;
  location_reference_id?: string | null;
  address_summary: string;
  latitude?: number | null;
  longitude?: number | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  instructions?: string | null;
  revision_number?: number;
  created_at: string;
  updated_at: string;
}

export interface TowDestinationRevisionEntity {
  id: string;
  tow_request_id: string;
  previous_destination_id: string;
  new_destination_id: string;
  changed_by_user_id: string;
  changed_by_role: string;
  reason: string;
  prior_address_summary?: string | null;
  change_reason?: string | null;
  created_at: string;
}

export interface TowProviderOfferEntity {
  id: string;
  tow_request_id: string;
  provider_id: string;
  recovery_unit_id?: string | null;
  status: TowOfferStatus;
  offered_at: string;
  expires_at: string;
  distance_km?: number | null;
  compatibility_status: TowCompatibilityStatus;
  estimated_price_minor?: number | null;
  currency: string;
  responded_at?: string | null;
  decline_reason?: string | null;
  created_at: string;
}

export interface TowAssignmentEntity {
  id: string;
  tow_request_id: string;
  provider_id: string;
  recovery_unit_id: string;
  operator_staff_id?: string | null;
  operator_name?: string | null;
  operator_phone?: string | null;
  status: TowAssignmentStatus;
  assigned_at: string;
  accepted_at: string;
  en_route_at?: string | null;
  arrived_pickup_at?: string | null;
  loading_started_at?: string | null;
  loaded_at?: string | null;
  transit_started_at?: string | null;
  arrived_destination_at?: string | null;
  unloading_started_at?: string | null;
  unloaded_at?: string | null;
  delivery_confirmed_at?: string | null;
  completed_at?: string | null;
  waiting_started_at?: string | null;
  waiting_ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TowPickupInspectionEntity {
  id: string;
  tow_assignment_id: string;
  performed_at: string;
  performed_by_user_id: string;
  vehicle_condition_summary: string;
  visible_damage_json?: string | null; // string[] or Record
  mobility_state_confirmed: VehicleMobilityState;
  odometer_reading_km?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface TowPickupEvidenceEntity {
  id: string;
  inspection_id: string;
  storage_object_id?: string | null;
  evidence_type: TowPickupEvidenceType | string;
  file_url: string;
  caption?: string | null;
  created_at: string;
}

export interface TowCustodyEventEntity {
  id: string;
  tow_assignment_id: string;
  event_type: TowCustodyEventType;
  from_party_type: TowPartyType;
  from_party_id?: string | null;
  from_party_name?: string | null;
  to_party_type: TowPartyType;
  to_party_id?: string | null;
  to_party_name?: string | null;
  occurred_at: string;
  location_summary?: string | null;
  evidence_reference_ids_json?: string | null;
  acknowledgement_status: string;
  notes?: string | null;
  created_at: string;
}

export interface TowDeliveryConfirmationEntity {
  id: string;
  tow_assignment_id: string;
  delivered_at: string;
  recipient_type: TowDeliveryRecipientType;
  recipient_id?: string | null;
  recipient_name: string;
  recipient_signature_reference?: string | null;
  destination_provider_id?: string | null;
  destination_branch_id?: string | null;
  condition_summary: string;
  acknowledgement_method: TowDeliveryAcknowledgementMethod;
  service_case_handoff_id?: string | null;
  created_at: string;
}

export interface TowDeliveryEvidenceEntity {
  id: string;
  delivery_confirmation_id: string;
  storage_object_id?: string | null;
  evidence_type: TowDeliveryEvidenceType;
  file_url: string;
  caption?: string | null;
  created_at: string;
}

export interface TowCancellationEntity {
  id: string;
  tow_request_id: string;
  cancelled_by_user_id: string;
  cancelled_by_role: string;
  reason: string;
  assignment_state_at_cancellation?: string | null;
  callout_fee_incurred_minor: number;
  currency: string;
  notes?: string | null;
  cancelled_at: string;
}

export interface TowAssignmentFailureEntity {
  id: string;
  assignment_id: string;
  failure_type: TowFailureType;
  description: string;
  occurred_at: string;
  reported_by_user_id: string;
  recoverable: number | boolean;
  created_at: string;
}

export interface TowActivityEntity {
  id: string;
  tow_request_id: string;
  tow_assignment_id?: string | null;
  activity_type: string;
  actor_id?: string | null;
  actor_type?: string | null;
  actor_name?: string | null;
  title: string;
  details?: string | null;
  created_at: string;
}

export interface FullTowAggregate {
  request: TowRequestEntity;
  pickup_location: TowPickupLocationEntity | null;
  destination: TowDestinationEntity | null;
  destination_revisions: TowDestinationRevisionEntity[];
  active_assignment: (TowAssignmentEntity & {
    recovery_unit?: RecoveryUnitEntity;
    provider_name?: string;
  }) | null;
  assignment?: (TowAssignmentEntity & {
    recovery_unit?: RecoveryUnitEntity;
    provider_name?: string;
  }) | null;
  offers: (TowProviderOfferEntity & { provider_name?: string })[];
  pickup_inspection: (TowPickupInspectionEntity & { evidence: TowPickupEvidenceEntity[] }) | null;
  custody_events: TowCustodyEventEntity[];
  delivery_confirmation: (TowDeliveryConfirmationEntity & { evidence: TowDeliveryEvidenceEntity[] }) | null;
  cancellations: TowCancellationEntity[];
  assignment_failures: TowAssignmentFailureEntity[];
  activity_log: TowActivityEntity[];
}

export interface VehicleCompatibilityEvaluation {
  status: TowCompatibilityStatus;
  compatible: boolean;
  reasons: string[];
  recommended_recovery_type?: RecoveryType;
  unit_id?: string;
  unit_type?: RecoveryUnitType;
}
