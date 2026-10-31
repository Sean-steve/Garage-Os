export type ActiveTab = 'overview' | 'fuel' | 'maintenance' | 'issues' | 'timeline' | 'passport' | 'bookings' | 'providers' | 'workshop' | 'roadside' | 'towing' | 'dispatch' | 'safety' | 'accidents' | 'care' | 'trips' | 'marketplace' | 'fitment' | 'orders' | 'payments' | 'fulfillment' | 'queues' | 'flags' | 'audit' | 'traceability';

export interface VehicleSummary {
  id: string;
  display_name: string;
  nickname: string | null;
  make: string;
  model: string;
  model_year: number;
  trim: string | null;
  vin: string | null;
  registration_number: string | null;
  color: string | null;
  status: string;
  verification_status: string;
  current_odometer_cache: number | null;
  current_odometer_unit: string | null;
}

export interface VehicleTimelineEntry {
  id: string;
  vehicle_id: string;
  entry_type: string;
  category: string;
  occurred_at: string;
  recorded_at: string;
  title: string;
  summary: string;
  source_type: string;
  source_reference_type: string | null;
  source_reference_id: string | null;
  source_event_id: string | null;
  actor_type: string | null;
  actor_id: string | null;
  organization_id: string | null;
  verification_status: string;
  confidence: number | null;
  odometer_value: number | null;
  odometer_unit: string | null;
  location_reference: string | null;
  visibility: string;
  sensitivity: string;
  supersedes_timeline_entry_id: string | null;
  corrected_by_timeline_entry_id: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TimelineCorrection {
  id: string;
  vehicle_id: string;
  original_entry_id: string;
  corrected_entry_id: string;
  correction_reason: string;
  explanation: string;
  actor_id: string;
  actor_type: string;
  created_at: string;
}

export interface TimelineDispute {
  id: string;
  vehicle_id: string;
  timeline_entry_id: string;
  dispute_reason: string;
  actor_id: string;
  status: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface VehiclePassport {
  metadata: {
    vehicle_id: string;
    passport_version: number;
    generated_at: string;
    data_coverage_start: string | null;
    data_coverage_end: string;
    record_count: number;
    last_updated_at: string;
    integrity_hash: string;
    is_projection_current: boolean;
  };
  vehicle_identity: {
    vehicle_id: string;
    display_name: string;
    make: string;
    model: string;
    model_year: number;
    trim: string | null;
    vin: string | null;
    vin_masked: string | null;
    chassis_number: string | null;
    registration_number: string | null;
    color: string | null;
    fuel_type: string;
    transmission: string;
    drive_type: string | null;
    body_type: string | null;
    country_of_registration: string;
    status: string;
    verification_status: string;
  };
  ownership_summary: {
    total_ownership_periods: number;
    current_ownership_type: string;
    current_period_start_date: string | null;
    privacy_note: string;
  };
  mileage_history: {
    earliest_reading: {
      reading_km: number;
      reading_value: number;
      unit: string;
      observed_at: string;
    } | null;
    latest_reading: {
      reading_km: number;
      reading_value: number;
      unit: string;
      observed_at: string;
    } | null;
    total_observations_count: number;
    flagged_anomalies_count: number;
    has_rollback_warning: boolean;
    observations: Array<{
      id: string;
      reading_km: number;
      reading_value: number;
      unit: string;
      observed_at: string;
      source_class: string;
      verification_status: string;
      status: string;
      flag_reason: string | null;
    }>;
  };
  maintenance_history: {
    records_count: number;
    verified_records_count: number;
    records: Array<{
      id: string;
      title: string;
      summary: string;
      occurred_at: string;
      odometer_km: number | null;
      provider_name: string | null;
      verification_status: string;
    }>;
  };
  repair_history: {
    records_count: number;
    records: Array<{
      id: string;
      title: string;
      summary: string;
      occurred_at: string;
      odometer_km: number | null;
      verification_status: string;
    }>;
  };
  known_issues_history: {
    open_count: number;
    resolved_count: number;
    records: Array<{
      id: string;
      title: string;
      status: string;
      reported_at: string;
      resolved_at: string | null;
    }>;
  };
  installed_parts: {
    parts_count: number;
    records: Array<{
      id: string;
      name: string;
      category: string;
      installed_at: string;
      odometer_km: number | null;
    }>;
  };
  tyres: {
    installed_records_count: number;
    records: Array<{
      id: string;
      brand: string;
      size: string;
      position: string;
      installed_at: string;
    }>;
  };
  accident_history: {
    known_records_count: number;
    statement: string;
    records: Array<{
      id: string;
      incident_date: string;
      severity: string;
      summary: string;
    }>;
  };
  roadside_towing_history: {
    incidents_count: number;
    records: Array<{
      id: string;
      date: string;
      incident_type: string;
      summary: string;
    }>;
  };
  modifications: {
    modifications_count: number;
    records: Array<{
      id: string;
      title: string;
      installed_at: string;
      summary: string;
    }>;
  };
  inspections: {
    inspections_count: number;
    records: Array<{
      id: string;
      inspection_type: string;
      conducted_at: string;
      result: string;
      inspector: string | null;
    }>;
  };
  verification_summary: {
    vin_status: string;
    data_sources_breakdown: {
      externally_verified: number;
      provider_recorded: number;
      owner_asserted: number;
      device_observed: number;
      system_derived: number;
    };
    total_timeline_entries: number;
    coverage_statement: string;
  };
}

export interface PassportShareGrant {
  id: string;
  vehicle_id: string;
  created_by: string;
  token_hash: string;
  scope: string;
  recipient_label: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface PlatformCapabilities {
  platform_name: string;
  version: string;
  environment: string;
  lifecycle_state: string;
  architecture_baseline: string;
  active_sprint: string;
  next_sprint: string;
  constitutional_laws_enforced: number;
  config: Record<string, unknown>;
  domains: Array<{
    id: string;
    title: string;
    status: string;
    owner: string;
  }>;
  subsystems: {
    database: {
      type: string;
      status: string;
      latency_ms: number;
      migrations_applied: number;
    };
    event_bus: {
      type: string;
      outbox_status: string;
      pending_outbox_events: number;
      registered_event_types: string[];
    };
    background_worker: {
      status: string;
      active_jobs: number;
      queued_jobs: number;
      dead_letter_count: number;
    };
    storage: {
      provider: string;
      status: string;
      max_size_bytes: number;
    };
    security: {
      security_headers: boolean;
      rate_limiting: boolean;
      idempotency_caching: boolean;
      immutable_audit: boolean;
    };
  };
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  percentage: number;
  roles: string[];
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string;
  source: string;
  before_state: string | null;
  after_state: string | null;
  metadata: string | null;
  created_at: string;
}

export interface QueueStatus {
  summary: {
    outbox_pending: number;
    queue_depth: {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
    };
    dead_letter_count: number;
  };
  outbox_events: Array<{
    id: string;
    event_id: string;
    event_type: string;
    status: string;
    retry_count: number;
    created_at: string;
  }>;
  jobs: Array<{
    id: string;
    job_name: string;
    status: string;
    retry_count: number;
    max_retries: number;
    created_at: string;
  }>;
  dead_letters: Array<{
    id: string;
    job_id: string;
    job_name: string;
    error_message: string;
    created_at: string;
  }>;
}

export interface TraceabilityItem {
  id: string;
  title: string;
  status: string;
  constitutional_law: string;
  implemented_files: string[];
  tests: string[];
}

export interface ClientMaintenanceRequirement {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  component_system: string;
  default_severity: string;
  default_priority: number;
  recommended_action: string | null;
  recurring: boolean;
  active: boolean;
}

export interface ClientMaintenanceRule {
  id: string;
  requirement_id: string;
  interval_type: string;
  distance_interval: number | null;
  distance_unit: string | null;
  time_interval_value: number | null;
  time_interval_unit: string | null;
  trigger_policy: string;
  approaching_distance_threshold: number | null;
  approaching_time_threshold_days: number | null;
  source_type: string;
  source_reference: string | null;
}

export interface ClientMaintenancePlanEntry {
  id: string;
  plan_id: string;
  requirement_id: string;
  rule_id: string;
  enabled: boolean;
  priority_override: number | null;
  custom_distance_interval: number | null;
  custom_time_interval_value: number | null;
  custom_time_interval_unit: string | null;
  last_known_completion_id: string | null;
  notes: string | null;
}

export interface ClientMaintenanceCycle {
  id: string;
  vehicle_id: string;
  plan_entry_id: string;
  requirement_id: string;
  rule_id: string;
  cycle_number: number;
  baseline_distance_km: number | null;
  baseline_date: string | null;
  due_distance_km: number | null;
  due_date: string | null;
  status: 'OK' | 'APPROACHING' | 'DUE' | 'OVERDUE' | 'DEFERRED';
  trigger_reason: string | null;
  distance_remaining_km: number | null;
  days_remaining: number | null;
  deferred_until_date: string | null;
  deferred_until_distance_km: number | null;
  deferral_reason: string | null;
  completed_at: string | null;
  completion_id: string | null;
  last_evaluated_at: string;
}

export interface ClientMaintenanceCompletion {
  id: string;
  vehicle_id: string;
  requirement_id: string;
  completed_at: string;
  odometer_value: number;
  odometer_unit: string;
  service_provider_name: string | null;
  performed_actions: string[];
  replaced_parts: Array<{ name: string; quantity: number; part_number?: string; unit_price?: number }>;
  cost_total: number | null;
  currency: string | null;
  notes: string | null;
  verification_status: string;
}

export interface ClientEnrichedMaintenanceCycle {
  cycle: ClientMaintenanceCycle;
  requirement: ClientMaintenanceRequirement;
  rule: ClientMaintenanceRule;
  plan_entry: ClientMaintenancePlanEntry;
  last_completion: ClientMaintenanceCompletion | null;
  distance_progress_percent: number | null;
  time_progress_percent: number | null;
  effective_urgency_score: number;
}

export interface ClientVehicleMaintenanceStatus {
  vehicle_id: string;
  current_odometer_km: number;
  summary_counts: {
    total: number;
    overdue: number;
    due: number;
    approaching: number;
    ok: number;
    deferred: number;
  };
  overall_status: 'OK' | 'APPROACHING' | 'DUE' | 'OVERDUE' | 'DEFERRED';
  cycles: ClientEnrichedMaintenanceCycle[];
  evaluated_at: string;
}

export interface ClientVehicleIssue {
  id: string;
  vehicle_id: string;
  title: string;
  summary: string;
  category: string;
  severity: 'NEGLIGIBLE' | 'LOW' | 'MODERATE' | 'SIGNIFICANT' | 'CRITICAL' | 'SAFETY_HAZARD';
  status: 'REPORTED' | 'UNDER_OBSERVATION' | 'DIAGNOSIS_PENDING' | 'DIAGNOSED' | 'REPAIR_PENDING' | 'REPAIR_IN_PROGRESS' | 'MONITORING' | 'RESOLVED' | 'RECURRED' | 'MERGED' | 'DISMISSED';
  persistence_state: 'SINGLE_OCCURRENCE' | 'REPEATED' | 'PERSISTENT' | 'INTERMITTENT' | 'RECURRENT_AFTER_RESOLUTION' | 'UNKNOWN';
  primary_component_category?: string | null;
  first_observed_at: string;
  first_observed_odometer_km?: number | null;
  last_observed_at: string;
  last_observed_odometer_km?: number | null;
  occurrence_count: number;
  intervention_count: number;
  is_safety_critical: boolean;
  safety_advisory_text?: string | null;
  requires_immediate_grounding: boolean;
  next_recommended_action?: string | null;
  current_resolution_id?: string | null;
  provenance_class: string;
  reported_by_actor_id: string;
  reported_by_actor_type: string;
  created_at: string;
  updated_at: string;
}

export interface ClientIssueOccurrence {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  occurrence_number: number;
  occurred_at: string;
  recorded_at: string;
  odometer_value?: number | null;
  odometer_unit?: string | null;
  odometer_km?: number | null;
  description: string;
  symptom_category: string;
  driving_condition?: string | null;
  speed_range?: string | null;
  engine_temperature_state?: string | null;
  weather_context?: string | null;
  road_condition?: string | null;
  provenance_class: string;
  recorded_by_actor_id: string;
  recorded_by_actor_type: string;
  created_at: string;
  updated_at: string;
}

export interface ClientIssueDiagnosis {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  provider_id?: string | null;
  provider_name: string;
  technician_id?: string | null;
  technician_name?: string | null;
  diagnosed_at: string;
  diagnosis_code?: string | null;
  diagnosis_summary: string;
  diagnosis_details: string;
  confirmed_component?: string | null;
  outcome: string;
  source_work_order_id?: string | null;
  provenance_class: string;
  recorded_by_actor_id: string;
  recorded_by_actor_type: string;
  created_at: string;
  updated_at: string;
}

export interface ClientIssueIntervention {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  diagnosis_id?: string | null;
  intervention_type: string;
  description: string;
  performed_at: string;
  odometer_value?: number | null;
  odometer_unit?: string | null;
  odometer_km?: number | null;
  provider_id?: string | null;
  provider_name?: string | null;
  work_order_id?: string | null;
  replaced_part_names: string[];
  cost_total?: number | null;
  currency?: string | null;
  result: string;
  notes?: string | null;
  scheduled_followup_at?: string | null;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
}

export interface ClientIssueFollowup {
  id: string;
  vehicle_issue_id: string;
  vehicle_id: string;
  intervention_id?: string | null;
  followup_type: string;
  status: 'SCHEDULED' | 'DUE' | 'RESPONDED' | 'DISMISSED' | 'EXPIRED';
  prompt_text: string;
  due_date: string;
  target_odometer_km?: number | null;
  reminder_sent_at?: string | null;
  response?: 'YES' | 'NO' | 'NOT_SURE' | null;
  response_recorded_at?: string | null;
  response_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientEnrichedVehicleIssue extends ClientVehicleIssue {
  occurrences: ClientIssueOccurrence[];
  diagnoses: ClientIssueDiagnosis[];
  interventions: ClientIssueIntervention[];
  followups: ClientIssueFollowup[];
  active_followups: ClientIssueFollowup[];
}

export interface ClientFuelEntry {
  id: string;
  vehicle_id: string;
  fueled_at: string;
  recorded_at: string;
  odometer_value: number | null;
  odometer_unit: string | null;
  odometer_km: number | null;
  fuel_type: string;
  quantity: number;
  quantity_unit: string;
  quantity_litres: number;
  total_cost: number;
  currency: string;
  price_per_unit: number;
  fill_type: 'FULL' | 'PARTIAL' | 'MISSED_RESET';
  tank_level_before: number | null;
  tank_level_after: number | null;
  station_name: string | null;
  location_reference: string | null;
  source_type: string;
  notes: string | null;
  is_corrected: boolean;
  created_at: string;
}

export interface ClientFuelInterval {
  id: string;
  vehicle_id: string;
  start_fuel_entry_id: string;
  end_fuel_entry_id: string;
  distance_km: number;
  fuel_consumed_litres: number;
  km_per_litre: number;
  litres_per_100_km: number;
  mpg_us: number;
  mpg_uk: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  partial_fills_included_count: number;
  calculated_at: string;
}

export interface ClientFuelSnapshot {
  id: string;
  vehicle_id: string;
  rolling_economy_km_l: number | null;
  baseline_economy_km_l: number | null;
  delta_percent: number | null;
  anomaly_detected: boolean;
  observation_text: string | null;
  data_quality: 'HIGH' | 'SUFFICIENT' | 'INSUFFICIENT';
  qualifying_intervals_count: number;
  total_distance_km: number;
  observed_at: string;
}

export interface ClientFuelSummary {
  vehicle_id: string;
  period: string;
  from?: string;
  to?: string;
  total_fuel_entries: number;
  total_spend_by_currency: Record<string, number>;
  total_litres_consumed: number;
  average_price_per_litre_by_currency: Record<string, number>;
  rolling_economy_km_l: number | null;
  rolling_economy_l_100km: number | null;
  rolling_economy_mpg_us: number | null;
  rolling_economy_mpg_uk: number | null;
  cost_per_km_by_currency: Record<string, number>;
  anomaly_detected: boolean;
  anomaly_message: string | null;
  latest_snapshot: ClientFuelSnapshot | null;
}

export interface ClientVehicleExpense {
  id: string;
  vehicle_id: string;
  expense_category: string;
  expense_subcategory: string | null;
  occurred_at: string;
  recorded_at: string;
  amount: number;
  currency: string;
  cost_type: 'ACTUAL' | 'ESTIMATED' | 'FORECAST';
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  description: string;
  source_type: string;
  source_reference_type: string | null;
  source_reference_id: string | null;
  merchant_provider_id: string | null;
  recurring_expense_id: string | null;
  odometer_km: number | null;
  receipt_document_id: string | null;
  notes: string | null;
  is_corrected: boolean;
  created_at: string;
}

export interface ClientRecurringExpense {
  id: string;
  vehicle_id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL' | 'CUSTOM';
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  last_generated_at: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  auto_create_expense: boolean;
  created_at: string;
}

export interface ClientTcoSummary {
  vehicle_id: string;
  period: string;
  from?: string;
  to?: string;
  total_by_currency: Record<string, number>;
  by_category: Record<string, Record<string, number>>;
  by_cost_type: Record<string, Record<string, number>>;
  operating_costs_by_currency: Record<string, number>;
  ownership_costs_by_currency: Record<string, number>;
  cost_per_km_by_currency: Record<string, number>;
  total_distance_km: number;
  primary_currency: string;
  category_breakdown: Array<{
    category: string;
    amount: number;
    currency: string;
    percentage: number;
  }>;
}



