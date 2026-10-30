/**
 * Garage OS Data Truth Hierarchy & Provenance Semantics (GAR-000 §5, GAR-005 §7, GAR-041)
 *
 * Provenance Law: Owner assertion, provider record, device observation,
 * external verification and AI inference are distinguishable data classes.
 */

export enum DataProvenanceClass {
  EXTERNALLY_VERIFIED = 'EXTERNALLY_VERIFIED',
  PROVIDER_RECORDED = 'PROVIDER_RECORDED',
  DEVICE_OBSERVED = 'DEVICE_OBSERVED',
  OWNER_ASSERTED = 'OWNER_ASSERTED',
  DERIVED_DETERMINISTIC = 'DERIVED_DETERMINISTIC',
  AI_MODEL_INFERRED = 'AI_MODEL_INFERRED',
}

export interface ProvenanceMetadata {
  source_class: DataProvenanceClass;
  source_ref?: string; // Provider ID, device ID, algorithm version, or user ID
  recorded_at: string; // Server UTC ISO timestamp
  occurrence_time: string; // Business event occurrence time
  confidence_score?: number; // 0.0 to 1.0 where applicable (e.g. AI or noisy telemetry)
  verification_status?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'DISPUTED' | 'SUPERSEDED';
}

export const PROVENANCE_TRUST_ORDER: Record<DataProvenanceClass, number> = {
  [DataProvenanceClass.EXTERNALLY_VERIFIED]: 100,
  [DataProvenanceClass.PROVIDER_RECORDED]: 80,
  [DataProvenanceClass.DEVICE_OBSERVED]: 60,
  [DataProvenanceClass.DERIVED_DETERMINISTIC]: 50,
  [DataProvenanceClass.OWNER_ASSERTED]: 30,
  [DataProvenanceClass.AI_MODEL_INFERRED]: 20,
};
