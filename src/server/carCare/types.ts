export type CarCareContentKind = 'WARNING_LIGHT' | 'SYMPTOM' | 'CARE_GUIDE' | 'LONG_TRIP' | 'SAFETY';
export type CarCareRiskLevel = 'INFO' | 'CAUTION' | 'URGENT';
export type CareMissionType = 'WEEKLY_CHECK' | 'PRE_TRIP' | 'LONG_TRIP' | 'SEASONAL';
export type CareMissionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type CareMissionItemStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'CONCERN_REPORTED'
  | 'SKIPPED'
  | 'PROFESSIONAL_HELP_REQUIRED';

export interface CarCareArticle {
  id: string;
  slug: string;
  content_kind: CarCareContentKind;
  category: string;
  title: string;
  summary: string;
  explanation: string;
  owner_actions: string[];
  seek_help_when: string[];
  risk_level: CarCareRiskLevel;
  professional_inspection_required: boolean;
  roadside_recommended: boolean;
  booking_recommended: boolean;
  source_label: string;
  content_version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  created_at: string;
  updated_at: string;
}

export interface CareMissionTemplate {
  id: string;
  code: string;
  mission_type: CareMissionType;
  title: string;
  description: string;
  disclaimer: string;
  status: 'ACTIVE' | 'RETIRED';
  created_at: string;
  updated_at: string;
}

export interface CareMissionItem {
  id: string;
  template_id: string;
  display_order: number;
  title: string;
  instructions: string;
  check_level: 'OWNER_SAFE_CHECK' | 'PROFESSIONAL_INSPECTION_ONLY';
  safety_level: 'NORMAL' | 'CAUTION' | 'SAFETY_CRITICAL';
  concern_action: 'OPEN_ISSUE' | 'OPEN_MAINTENANCE' | 'OPEN_ROADSIDE' | 'OPEN_BOOKINGS' | 'OPEN_PROVIDERS' | 'NONE';
  article_slug: string | null;
  created_at: string;
}

export interface VehicleCareMission {
  id: string;
  user_id: string;
  vehicle_id: string;
  template_id: string;
  status: CareMissionStatus;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareMissionItemProgress {
  id: string;
  mission_id: string;
  item_id: string;
  status: CareMissionItemStatus;
  note: string | null;
  updated_by: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrichedVehicleCareMission {
  mission: VehicleCareMission;
  template: CareMissionTemplate;
  items: Array<{
    item: CareMissionItem;
    progress: CareMissionItemProgress;
  }>;
  progress: {
    total: number;
    resolved: number;
    pending: number;
    percent: number;
    professional_help_required: number;
    concerns_reported: number;
  };
  completion_statement: string;
}

export interface CareGuidanceAction {
  label: string;
  target_tab: 'maintenance' | 'issues' | 'roadside' | 'bookings' | 'providers' | 'care';
  target_id?: string;
  article_slug?: string;
}

export interface CareGuidanceCard {
  id: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  title: string;
  explanation: string;
  source_type: 'MAINTENANCE_STATE' | 'VEHICLE_ISSUE' | 'CARE_BASELINE';
  source_reference_id?: string;
  is_diagnosis: false;
  actions: CareGuidanceAction[];
}

export interface CarCareDashboard {
  vehicle_id: string;
  generated_at: string;
  maintenance: {
    overall_status: string;
    overdue_count: number;
    due_count: number;
    approaching_count: number;
    next_due_item: unknown;
  };
  active_issue_count: number;
  persistent_issue_count: number;
  guidance: CareGuidanceCard[];
  recommended_missions: CareMissionTemplate[];
  active_missions: EnrichedVehicleCareMission[];
  safety_statement: string;
}


export type CareUsagePattern =
  | 'UNKNOWN'
  | 'OCCASIONAL'
  | 'DAILY_COMMUTE'
  | 'MIXED'
  | 'LONG_DISTANCE'
  | 'LIGHT_COMMERCIAL';

export type AnnualDistanceBand =
  | 'UNKNOWN'
  | 'UNDER_5000_KM'
  | 'KM_5000_10000'
  | 'KM_10000_20000'
  | 'KM_20000_30000'
  | 'OVER_30000_KM';

export type CareRoadExposure =
  | 'UNKNOWN'
  | 'PAVED_MOSTLY'
  | 'MIXED'
  | 'ROUGH_ROADS_FREQUENT';

export type CareParkingContext =
  | 'UNKNOWN'
  | 'GARAGED'
  | 'COVERED_OUTDOOR'
  | 'OUTDOOR_EXPOSED'
  | 'MIXED';

export type CareClimateExposure =
  | 'DUSTY'
  | 'HOT'
  | 'HUMID'
  | 'HEAVY_RAIN'
  | 'COASTAL_SALT'
  | 'COLD'
  | 'NONE_REPORTED';

export type CareFrequency = 'UNKNOWN' | 'RARE' | 'OCCASIONAL' | 'MONTHLY' | 'FREQUENT';
export type HeavyLoadFrequency = 'UNKNOWN' | 'NEVER' | 'OCCASIONAL' | 'FREQUENT';

export interface VehicleCareProfile {
  id: string;
  user_id: string;
  vehicle_id: string;
  usage_pattern: CareUsagePattern;
  annual_distance_band: AnnualDistanceBand;
  road_exposure: CareRoadExposure;
  parking_context: CareParkingContext;
  climate_exposures: CareClimateExposure[];
  long_trip_frequency: CareFrequency;
  heavy_load_frequency: HeavyLoadFrequency;
  profile_version: number;
  source_type: 'OWNER_CONFIGURED';
  created_at: string;
  updated_at: string;
}

export interface UpdateVehicleCareProfileInput {
  usage_pattern?: CareUsagePattern;
  annual_distance_band?: AnnualDistanceBand;
  road_exposure?: CareRoadExposure;
  parking_context?: CareParkingContext;
  climate_exposures?: CareClimateExposure[];
  long_trip_frequency?: CareFrequency;
  heavy_load_frequency?: HeavyLoadFrequency;
}

export interface PersonalizedCareEvidence {
  source_type:
    | 'VEHICLE_SPEC'
    | 'ODOMETER'
    | 'OWNER_PROFILE'
    | 'MAINTENANCE_STATE'
    | 'VEHICLE_ISSUE'
    | 'TYRE_INSPECTION'
    | 'FUEL_EFFICIENCY';
  label: string;
  value: string | number | boolean | null;
  source_reference_id?: string;
}

export interface PersonalizedCareRecommendation {
  id: string;
  rule_id: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  title: string;
  explanation: string;
  evidence: PersonalizedCareEvidence[];
  actions: CareGuidanceAction[];
  is_diagnosis: false;
  changes_maintenance_schedule: false;
  rule_version: string;
}

export interface PersonalizedCarePlan {
  vehicle_id: string;
  generated_at: string;
  rule_version: string;
  profile: VehicleCareProfile | null;
  profile_completeness: 'NOT_CONFIGURED' | 'PARTIAL' | 'CONFIGURED';
  recommendations: PersonalizedCareRecommendation[];
  recommended_mission_codes: string[];
  data_quality_notes: string[];
  safety_statement: string;
  location_inference_used: false;
  ai_inference_used: false;
}

export interface CarCarePersonalizationEvaluation {
  id: string;
  user_id: string;
  vehicle_id: string;
  profile_id: string | null;
  rule_version: string;
  input_fingerprint: string;
  recommendation_count: number;
  recommendations: PersonalizedCareRecommendation[];
  evidence_summary: Record<string, unknown>;
  generated_at: string;
  created_at: string;
}
