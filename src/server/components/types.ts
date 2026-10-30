/**
 * Canonical Tyres, Parts, Components & Vehicle Configuration Architecture Types (GAR-010)
 *
 * Rules:
 * 1. Physical-component lifecycle distinguishes Component Definition, Part Product, Installed Component, and Position.
 * 2. Strict auditability: prior installation records are never overwritten.
 * 3. Atomic replacement and tyre rotation transactions.
 * 4. Derived status evaluation for warranties and configurations.
 */

import { OdometerUnit } from '../vehicle/types';

export enum ComponentCategory {
  ENGINE = 'ENGINE',
  TRANSMISSION = 'TRANSMISSION',
  DRIVETRAIN = 'DRIVETRAIN',
  BRAKES = 'BRAKES',
  SUSPENSION = 'SUSPENSION',
  STEERING = 'STEERING',
  EXHAUST = 'EXHAUST',
  ELECTRICAL = 'ELECTRICAL',
  BATTERY = 'BATTERY',
  LIGHTING = 'LIGHTING',
  COOLING = 'COOLING',
  FUEL_SYSTEM = 'FUEL_SYSTEM',
  HVAC = 'HVAC',
  BODY_PANEL = 'BODY_PANEL',
  INTERIOR = 'INTERIOR',
  AUDIO_INFOTAINMENT = 'AUDIO_INFOTAINMENT',
  WHEELS = 'WHEELS',
  TYRES = 'TYRES',
  ACCESSORY = 'ACCESSORY',
  SAFETY = 'SAFETY',
  OTHER = 'OTHER',
}

export enum ComponentClassification {
  CONSUMABLE = 'CONSUMABLE',
  WEAR_ITEM = 'WEAR_ITEM',
  DURABLE_COMPONENT = 'DURABLE_COMPONENT',
  ACCESSORY = 'ACCESSORY',
  MODIFICATION = 'MODIFICATION',
}

export enum ComponentStatus {
  INSTALLED = 'INSTALLED',
  REMOVED = 'REMOVED',
  REPLACED = 'REPLACED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

export enum PartClassification {
  OEM = 'OEM',
  OEM_EQUIVALENT = 'OEM_EQUIVALENT',
  AFTERMARKET = 'AFTERMARKET',
  REMANUFACTURED = 'REMANUFACTURED',
  USED = 'USED',
  UNKNOWN = 'UNKNOWN',
}

export enum PartCondition {
  NEW = 'NEW',
  USED = 'USED',
  RECONDITIONED = 'RECONDITIONED',
  REMANUFACTURED = 'REMANUFACTURED',
  UNKNOWN = 'UNKNOWN',
}

export enum PartProvenance {
  OWNER_ENTERED = 'OWNER_ENTERED',
  GARAGE_RECORDED = 'GARAGE_RECORDED',
  MARKETPLACE_PURCHASE = 'MARKETPLACE_PURCHASE',
  PARTS_DEALER = 'PARTS_DEALER',
  EXTERNAL_CATALOG = 'EXTERNAL_CATALOG',
  SYSTEM_IMPORTED = 'SYSTEM_IMPORTED',
}

export enum PartVerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  OWNER_ASSERTED = 'OWNER_ASSERTED',
  PROVIDER_RECORDED = 'PROVIDER_RECORDED',
  EVIDENCE_SUPPORTED = 'EVIDENCE_SUPPORTED',
  CATALOG_VERIFIED = 'CATALOG_VERIFIED',
  DISPUTED = 'DISPUTED',
}

export enum RemovalReason {
  WORN = 'WORN',
  FAILED = 'FAILED',
  UPGRADED = 'UPGRADED',
  ACCIDENT_DAMAGE = 'ACCIDENT_DAMAGE',
  PREVENTIVE_REPLACEMENT = 'PREVENTIVE_REPLACEMENT',
  INCORRECT_FITMENT = 'INCORRECT_FITMENT',
  OTHER = 'OTHER',
}

export enum WarrantyType {
  MANUFACTURER = 'MANUFACTURER',
  SELLER = 'SELLER',
  GARAGE = 'GARAGE',
  INSTALLATION = 'INSTALLATION',
  EXTENDED = 'EXTENDED',
  UNKNOWN = 'UNKNOWN',
}

export enum WarrantyStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  VOID = 'VOID',
  CLAIMED = 'CLAIMED',
  UNKNOWN = 'UNKNOWN',
}

export enum TyrePosition {
  FRONT_LEFT = 'FRONT_LEFT',
  FRONT_RIGHT = 'FRONT_RIGHT',
  REAR_LEFT = 'REAR_LEFT',
  REAR_RIGHT = 'REAR_RIGHT',
  SPARE = 'SPARE',
  FRONT_CENTER = 'FRONT_CENTER',
  REAR_CENTER = 'REAR_CENTER',
}

export enum TyreRotationPattern {
  FORWARD_CROSS = 'FORWARD_CROSS',
  REARWARD_CROSS = 'REARWARD_CROSS',
  X_PATTERN = 'X_PATTERN',
  FRONT_TO_REAR = 'FRONT_TO_REAR',
  SIDE_TO_SIDE = 'SIDE_TO_SIDE',
  FIVE_TYRE_FORWARD = 'FIVE_TYRE_FORWARD',
  FIVE_TYRE_REARWARD = 'FIVE_TYRE_REARWARD',
  CUSTOM = 'CUSTOM',
}

export enum TyreConditionRating {
  GOOD = 'GOOD',
  FAIR = 'FAIR',
  POOR = 'POOR',
  CRITICAL = 'CRITICAL',
}

export enum TyreSeasonType {
  ALL_SEASON = 'ALL_SEASON',
  SUMMER = 'SUMMER',
  WINTER = 'WINTER',
  ALL_TERRAIN = 'ALL_TERRAIN',
  MUD_TERRAIN = 'MUD_TERRAIN',
}

export enum ModificationStatus {
  INSTALLED = 'INSTALLED',
  REMOVED = 'REMOVED',
  REPLACED = 'REPLACED',
  REVERTED = 'REVERTED',
}

// Entity Interfaces
export interface ComponentDefinitionEntity {
  id: string;
  code: string;
  name: string;
  category: ComponentCategory;
  subcategory: string | null;
  classification: ComponentClassification;
  description: string | null;
  position_sensitive: boolean;
  replaceable: boolean;
  serviceable: boolean;
  serializable: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartsCatalogItemEntity {
  id: string;
  component_definition_id: string | null;
  manufacturer: string;
  brand: string;
  part_number: string;
  oem_number: string | null;
  name: string;
  description: string | null;
  classification: PartClassification;
  condition: PartCondition;
  created_at: string;
  updated_at: string;
}

export interface VehicleComponentEntity {
  id: string;
  vehicle_id: string;
  component_definition_id: string | null;
  part_id: string | null;
  custom_name: string;
  category: ComponentCategory;
  subcategory: string | null;
  classification: ComponentClassification;
  brand: string | null;
  model: string | null;
  part_number: string | null;
  oem_number: string | null;
  serial_number: string | null;
  position: string | null;
  status: ComponentStatus;
  installed_at: string;
  installed_odometer_km: number | null;
  installed_odometer_unit: OdometerUnit | null;
  installation_source: PartProvenance;
  installation_provider_id: string | null;
  installation_provider_name: string | null;
  installation_work_order_id: string | null;
  verification_status: PartVerificationStatus;
  removed_at: string | null;
  removed_odometer_km: number | null;
  removal_reason: RemovalReason | null;
  maintenance_completion_id: string | null;
  issue_intervention_id: string | null;
  vehicle_expense_id: string | null;
  notes: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleComponentReplacementEntity {
  id: string;
  vehicle_id: string;
  old_component_id: string;
  new_component_id: string;
  replaced_at: string;
  odometer_km: number | null;
  reason: RemovalReason;
  notes: string | null;
  created_at: string;
}

export interface VehicleComponentEventEntity {
  id: string;
  vehicle_component_id: string;
  vehicle_id: string;
  event_type: string;
  occurred_at: string;
  odometer_km: number | null;
  actor_id: string;
  actor_type: string;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ComponentWarrantyEntity {
  id: string;
  vehicle_component_id: string;
  vehicle_id: string;
  provider_id: string | null;
  provider_name: string | null;
  seller_id: string | null;
  warranty_type: WarrantyType;
  starts_at: string;
  expires_at: string | null;
  distance_limit_km: number | null;
  distance_limit_value: number | null;
  distance_unit: OdometerUnit | null;
  terms_summary: string;
  document_reference: string | null;
  status: WarrantyStatus;
  created_at: string;
  updated_at: string;
  // Computed evaluation fields
  computed_is_active?: boolean;
  distance_remaining_km?: number | null;
  days_remaining?: number | null;
}

export interface ComponentEvidenceLinkEntity {
  id: string;
  vehicle_component_id: string;
  vehicle_id: string;
  document_id: string | null;
  evidence_type: string;
  file_url: string;
  caption: string | null;
  created_at: string;
}

export interface VehicleTyreSetEntity {
  id: string;
  vehicle_id: string;
  name: string;
  season_type: TyreSeasonType;
  installed_at: string;
  status: string;
  created_at: string;
}

export interface VehicleTyreEntity {
  id: string;
  vehicle_id: string;
  vehicle_component_id: string | null;
  part_id: string | null;
  tyre_set_id: string | null;
  brand: string;
  model: string;
  size_raw: string;
  width: number;
  aspect_ratio: number;
  rim_diameter: number;
  construction: string;
  load_index: number | null;
  speed_rating: string | null;
  manufacture_dot_code: string | null;
  serial_number: string | null;
  status: ComponentStatus;
  installed_at: string;
  installed_odometer_km: number | null;
  removed_at: string | null;
  removed_odometer_km: number | null;
  removal_reason: RemovalReason | null;
  provenance: PartProvenance;
  verification_status: PartVerificationStatus;
  created_at: string;
  updated_at: string;
  // Current assignment helper
  current_position?: TyrePosition | null;
  service_distance_km?: number | null;
}

export interface TyrePositionAssignmentEntity {
  id: string;
  vehicle_tyre_id: string;
  vehicle_id: string;
  position: TyrePosition;
  assigned_at: string;
  assigned_odometer_km: number | null;
  ended_at: string | null;
  ended_odometer_km: number | null;
  source: string;
  is_current: boolean;
  created_at: string;
}

export interface TyreRotationEntity {
  id: string;
  vehicle_id: string;
  performed_at: string;
  odometer_km: number | null;
  pattern: TyreRotationPattern | string;
  provider_id: string | null;
  provider_name: string | null;
  work_order_id: string | null;
  notes: string | null;
  maintenance_completion_id: string | null;
  created_at: string;
  moves?: TyreRotationMoveEntity[];
}

export interface TyreRotationMoveEntity {
  id: string;
  tyre_rotation_id: string;
  vehicle_tyre_id: string;
  from_position: TyrePosition;
  to_position: TyrePosition;
  created_at: string;
}

export interface TyreInspectionEntity {
  id: string;
  vehicle_tyre_id: string;
  vehicle_id: string;
  tread_depth_outer_mm: number | null;
  tread_depth_center_mm: number | null;
  tread_depth_inner_mm: number | null;
  pressure_psi: number | null;
  condition_rating: TyreConditionRating;
  observed_at: string;
  source_type: string;
  provider_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface VehicleModificationEntity {
  id: string;
  vehicle_id: string;
  category: string;
  name: string;
  description: string;
  installed_at: string;
  odometer_km: number | null;
  provider_id: string | null;
  provider_name: string | null;
  work_order_id: string | null;
  status: ModificationStatus;
  verification_status: PartVerificationStatus;
  vehicle_component_id: string | null;
  vehicle_expense_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleConfigurationOverrideEntity {
  id: string;
  vehicle_id: string;
  attribute_key: string;
  original_value: string;
  current_value: string;
  source_reference: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

// Request & Composite DTOs
export interface InstallComponentInput {
  vehicle_id: string;
  component_definition_id?: string;
  part_id?: string;
  custom_name: string;
  category: ComponentCategory;
  subcategory?: string;
  classification?: ComponentClassification;
  brand?: string;
  model?: string;
  part_number?: string;
  oem_number?: string;
  serial_number?: string;
  position?: string;
  installed_at?: string;
  installed_odometer_km?: number;
  installed_odometer_unit?: OdometerUnit;
  installation_source?: PartProvenance;
  installation_provider_id?: string;
  installation_provider_name?: string;
  installation_work_order_id?: string;
  verification_status?: PartVerificationStatus;
  maintenance_completion_id?: string;
  issue_intervention_id?: string;
  vehicle_expense_id?: string;
  notes?: string;
  // Optional warranty attached at install time
  warranty?: {
    provider_name?: string;
    warranty_type: WarrantyType;
    starts_at?: string;
    expires_at?: string;
    distance_limit_km?: number;
    terms_summary: string;
  };
}

export interface ReplaceComponentInput {
  old_component_id: string;
  new_component: InstallComponentInput;
  replaced_at?: string;
  odometer_km?: number;
  reason: RemovalReason;
  notes?: string;
}

export interface RemoveComponentInput {
  component_id: string;
  removed_at?: string;
  removed_odometer_km?: number;
  reason: RemovalReason;
  notes?: string;
}

export interface InstallTyreInput {
  vehicle_id: string;
  part_id?: string;
  tyre_set_id?: string;
  brand: string;
  model: string;
  size_raw: string;
  width: number;
  aspect_ratio: number;
  rim_diameter: number;
  construction?: string;
  load_index?: number;
  speed_rating?: string;
  manufacture_dot_code?: string;
  serial_number?: string;
  position: TyrePosition;
  installed_at?: string;
  installed_odometer_km?: number;
  provenance?: PartProvenance;
  verification_status?: PartVerificationStatus;
}

export interface RotateTyresInput {
  vehicle_id: string;
  performed_at?: string;
  odometer_km?: number;
  pattern: TyreRotationPattern | string;
  provider_id?: string;
  provider_name?: string;
  work_order_id?: string;
  notes?: string;
  maintenance_completion_id?: string;
  moves: Array<{
    vehicle_tyre_id: string;
    from_position: TyrePosition;
    to_position: TyrePosition;
  }>;
}

export interface ReplaceTyreInput {
  old_tyre_id: string;
  new_tyre: InstallTyreInput;
  replaced_at?: string;
  odometer_km?: number;
  reason: RemovalReason;
  notes?: string;
}

export interface InspectTyreInput {
  vehicle_tyre_id: string;
  tread_depth_outer_mm?: number;
  tread_depth_center_mm?: number;
  tread_depth_inner_mm?: number;
  pressure_psi?: number;
  condition_rating: TyreConditionRating;
  observed_at?: string;
  source_type?: string;
  provider_id?: string;
  notes?: string;
}

export interface RecordModificationInput {
  vehicle_id: string;
  category: string;
  name: string;
  description: string;
  installed_at?: string;
  odometer_km?: number;
  provider_id?: string;
  provider_name?: string;
  work_order_id?: string;
  verification_status?: PartVerificationStatus;
  vehicle_component_id?: string;
  vehicle_expense_id?: string;
  overrides?: Array<{
    attribute_key: string;
    original_value: string;
    current_value: string;
    source_reference?: string;
  }>;
}

export interface VehicleConfigurationSummaryDTO {
  vehicle_id: string;
  factory_configuration: {
    engine?: string;
    transmission?: string;
    drive_type?: string;
    tyre_size_oem?: string;
    rim_diameter_oem?: number;
    color?: string;
  };
  current_configuration: {
    active_components_count: number;
    tyres_installed_count: number;
    modifications_count: number;
    active_warranties_count: number;
  };
  overrides: VehicleConfigurationOverrideEntity[];
  modifications: VehicleModificationEntity[];
  active_components: VehicleComponentEntity[];
  active_tyres: Array<VehicleTyreEntity & { current_position: TyrePosition | null }>;
  warranties: ComponentWarrantyEntity[];
}
