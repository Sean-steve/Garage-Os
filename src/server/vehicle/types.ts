/**
 * Canonical Vehicle Domain Types (GAR-004, GAR-033 §12A, GAR-034)
 */

import { DataProvenanceClass } from '../../shared/provenance';

export enum VehicleStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SOLD = 'SOLD',
  TRANSFER_PENDING = 'TRANSFER_PENDING',
  WRITTEN_OFF = 'WRITTEN_OFF',
  ARCHIVED = 'ARCHIVED',
}

export enum VehicleType {
  SEDAN = 'SEDAN',
  HATCHBACK = 'HATCHBACK',
  SUV = 'SUV',
  CROSSOVER = 'CROSSOVER',
  PICKUP = 'PICKUP',
  VAN = 'VAN',
  MINIVAN = 'MINIVAN',
  COUPE = 'COUPE',
  CONVERTIBLE = 'CONVERTIBLE',
  WAGON = 'WAGON',
  COMMERCIAL = 'COMMERCIAL',
  OTHER = 'OTHER',
}

export enum FuelType {
  PETROL = 'PETROL',
  DIESEL = 'DIESEL',
  HYBRID_PETROL = 'HYBRID_PETROL',
  HYBRID_DIESEL = 'HYBRID_DIESEL',
  PLUG_IN_HYBRID = 'PLUG_IN_HYBRID',
  ELECTRIC = 'ELECTRIC',
  LPG = 'LPG',
  CNG = 'CNG',
  OTHER = 'OTHER',
}

export enum TransmissionType {
  MANUAL = 'MANUAL',
  AUTOMATIC = 'AUTOMATIC',
  CVT = 'CVT',
  DCT = 'DCT',
  SEMI_AUTOMATIC = 'SEMI_AUTOMATIC',
  OTHER = 'OTHER',
}

export enum DriveType {
  FWD = 'FWD',
  RWD = 'RWD',
  AWD = 'AWD',
  FOUR_WD = '4WD',
  OTHER = 'OTHER',
}

export enum VehicleIdentifierType {
  VIN = 'VIN',
  CHASSIS_NUMBER = 'CHASSIS_NUMBER',
  REGISTRATION_NUMBER = 'REGISTRATION_NUMBER',
  ENGINE_NUMBER = 'ENGINE_NUMBER',
  MANUFACTURER_CODE = 'MANUFACTURER_CODE',
  EXTERNAL_INTEGRATION = 'EXTERNAL_INTEGRATION',
}

export enum IdentifierVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  OWNER_ASSERTED = 'OWNER_ASSERTED',
  PROVIDER_CONFIRMED = 'PROVIDER_CONFIRMED',
  DOCUMENT_VERIFIED = 'DOCUMENT_VERIFIED',
  EXTERNAL_VERIFIED = 'EXTERNAL_VERIFIED',
  DISPUTED = 'DISPUTED',
}

export enum VehicleRelationshipType {
  OWNER = 'OWNER',
  CO_OWNER = 'CO_OWNER',
  PRIMARY_DRIVER = 'PRIMARY_DRIVER',
  CUSTODIAN = 'CUSTODIAN',
  FLEET_CUSTODIAN = 'FLEET_CUSTODIAN',
  AUTHORIZED_USER = 'AUTHORIZED_USER',
}

export enum RelationshipStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  ENDED = 'ENDED',
}

export enum OdometerUnit {
  KM = 'KM',
  MILES = 'MILES',
}

export enum OdometerObservationStatus {
  VALID = 'VALID',
  FLAGGED = 'FLAGGED',
  SUPERSEDED = 'SUPERSEDED',
  REJECTED = 'REJECTED',
}

export enum VehicleDocumentType {
  REGISTRATION = 'REGISTRATION',
  INSURANCE = 'INSURANCE',
  INSPECTION = 'INSPECTION',
  PURCHASE_DOCUMENT = 'PURCHASE_DOCUMENT',
  IMPORT_DOCUMENT = 'IMPORT_DOCUMENT',
  OTHER = 'OTHER',
}

/**
 * Canonical Vehicle Entity (GAR-004 §4-§8)
 */
export interface VehicleEntity {
  id: string; // Immutable internal canonical ID (e.g. veh_...)
  display_name: string;
  nickname: string | null;
  make: string;
  model: string;
  model_year: number;
  trim: string | null;
  variant: string | null;
  vehicle_type: VehicleType;
  body_type: string | null;
  color: string | null;
  fuel_type: FuelType;
  transmission: TransmissionType;
  drive_type: DriveType | null;
  engine_number: string | null;
  engine_type: string | null;
  engine_displacement_cc: number | null;
  manufacture_date: string | null;
  first_registration_date: string | null;
  country_of_registration: string;
  status: VehicleStatus;
  verification_status: IdentifierVerificationStatus;
  primary_image_id: string | null;
  current_odometer_cache: number; // in km
  current_odometer_unit: OdometerUnit;
  timezone: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Structured Vehicle Identifier Entity (GAR-004 §6, GAR-033 §12A)
 */
export interface VehicleIdentifierEntity {
  id: string; // vid_...
  vehicle_id: string;
  type: VehicleIdentifierType;
  value: string;
  normalized_value: string;
  issuing_country: string;
  source: string;
  verification_status: IdentifierVerificationStatus;
  is_primary: boolean;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Vehicle Relationship Entity (GAR-004 §9, GAR-030 §5)
 */
export interface VehicleRelationshipEntity {
  id: string; // vrel_...
  vehicle_id: string;
  user_id: string;
  organization_id: string | null;
  relationship_type: VehicleRelationshipType;
  is_primary_owner: boolean;
  status: RelationshipStatus;
  provenance_class: DataProvenanceClass;
  valid_from: string;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Odometer Observation Entity (GAR-004 §11, GAR-033 §12A)
 */
export interface OdometerObservationEntity {
  id: string; // odo_...
  vehicle_id: string;
  reading_value: number;
  unit: OdometerUnit;
  reading_km: number; // Normalized canonical distance
  observed_at: string;
  recorded_at: string;
  source_class: string;
  source_ref: string | null;
  actor_id: string;
  provider_id: string | null;
  status: OdometerObservationStatus;
  flag_reason: string | null;
  superseded_by_id: string | null;
  correction_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Vehicle Document Entity (GAR-004 §14, GAR-038)
 */
export interface VehicleDocumentEntity {
  id: string; // vdoc_...
  vehicle_id: string;
  document_type: VehicleDocumentType;
  file_id: string;
  title: string;
  document_number: string | null;
  issuer: string | null;
  issued_at: string | null;
  expires_at: string | null;
  verification_status: IdentifierVerificationStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Catalog Entities
 */
export interface CatalogMakeEntity {
  id: string;
  name: string;
  country_of_origin: string | null;
  is_popular: boolean;
}

export interface CatalogModelEntity {
  id: string;
  make_id: string;
  name: string;
  body_type: string;
  fuel_types: FuelType[];
  transmissions: TransmissionType[];
  popular_model_years: number[];
}

/**
 * API Request & Response DTOs
 */
export interface CreateVehicleRequestDTO {
  make: string;
  model: string;
  model_year: number;
  trim?: string;
  variant?: string;
  vehicle_type?: VehicleType;
  body_type?: string;
  color?: string;
  fuel_type?: FuelType;
  transmission?: TransmissionType;
  drive_type?: DriveType;
  registration_number?: string;
  vin?: string;
  chassis_number?: string;
  engine_number?: string;
  engine_displacement_cc?: number;
  manufacture_date?: string;
  first_registration_date?: string;
  country_of_registration?: string;
  initial_odometer_value?: number;
  initial_odometer_unit?: OdometerUnit;
  primary_image_id?: string;
  relationship_type?: VehicleRelationshipType;
  organization_id?: string;
  nickname?: string;
}

export interface UpdateVehicleRequestDTO {
  nickname?: string | null;
  color?: string | null;
  trim?: string | null;
  variant?: string | null;
  primary_image_id?: string | null;
  body_type?: string | null;
}

export interface RecordOdometerRequestDTO {
  value: number;
  unit: OdometerUnit;
  observed_at?: string;
  source_class?: string;
  notes?: string;
}

export interface CorrectOdometerRequestDTO {
  supersedes_observation_id: string;
  corrected_value: number;
  unit: OdometerUnit;
  reason: string;
  observed_at?: string;
  notes?: string;
}

export interface AddRelationshipRequestDTO {
  user_id: string;
  relationship_type: VehicleRelationshipType;
  organization_id?: string;
  valid_from?: string;
  valid_until?: string;
  notes?: string;
}

export interface AddDocumentRequestDTO {
  document_type: VehicleDocumentType;
  file_id: string;
  title: string;
  document_number?: string;
  issuer?: string;
  issued_at?: string;
  expires_at?: string;
}

export interface VehicleSummaryDTO {
  vehicle_id: string;
  display_name: string;
  nickname: string | null;
  make: string;
  model: string;
  model_year: number;
  registration_number: string | null;
  primary_image_id: string | null;
  latest_odometer_km: number;
  latest_odometer_unit: OdometerUnit;
  relationship_type: VehicleRelationshipType;
  is_primary_owner: boolean;
  status: VehicleStatus;
  created_at: string;
}

export interface VehicleDetailDTO {
  vehicle: VehicleEntity;
  identifiers: VehicleIdentifierEntity[];
  user_relationship: VehicleRelationshipEntity | null;
  primary_owner: {
    user_id: string;
    organization_id: string | null;
  } | null;
  latest_odometer: {
    reading_km: number;
    reading_value: number;
    unit: OdometerUnit;
    observed_at: string;
    status: OdometerObservationStatus;
  };
  documents_count: number;
}
