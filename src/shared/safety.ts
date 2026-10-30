/**
 * Garage OS Safety Criticality & Safety Truth Law (GAR-000 §15, GAR-017, GAR-041)
 *
 * Safety Truth Law:
 * The platform never represents an emergency, provider dispatch, notification
 * or payment as completed merely because a client attempted it.
 *
 * The frontend and backend must distinguish:
 * LOCAL_ACTION -> SERVER_ACKNOWLEDGED -> EXTERNAL_DELIVERY_OR_ACCEPTANCE -> FINAL_COMPLETION
 */

export enum SafetyCriticalityClass {
  S0_SAFETY_CRITICAL = 'S0_SAFETY_CRITICAL', // SOS activation, emergency contact delivery truth, dispatch acceptance
  S1_HIGH_IMPACT = 'S1_HIGH_IMPACT',         // Roadside/tow assignment, severe health warning, accident evidence
  S2_TRANSACTIONAL = 'S2_TRANSACTIONAL',     // Bookings, service authorization, payments, orders
  S3_INFORMATIONAL = 'S3_INFORMATIONAL',     // Car care articles, non-critical analytics
}

export enum SafetyWorkflowState {
  LOCAL_ACTION = 'LOCAL_ACTION',
  SERVER_ACKNOWLEDGED = 'SERVER_ACKNOWLEDGED',
  EXTERNAL_DELIVERY_OR_ACCEPTANCE = 'EXTERNAL_DELIVERY_OR_ACCEPTANCE',
  FINAL_COMPLETION = 'FINAL_COMPLETION',
  FAILED = 'FAILED',
  UNCONFIRMED_DEGRADED = 'UNCONFIRMED_DEGRADED',
}

export interface SafetyStateVerification {
  criticality: SafetyCriticalityClass;
  workflow_state: SafetyWorkflowState;
  acknowledged_at?: string;
  delivered_at?: string;
  completed_at?: string;
  failure_reason?: string;
  is_optimistic_forbidden: boolean;
}
