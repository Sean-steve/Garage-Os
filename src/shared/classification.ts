/**
 * Garage OS Data Classification & Privacy Minimization (GAR-040, GAR-000 §10)
 *
 * Privacy Minimization Law: Precise location, emergency data and personal data
 * are purpose-bound and minimized.
 */

export enum DataClassificationLevel {
  PUBLIC = 'PUBLIC',                                     // Storefronts, public provider profiles, catalog
  INTERNAL = 'INTERNAL',                                 // System configuration, non-sensitive metrics
  CONFIDENTIAL = 'CONFIDENTIAL',                         // User profile, vehicle basic attributes
  RESTRICTED_FINANCIAL = 'RESTRICTED_FINANCIAL',         // Ledger entries, payments, commission, bank/m-pesa refs
  HIGHLY_SENSITIVE_LOCATION = 'HIGHLY_SENSITIVE_LOCATION', // Real-time GPS, journey breadcrumbs, trip checkpoints
  SENSITIVE_EMERGENCY = 'SENSITIVE_EMERGENCY',           // SOS incident data, emergency contact medical notes
}

export interface ClassifiedFieldPolicy {
  classification: DataClassificationLevel;
  redact_in_logs: boolean;
  requires_explicit_scope: boolean;
  retention_days?: number;
}
