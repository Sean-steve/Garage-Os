/**
 * Sprint 23 — Vehicle Compatibility & Fitment (GAR-022)
 *
 * Compatibility is contextual to product × vehicle. A product never becomes
 * globally "compatible" merely because it fits one vehicle.
 */

export type FitmentDecisionStatus =
  | 'UNKNOWN'
  | 'GENERIC'
  | 'SELLER_CLAIMED'
  | 'PROBABLE'
  | 'CONFIRMED'
  | 'CONFLICT'
  | 'NOT_COMPATIBLE';

export type FitmentRuleKind = 'INCLUDE' | 'EXCLUDE' | 'GENERIC';
export type FitmentSourceType =
  | 'SELLER'
  | 'MANUFACTURER'
  | 'CATALOG_PROVIDER'
  | 'GARAGE_VERIFIED'
  | 'PLATFORM_CURATED';
export type FitmentVerificationStatus = 'SELLER_ASSERTED' | 'UNVERIFIED' | 'VERIFIED';

export interface FitmentSource {
  id:string;
  source_type:FitmentSourceType;
  display_name:string;
  owner_organization_id:string|null;
  provider_key:string|null;
  verification_authority:boolean;
  trust_rank:number;
  status:'ACTIVE'|'PAUSED'|'RETIRED';
  created_at:string;
  updated_at:string;
}

export interface ProductFitmentRule {
  id:string;
  product_id:string;
  source_id:string|null;
  source_type:FitmentSourceType;
  rule_kind:FitmentRuleKind;
  vehicle_make:string|null;
  vehicle_model:string|null;
  year_from:number|null;
  year_to:number|null;
  trim:string|null;
  variant:string|null;
  body_type:string|null;
  engine_type:string|null;
  fuel_type:string|null;
  transmission:string|null;
  drive_type:string|null;
  evidence_reference:string|null;
  evidence_summary:string|null;
  verification_status:FitmentVerificationStatus;
  status:'ACTIVE'|'REVOKED';
  created_by:string;
  created_at:string;
  updated_at:string;
  source_display_name:string|null;
  source_verification_authority:boolean;
  source_trust_rank:number|null;
}

export interface CreateFitmentRuleInput {
  rule_kind:FitmentRuleKind;
  vehicle_make?:string|null;
  vehicle_model?:string|null;
  year_from?:number|null;
  year_to?:number|null;
  trim?:string|null;
  variant?:string|null;
  body_type?:string|null;
  engine_type?:string|null;
  fuel_type?:string|null;
  transmission?:string|null;
  drive_type?:string|null;
  evidence_reference?:string|null;
  evidence_summary?:string|null;
}

export interface CreateFitmentSourceInput {
  source_type:Exclude<FitmentSourceType,'SELLER'>;
  display_name:string;
  owner_organization_id?:string|null;
  provider_key:string;
  verification_authority?:boolean;
  trust_rank?:number;
}

export interface CreateAuthoritativeFitmentRuleInput extends CreateFitmentRuleInput {
  product_id:string;
  source_id:string;
  verification_status?:'UNVERIFIED'|'VERIFIED';
}

export interface FitmentDecision {
  id:string|null;
  product_id:string;
  listing_id:string|null;
  vehicle_id:string;
  status:FitmentDecisionStatus;
  confidence:number;
  guaranteed:false;
  matched_rule_ids:string[];
  conflict_rule_ids:string[];
  reason:string;
  disclaimer:string;
  engine_version:string;
  evaluated_at:string;
}

export interface FitmentInstallationLink {
  id:string;
  vehicle_id:string;
  product_id:string;
  listing_id:string|null;
  vehicle_component_id:string|null;
  fitment_decision_id:string|null;
  fitment_status_at_install:FitmentDecisionStatus;
  installation_source:'OWNER_RECORDED'|'GARAGE_RECORDED'|'SYSTEM_LINKED';
  verification_status:'UNVERIFIED'|'PROVIDER_RECORDED'|'VERIFIED';
  notes:string|null;
  recorded_by:string;
  installed_at:string;
  created_at:string;
}

export const FITMENT_ENGINE_VERSION='gar-022-v1';
export const FITMENT_DISCLAIMER =
  'Compatibility is based on the vehicle data and fitment evidence currently available. It is not a guarantee of installation suitability; verify part numbers, specifications and installation requirements before purchase or installation.';
