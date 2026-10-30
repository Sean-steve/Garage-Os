/**
 * Garage OS — Sprint 14: Real-Time Dispatch, Location & Provider Matching Architecture
 * Canonical Type Definitions (GAR-016)
 */

export enum DispatchDomain {
  ROADSIDE = 'ROADSIDE',
  TOWING = 'TOWING',
  MOBILE_SERVICE = 'MOBILE_SERVICE',
  SOS_SUPPORT = 'SOS_SUPPORT',
  ACCIDENT_RECOVERY = 'ACCIDENT_RECOVERY',
}

export enum DispatchPriority {
  NORMAL = 'NORMAL',
  PRIORITY = 'PRIORITY',
  SAFETY_CRITICAL = 'SAFETY_CRITICAL',
}

export enum DispatchRequestStatus {
  CREATED = 'CREATED',
  CANDIDATES_DISCOVERED = 'CANDIDATES_DISCOVERED',
  OFFERING = 'OFFERING',
  AWAITING_ACCEPTANCE = 'AWAITING_ACCEPTANCE',
  ASSIGNED = 'ASSIGNED',
  EXHAUSTED = 'EXHAUSTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

export enum DispatchStrategy {
  SEQUENTIAL = 'SEQUENTIAL',
  BATCH = 'BATCH',
  MANUAL = 'MANUAL',
  ETA_OPTIMIZED = 'ETA_OPTIMIZED',
}

export enum DispatchAttemptStatus {
  STARTED = 'STARTED',
  OFFERS_SENT = 'OFFERS_SENT',
  ACCEPTED = 'ACCEPTED',
  TIMED_OUT = 'TIMED_OUT',
  EXHAUSTED = 'EXHAUSTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum ResponderType {
  PROVIDER = 'PROVIDER',
  PROVIDER_STAFF = 'PROVIDER_STAFF',
  MOBILE_UNIT = 'MOBILE_UNIT',
  RECOVERY_UNIT = 'RECOVERY_UNIT',
}

export enum ResponderAvailabilityStatus {
  OFFLINE = 'OFFLINE',
  AVAILABLE = 'AVAILABLE',
  AVAILABLE_LIMITED = 'AVAILABLE_LIMITED',
  BUSY = 'BUSY',
  ON_JOB = 'ON_JOB',
  PAUSED = 'PAUSED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  UNKNOWN = 'UNKNOWN',
}

export enum HeartbeatFreshness {
  FRESH = 'FRESH',         // 0 - 60 seconds
  DEGRADED = 'DEGRADED',   // 61 - 180 seconds
  STALE = 'STALE',         // > 180 seconds
}

export enum LocationSourceType {
  DEVICE_GPS = 'DEVICE_GPS',
  NETWORK = 'NETWORK',
  MANUAL = 'MANUAL',
  VEHICLE_TRACKER = 'VEHICLE_TRACKER',
  PROVIDER_APP = 'PROVIDER_APP',
  EXTERNAL_TELEMATICS = 'EXTERNAL_TELEMATICS',
}

export enum LocationFreshness {
  FRESH = 'FRESH',       // 0 - 120 seconds
  AGING = 'AGING',       // 121 - 300 seconds
  STALE = 'STALE',       // > 300 seconds
  UNKNOWN = 'UNKNOWN',
}

export enum LocationQuality {
  GOOD = 'GOOD',         // accuracy <= 25m
  DEGRADED = 'DEGRADED', // accuracy 26m - 100m
  POOR = 'POOR',         // accuracy > 100m
  UNUSABLE = 'UNUSABLE', // out-of-order, impossible jump, or invalid coordinates
}

export enum MovementState {
  STATIONARY = 'STATIONARY',
  MOVING = 'MOVING',
  UNKNOWN = 'UNKNOWN',
}

export enum DistanceType {
  GEODESIC_DISTANCE = 'GEODESIC_DISTANCE',
  ROAD_DISTANCE = 'ROAD_DISTANCE',
}

export enum EtaSource {
  LIVE_ROUTING = 'LIVE_ROUTING',
  STATIC_ROUTING = 'STATIC_ROUTING',
  SYSTEM_ESTIMATE = 'SYSTEM_ESTIMATE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum ExclusionReason {
  PROVIDER_INACTIVE = 'PROVIDER_INACTIVE',
  CAPABILITY_MISMATCH = 'CAPABILITY_MISMATCH',
  OUTSIDE_SERVICE_AREA = 'OUTSIDE_SERVICE_AREA',
  UNIT_INCOMPATIBLE = 'UNIT_INCOMPATIBLE',
  RESPONDER_OFFLINE = 'RESPONDER_OFFLINE',
  LOCATION_STALE = 'LOCATION_STALE',
  ALREADY_ASSIGNED = 'ALREADY_ASSIGNED',
  CAPACITY_FULL = 'CAPACITY_FULL',
  OUT_OF_RANGE = 'OUT_OF_RANGE',
  UNKNOWN_LOCATION = 'UNKNOWN_LOCATION',
}

export enum TrackingAccessStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

// Canonical Entities
export interface DispatchRequestEntity {
  id: string;
  dispatch_domain: DispatchDomain;
  source_reference_type: string;
  source_reference_id: string;
  required_capability: string;
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address?: string | null;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  destination_address?: string | null;
  vehicle_id?: string | null;
  priority: DispatchPriority;
  status: DispatchRequestStatus;
  strategy: DispatchStrategy;
  strategy_version: string;
  current_attempt_number: number;
  active_attempt_id?: string | null;
  assigned_provider_id?: string | null;
  assigned_responder_type?: ResponderType | null;
  assigned_responder_id?: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface DispatchAttemptEntity {
  id: string;
  dispatch_request_id: string;
  attempt_number: number;
  strategy: DispatchStrategy;
  search_radius_km: number;
  candidate_ids_json: string;
  status: DispatchAttemptStatus;
  failure_reason?: string | null;
  started_at: string;
  expires_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface DispatchCandidateEntity {
  id: string;
  dispatch_request_id: string;
  dispatch_attempt_id: string;
  provider_id: string;
  responder_type: ResponderType;
  responder_reference_id: string;
  eligibility_status: 'ELIGIBLE' | 'EXCLUDED';
  distance_meters?: number | null;
  distance_type?: DistanceType | null;
  eta_seconds?: number | null;
  eta_source?: EtaSource | null;
  location_freshness?: LocationFreshness | null;
  availability_state?: ResponderAvailabilityStatus | null;
  capability_score: number;
  distance_score: number;
  eta_score: number;
  workload_score: number;
  overall_score: number;
  rank?: number | null;
  exclusion_reason?: ExclusionReason | null;
  strategy_version: string;
  created_at: string;
}

export interface ResponderPresenceEntity {
  id: string;
  provider_id: string;
  responder_type: ResponderType;
  responder_reference_id: string;
  status: ResponderAvailabilityStatus;
  last_heartbeat_at: string;
  available_since?: string | null;
  current_job_reference?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResponderCurrentLocationEntity {
  responder_reference_id: string;
  responder_type: ResponderType;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  heading_degrees?: number | null;
  speed_meters_per_second?: number | null;
  captured_at: string;
  received_at: string;
  freshness_state: LocationFreshness;
  quality: LocationQuality;
  movement_state: MovementState;
  source_type: LocationSourceType;
  updated_at: string;
}

export interface ResponderLocationObservationEntity {
  id: string;
  responder_type: ResponderType;
  responder_reference_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  heading_degrees?: number | null;
  speed_meters_per_second?: number | null;
  captured_at: string;
  received_at: string;
  source_type: LocationSourceType;
  is_outlier: number; // 0 or 1
  outlier_reason?: string | null;
  created_at: string;
}

export interface DispatchRouteEstimateEntity {
  id: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  distance_meters: number;
  distance_type: DistanceType;
  duration_seconds?: number | null;
  provider_name: string;
  expires_at: string;
  created_at: string;
}

export interface DispatchEtaEstimateEntity {
  id: string;
  dispatch_request_id: string;
  responder_reference_id: string;
  estimated_arrival_at?: string | null;
  duration_seconds?: number | null;
  source: EtaSource;
  calculated_at: string;
  route_distance_meters?: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  traffic_included: number;
  expires_at: string;
  created_at: string;
}

export interface DispatchTrackingProjectionEntity {
  id: string;
  dispatch_request_id: string;
  assignment_id: string;
  assignment_domain: string;
  assignment_status: string;
  customer_user_id?: string | null;
  responder_display_name: string;
  responder_unit_summary?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  location_freshness: LocationFreshness;
  location_captured_at?: string | null;
  eta_arrival_at?: string | null;
  eta_duration_seconds?: number | null;
  eta_source?: string | null;
  eta_calculated_at?: string | null;
  eta_freshness: LocationFreshness;
  tracking_access_status: TrackingAccessStatus;
  is_tracking_active: number;
  stale_warning?: string | null;
  last_updated_at: string;
}

export interface DispatchManualOverrideEntity {
  id: string;
  dispatch_request_id: string;
  actor_id: string;
  actor_role: string;
  provider_id: string;
  responder_reference_id: string;
  reason: string;
  override_flags_json?: string | null;
  eligibility_snapshot_json?: string | null;
  created_at: string;
}

export interface CustomerTrackingViewDto {
  requestId: string;
  assignmentId: string;
  domain: string;
  status: string;
  responderDisplayName: string;
  responderUnitSummary?: string | null;
  latitude: number | null;
  longitude: number | null;
  locationFreshness: LocationFreshness;
  etaArrivalIso?: string | null;
  etaDurationMinutes?: number | null;
  etaSource?: string | null;
  staleWarning?: string | null;
  isTrackingActive: boolean;
  lastUpdatedAt: string;
}

export interface DispatchReconciliationRecordEntity {
  id: string;
  dispatch_request_id: string;
  issue_type: string;
  description: string;
  resolved: number;
  resolution_details?: string | null;
  detected_at: string;
  resolved_at?: string | null;
}

// Domain Adapter Interface
export interface DispatchDomainAdapter {
  domain: DispatchDomain;
  loadSourceRequest(sourceId: string): Promise<{
    id: string;
    pickupLatitude: number;
    pickupLongitude: number;
    destinationLatitude?: number | null;
    destinationLongitude?: number | null;
    vehicleId?: string | null;
    requiredCapability: string;
    priority?: DispatchPriority;
    requestingUserId: string;
    status: string;
  }>;
  createOffer(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    candidate: DispatchCandidateEntity;
    attemptId: string;
    etaMinutes?: number;
    distanceKm?: number;
  }): Promise<{ offerId: string }>;
  commitAssignment(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    offerId: string;
    candidate: DispatchCandidateEntity;
    actor: { id: string; role: string; name?: string };
  }): Promise<{ assignmentId: string; status: string }>;
  cancelOffers(sourceRequestId: string): Promise<void>;
  reassign(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    previousAssignmentId: string;
    reason: string;
    actor: { id: string; role: string; name?: string };
  }): Promise<void>;
}
