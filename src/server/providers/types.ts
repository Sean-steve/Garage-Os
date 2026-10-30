/**
 * Canonical Service Provider Domain Architecture Types (GAR-011)
 *
 * Implements:
 * - Provider organization linkage & multi-tenant isolation
 * - Provider classification & lifecycle state machine
 * - Multi-branch & workshop location models with coordinates
 * - Canonical service taxonomy & delivery mode matrix
 * - Operating hours, weekly schedules, & holiday exceptions
 * - Mobile mechanic & towing service radius/areas
 * - Staff profiles, professional roles & technician certifications
 * - Verification case workflow & trust tiers
 * - Search projection contracts & query parameters
 */

export enum ProviderType {
  INDEPENDENT_GARAGE = 'INDEPENDENT_GARAGE',
  FRANCHISE_DEALERSHIP = 'FRANCHISE_DEALERSHIP',
  SPECIALIST_WORKSHOP = 'SPECIALIST_WORKSHOP',
  MOBILE_MECHANIC = 'MOBILE_MECHANIC',
  TYRE_SHOP = 'TYRE_SHOP',
  AUTO_BODY_COLLISION = 'AUTO_BODY_COLLISION',
  AUTO_ELECTRICAL_ELECTRONICS = 'AUTO_ELECTRICAL_ELECTRONICS',
  AIR_CONDITIONING_SPECIALIST = 'AIR_CONDITIONING_SPECIALIST',
  TRANSMISSION_SPECIALIST = 'TRANSMISSION_SPECIALIST',
  TOWING_RECOVERY = 'TOWING_RECOVERY',
  DETAILING_VALETING = 'DETAILING_VALETING',
  GLASS_WINDSCREEN = 'GLASS_WINDSCREEN',
  INSPECTION_TESTING_CENTER = 'INSPECTION_TESTING_CENTER',
  OTHER = 'OTHER',
}

export enum ProviderStatus {
  ONBOARDING = 'ONBOARDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  TEMPORARILY_CLOSED = 'TEMPORARILY_CLOSED',
  SUSPENDED = 'SUSPENDED',
}

export enum ProviderVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ProviderLocationType {
  WORKSHOP = 'WORKSHOP',
  BRANCH = 'BRANCH',
  OFFICE = 'OFFICE',
  YARD = 'YARD',
  MOBILE_BASE = 'MOBILE_BASE',
  TOW_YARD = 'TOW_YARD',
  SERVICE_POINT = 'SERVICE_POINT',
  OTHER = 'OTHER',
}

export enum ServiceDeliveryMode {
  WORKSHOP = 'WORKSHOP',
  MOBILE = 'MOBILE',
  ROADSIDE = 'ROADSIDE',
  PICKUP_AND_RETURN = 'PICKUP_AND_RETURN',
  TOW_IN = 'TOW_IN',
  REMOTE_GUIDANCE = 'REMOTE_GUIDANCE',
}

export { ServiceDeliveryMode as DeliveryMode };

export enum ServicePricingType {
  FREE_ESTIMATE = 'FREE_ESTIMATE',
  FIXED_STARTING_PRICE = 'FIXED_STARTING_PRICE',
  CALL_FOR_PRICE = 'CALL_FOR_PRICE',
  DIAGNOSTIC_FEE = 'DIAGNOSTIC_FEE',
  HOURLY_RATE = 'HOURLY_RATE',
  CALL_OUT_FEE = 'CALL_OUT_FEE',
}

export enum VehicleSupportLevel {
  SPECIALIST = 'SPECIALIST',
  SUPPORTED = 'SUPPORTED',
  LIMITED = 'LIMITED',
}

export enum VehicleClass {
  PASSENGER = 'PASSENGER',
  SUV = 'SUV',
  PICKUP = 'PICKUP',
  VAN = 'VAN',
  COMMERCIAL = 'COMMERCIAL',
  EV = 'EV',
  HYBRID = 'HYBRID',
  MOTORCYCLE = 'MOTORCYCLE',
}

export enum StaffProfessionalRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  SERVICE_ADVISOR = 'SERVICE_ADVISOR',
  MECHANIC = 'MECHANIC',
  TECHNICIAN = 'TECHNICIAN',
  DISPATCHER = 'DISPATCHER',
  PARTS_MANAGER = 'PARTS_MANAGER',
  RECEPTION = 'RECEPTION',
  TOW_OPERATOR = 'TOW_OPERATOR',
  DETAILER = 'DETAILER',
  OTHER = 'OTHER',
}

export enum StaffStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum VerificationType {
  BUSINESS_REGISTRATION = 'BUSINESS_REGISTRATION',
  OPERATING_LICENSE = 'OPERATING_LICENSE',
  PHYSICAL_INSPECTION = 'PHYSICAL_INSPECTION',
  INSURANCE_POLICY = 'INSURANCE_POLICY',
  TAX_PIN_COMPLIANCE = 'TAX_PIN_COMPLIANCE',
  TOWING_PERMIT = 'TOWING_PERMIT',
  PROPRIETOR_IDENTITY = 'PROPRIETOR_IDENTITY',
}

export enum VerificationCaseStatus {
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ServiceAreaType {
  RADIUS = 'RADIUS',
  POLYGON = 'POLYGON',
  REGION = 'REGION',
}

export enum OperatingState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  UNKNOWN = 'UNKNOWN',
}

// -------------------------------------------------------------------------
// Core Entity Interfaces
// -------------------------------------------------------------------------

export interface ServiceProviderEntity {
  id: string;
  organization_id: string;
  name: string;
  legal_business_name?: string | null;
  provider_type: ProviderType;
  status: ProviderStatus;
  verification_status: ProviderVerificationStatus;
  primary_location_id?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  description?: string | null;
  service_radius_km?: number | null;
  accepts_bookings: boolean;
  accepts_mobile_jobs: boolean;
  accepts_roadside_jobs: boolean;
  accepts_towing_jobs: boolean;
  currency: string;
  callout_fee?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderLocationEntity {
  id: string;
  provider_id: string;
  name: string;
  location_type: ProviderLocationType;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  county_state: string;
  country: string;
  postal_code?: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  geocoding_source: string;
  verification_status: ProviderVerificationStatus;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderBranchEntity {
  id: string;
  provider_id: string;
  location_id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'TEMPORARILY_CLOSED';
  manager_membership_id?: string | null;
  phone?: string | null;
  email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceCategoryEntity {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderServiceCapabilityEntity {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  service_category_id: string;
  service_code: string;
  service_name: string;
  description?: string | null;
  delivery_mode: ServiceDeliveryMode;
  pricing_type: ServicePricingType;
  indicative_price?: number | null;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  booking_enabled: boolean;
  roadside_eligible: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderVehicleMakeSupportEntity {
  id: string;
  provider_id: string;
  make_name: string;
  support_level: VehicleSupportLevel;
  notes?: string | null;
  created_at: string;
}

export interface ProviderVehicleClassSupportEntity {
  id: string;
  provider_id: string;
  vehicle_class: VehicleClass;
  support_level: VehicleSupportLevel;
  created_at: string;
}

export interface ProviderOperatingHoursEntity {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  day_of_week: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  opens_at: string;    // 'HH:MM'
  closes_at: string;   // 'HH:MM'
  timezone: string;
  is_closed: boolean;
  effective_from?: string | null;
  effective_until?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderScheduleExceptionEntity {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  exception_date: string; // 'YYYY-MM-DD'
  is_closed: boolean;
  opens_at?: string | null;
  closes_at?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface ProviderServiceAreaEntity {
  id: string;
  provider_id: string;
  branch_id?: string | null;
  name?: string | null;
  area_type: ServiceAreaType;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_km?: number | null;
  polygon_json?: string | null;
  country: string;
  region?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
}

export interface ProviderStaffProfileEntity {
  id: string;
  provider_id: string;
  membership_id: string;
  organization_membership_id?: string;
  job_title: string;
  professional_role: StaffProfessionalRole;
  status: StaffStatus;
  branch_id?: string | null;
  specialization?: string | null;
  certifications?: string | null;
  years_experience?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderStaffBranchAssignmentEntity {
  id: string;
  staff_profile_id: string;
  branch_id: string;
  is_primary: boolean;
  created_at: string;
}

export interface TechnicianSkillEntity {
  id: string;
  staff_profile_id: string;
  skill_name: string;
  proficiency_level: 'APPRENTICE' | 'JOURNEYMAN' | 'EXPERT' | 'MASTER';
  created_at: string;
}

export interface ProviderVerificationCaseEntity {
  id: string;
  provider_id: string;
  verification_type: VerificationType;
  status: VerificationCaseStatus;
  document_file_ids: string[]; // JSON array of file IDs
  submitted_at: string;
  submitted_by_user_id: string;
  reviewed_at?: string | null;
  reviewed_by_user_id?: string | null;
  decision_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderSearchProjectionRow {
  provider_id: string;
  display_name: string;
  provider_type: string;
  status: string;
  verification_status: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  county_state: string | null;
  service_categories: string; // JSON array of category codes
  delivery_modes: string; // JSON array of delivery modes
  supported_makes: string; // JSON array of make names
  supported_classes: string; // JSON array of vehicle classes
  service_radius_km: number | null;
  accepts_mobile: number;
  accepts_roadside: number;
  accepts_towing: number;
  is_discoverable: number;
  updated_at: string;
}

// -------------------------------------------------------------------------
// DTOs & API Contracts
// -------------------------------------------------------------------------

export interface CreateProviderDto {
  organization_id: string;
  name: string;
  legal_business_name?: string;
  provider_type: ProviderType;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
  currency?: string;
  callout_fee?: number;
  service_radius_km?: number;
  accepts_bookings?: boolean;
  accepts_mobile_jobs?: boolean;
  accepts_roadside_jobs?: boolean;
  accepts_towing_jobs?: boolean;
  initial_location?: {
    name: string;
    location_type: ProviderLocationType;
    address_line1: string;
    address_line2?: string;
    city: string;
    county_state: string;
    country?: string;
    postal_code?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  };
}

export interface UpdateProviderDto {
  name?: string;
  legal_business_name?: string;
  provider_type?: ProviderType;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
  currency?: string;
  callout_fee?: number;
  service_radius_km?: number;
  accepts_bookings?: boolean;
  accepts_mobile_jobs?: boolean;
  accepts_roadside_jobs?: boolean;
  accepts_towing_jobs?: boolean;
  status?: ProviderStatus;
}

export interface CreateProviderLocationDto {
  name: string;
  location_type: ProviderLocationType;
  address_line1: string;
  address_line2?: string;
  city: string;
  county_state: string;
  country?: string;
  postal_code?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  is_primary?: boolean;
}

export interface CreateProviderBranchDto {
  location_id: string;
  name: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'TEMPORARILY_CLOSED';
  manager_membership_id?: string;
  phone?: string;
  email?: string;
}

export interface CreateServiceCapabilityDto {
  branch_id?: string;
  service_category_id: string;
  service_code: string;
  service_name: string;
  description?: string;
  delivery_mode: ServiceDeliveryMode;
  pricing_type: ServicePricingType;
  indicative_price?: number;
  currency?: string;
  booking_enabled?: boolean;
  roadside_eligible?: boolean;
  pricing_model?: string;
  base_price?: number;
  estimated_duration_min?: number;
  requires_intake_inspection?: boolean;
}

export interface SetOperatingHoursDto {
  branch_id?: string;
  hours: Array<{
    day_of_week: number;
    opens_at: string;
    closes_at: string;
    timezone?: string;
    is_closed?: boolean;
  }>;
}

export interface CreateScheduleExceptionDto {
  branch_id?: string;
  exception_date: string;
  is_closed: boolean;
  opens_at?: string;
  closes_at?: string;
  reason?: string;
}

export interface CreateServiceAreaDto {
  area_type: ServiceAreaType;
  center_lat?: number;
  center_lng?: number;
  radius_km?: number;
  polygon_coords?: Array<{ lat: number; lng: number }>;
  country?: string;
  region?: string;
}

export interface CreateStaffProfileDto {
  membership_id?: string;
  organization_membership_id?: string;
  job_title?: string;
  professional_role?: StaffProfessionalRole;
  branch_id?: string;
  branch_ids?: string[];
  skills?: Array<{ skill_name: string; proficiency_level: 'APPRENTICE' | 'JOURNEYMAN' | 'EXPERT' | 'MASTER' }>;
  specialization?: string;
  certifications?: string[] | string;
  years_experience?: number;
}

export interface SubmitVerificationDto {
  verification_type: VerificationType;
  document_file_ids: string[];
}

export interface DecideVerificationDto {
  status: 'APPROVED' | 'REJECTED';
  decision_reason: string;
}

// -------------------------------------------------------------------------
// Search & Discovery Contracts (GAR-011 §16)
// -------------------------------------------------------------------------

export interface ProviderSearchQueryDto {
  query?: string;
  keyword?: string;
  category?: string;
  service_category?: string;
  provider_type?: ProviderType;
  delivery_mode?: ServiceDeliveryMode;
  make?: string;
  vehicle_make?: string;
  vehicle_class?: VehicleClass;
  latitude?: number;
  longitude?: number;
  near_lat?: number;
  near_lng?: number;
  radius_km?: number;
  city?: string;
  open_now?: boolean;
  is_open_now?: boolean;
  verified_only?: boolean;
  verification_status?: ProviderVerificationStatus | string;
  accepts_mobile?: boolean;
  accepts_roadside?: boolean;
  accepts_towing?: boolean;
  limit?: number;
  offset?: number;
}

export interface ProviderSearchResultItem {
  id: string;
  name: string;
  legal_business_name?: string | null;
  provider_type: ProviderType;
  status: ProviderStatus;
  verification_status: ProviderVerificationStatus;
  primary_location?: {
    id: string;
    name: string;
    city: string;
    county_state: string;
    latitude: number;
    longitude: number;
    address_line1: string;
  } | null;
  distance_km?: number | null;
  operating_state: OperatingState;
  service_categories: string[];
  delivery_modes: ServiceDeliveryMode[];
  supported_makes: string[];
  supported_classes: VehicleClass[];
  accepts_bookings: boolean;
  accepts_mobile_jobs: boolean;
  accepts_roadside_jobs: boolean;
  accepts_towing_jobs: boolean;
  callout_fee?: number | null;
  currency: string;
}

export interface ProviderPublicDetailDto {
  provider: ServiceProviderEntity;
  locations: ProviderLocationEntity[];
  branches: ProviderBranchEntity[];
  capabilities: ProviderServiceCapabilityEntity[];
  operating_hours: ProviderOperatingHoursEntity[];
  exceptions?: ProviderScheduleExceptionEntity[];
  schedule_exceptions?: ProviderScheduleExceptionEntity[];
  service_areas: ProviderServiceAreaEntity[];
  makes_supported?: ProviderVehicleMakeSupportEntity[] | string[];
  classes_supported?: ProviderVehicleClassSupportEntity[] | VehicleClass[];
  operating_state?: OperatingState;
  supported_makes?: string[];
  supported_classes?: VehicleClass[];
  active_staff_count?: number;
  current_operating_state?: OperatingState;
  operating_state_reason?: string | null;
}

export interface ProviderAdminDetailDto extends ProviderPublicDetailDto {
  staff: Array<ProviderStaffProfileEntity & {
    user_id: string;
    user_name: string;
    user_email: string;
    membership_role: string;
    skills: TechnicianSkillEntity[];
    assigned_branch_ids: string[];
  }>;
  verification_cases: ProviderVerificationCaseEntity[];
}

// -------------------------------------------------------------------------
// Compatibility Aliases for Routers & Service
// -------------------------------------------------------------------------
export type ProviderEntity = ServiceProviderEntity;
export type ProviderCapabilityEntity = ProviderServiceCapabilityEntity;
export type ProviderDetailResponse = ProviderPublicDetailDto;
export type ProviderSearchCriteria = ProviderSearchQueryDto;
export type ProviderSearchResponse = {
  items: ProviderSearchResultItem[];
  total: number;
  limit: number;
  offset: number;
};
export type ProviderStaffEntity = ProviderStaffProfileEntity;

export interface ProviderVerificationDocumentEntity {
  id: string;
  provider_id: string;
  document_type: string;
  document_number?: string | null;
  file_key: string;
  file_name: string;
  status: string;
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateProviderInput = CreateProviderDto;
export type UpdateProviderInput = UpdateProviderDto;
export type CreateLocationInput = CreateProviderLocationDto & {
  location_name?: string;
  country_code?: string;
  place_id?: string;
  is_public?: boolean;
};
export type CreateBranchInput = CreateProviderBranchDto & {
  is_main_branch?: boolean;
  code?: string;
  contact_phone?: string;
  contact_email?: string;
};
export type CreateCapabilityInput = CreateServiceCapabilityDto;
export type CreateOperatingHoursInput = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  timezone?: string;
  is_closed?: boolean;
};
export type CreateScheduleExceptionInput = CreateScheduleExceptionDto;
export type CreateServiceAreaInput = CreateServiceAreaDto & {
  branch_id?: string | null;
  name?: string;
};
export type AssignStaffInput = CreateStaffProfileDto & {
  permissions?: string[];
  is_active?: boolean;
};
export interface SubmitVerificationDocumentInput {
  document_type: string;
  document_number?: string | null;
  file_key: string;
  file_name: string;
}
export interface ReviewVerificationInput {
  document_id: string;
  status: 'VERIFIED' | 'REJECTED';
  notes?: string;
}
