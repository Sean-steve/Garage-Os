/**
 * Canonical Garage Operations Domain Types & Interfaces (GAR-012)
 *
 * Models the workshop execution lifecycle:
 * Vehicle Arrival -> Intake & Check-in -> Inspection & Diagnosis ->
 * Recommended Scope & Authorization -> Work Order Execution ->
 * Technician Time & Parts -> Quality Control & Road Test -> Handover Release.
 */

export enum ServiceCaseStatus {
  OPEN = 'OPEN',
  CHECKED_IN = 'CHECKED_IN',
  IN_INSPECTION = 'IN_INSPECTION',
  ESTIMATING = 'ESTIMATING',
  PENDING_AUTHORIZATION = 'PENDING_AUTHORIZATION',
  AUTHORIZED = 'AUTHORIZED',
  IN_PROGRESS = 'IN_PROGRESS',
  QUALITY_CONTROL = 'QUALITY_CONTROL',
  READY_FOR_RELEASE = 'READY_FOR_RELEASE',
  RELEASED = 'RELEASED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ServiceCaseSourceType {
  APPOINTMENT_BOOKING = 'APPOINTMENT_BOOKING',
  WALK_IN = 'WALK_IN',
  TOW_IN_DROP_OFF = 'TOW_IN_DROP_OFF',
  FLEET_SCHEDULED = 'FLEET_SCHEDULED',
  REPEAT_SERVICE_REWORK = 'REPEAT_SERVICE_REWORK',
  ROADSIDE_TRANSFER = 'ROADSIDE_TRANSFER',
}

export enum CustomerConcernPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum InspectionType {
  INTAKE = 'INTAKE',
  DIAGNOSTIC = 'DIAGNOSTIC',
  PRE_PURCHASE = 'PRE_PURCHASE',
  SAFETY = 'SAFETY',
  MAINTENANCE = 'MAINTENANCE',
  QUALITY_CONTROL = 'QUALITY_CONTROL',
  CUSTOM = 'CUSTOM',
}

export enum InspectionStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum InspectionItemResultValue {
  PASS = 'PASS',
  ATTENTION_REQUIRED = 'ATTENTION_REQUIRED',
  FAIL_SAFETY_RISK = 'FAIL_SAFETY_RISK',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  UNABLE_TO_INSPECT = 'UNABLE_TO_INSPECT',
}

export enum FindingSeverity {
  INFORMATIONAL = 'INFORMATIONAL',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  SAFETY_CRITICAL = 'SAFETY_CRITICAL',
}

export enum RecommendedWorkPriority {
  CRITICAL_SAFETY = 'CRITICAL_SAFETY',
  RECOMMENDED_NOW = 'RECOMMENDED_NOW',
  MONITOR_NEXT_SERVICE = 'MONITOR_NEXT_SERVICE',
  COSMETIC_OPTIONAL = 'COSMETIC_OPTIONAL',
}

export enum RecommendedWorkStatus {
  PROPOSED = 'PROPOSED',
  AUTHORIZED = 'AUTHORIZED',
  DECLINED = 'DECLINED',
  DEFERRED = 'DEFERRED',
}

export enum ServiceAuthorizationType {
  INITIAL = 'INITIAL',
  SUPPLEMENTAL = 'SUPPLEMENTAL',
  REWORK = 'REWORK',
}

export enum AuthorizationChannel {
  IN_PERSON = 'IN_PERSON',
  PHONE_CONFIRMED = 'PHONE_CONFIRMED',
  DIGITAL_APPROVAL = 'DIGITAL_APPROVAL',
  WHATSAPP_CONFIRMED = 'WHATSAPP_CONFIRMED',
  FLEET_PORTAL = 'FLEET_PORTAL',
}

export enum WorkOrderStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD = 'ON_HOLD',
  WORK_COMPLETED = 'WORK_COMPLETED',
  QC_PENDING = 'QC_PENDING',
  QC_PASSED = 'QC_PASSED',
  QC_REWORK_REQUIRED = 'QC_REWORK_REQUIRED',
  READY_FOR_RELEASE = 'READY_FOR_RELEASE',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum WorkOrderItemStatus {
  NOT_STARTED = 'NOT_STARTED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum WorkType {
  MAINTENANCE = 'MAINTENANCE',
  REPAIR = 'REPAIR',
  DIAGNOSTIC = 'DIAGNOSTIC',
  INSPECTION = 'INSPECTION',
  COMPONENT_REPLACEMENT = 'COMPONENT_REPLACEMENT',
  TYRE_SERVICE = 'TYRE_SERVICE',
  REWORK = 'REWORK',
}

export enum TechnicianAssignmentRole {
  PRIMARY = 'PRIMARY',
  ASSISTANT = 'ASSISTANT',
  SPECIALIST = 'SPECIALIST',
  SUPERVISOR = 'SUPERVISOR',
}

export enum LaborSessionType {
  ACTUAL = 'ACTUAL',
  DIAGNOSTIC = 'DIAGNOSTIC',
  TEST_DRIVE = 'TEST_DRIVE',
  REWORK = 'REWORK',
}

export enum WorkOrderPartStatus {
  REQUIRED = 'REQUIRED',
  RESERVED = 'RESERVED',
  ORDERED = 'ORDERED',
  RECEIVED = 'RECEIVED',
  INSTALLED = 'INSTALLED',
  RETURNED = 'RETURNED',
}

export enum WorkOrderPartSource {
  WORKSHOP_INVENTORY = 'WORKSHOP_INVENTORY',
  CUSTOMER_PROVIDED = 'CUSTOMER_PROVIDED',
  EXTERNAL_SUPPLIER = 'EXTERNAL_SUPPLIER',
  OEM_DIRECT = 'OEM_DIRECT',
}

export enum QualityControlResult {
  PASSED = 'PASSED',
  PASSED_WITH_CONDITIONS = 'PASSED_WITH_CONDITIONS',
  REWORK_REQUIRED = 'REWORK_REQUIRED',
  FAILED = 'FAILED',
}

export enum RoadTestResult {
  NOT_REQUIRED = 'NOT_REQUIRED',
  PASSED = 'PASSED',
  ISSUES_OBSERVED = 'ISSUES_OBSERVED',
}

export enum ServiceCaseNoteVisibility {
  INTERNAL_PROVIDER_NOTE = 'INTERNAL_PROVIDER_NOTE',
  CUSTOMER_VISIBLE = 'CUSTOMER_VISIBLE',
  TECHNICIAN_MEMO = 'TECHNICIAN_MEMO',
}

// ---------------- Entities ----------------

export interface ServiceCaseEntity {
  id: string;
  service_case_number: string;
  provider_id: string;
  branch_id: string;
  vehicle_id: string;
  customer_user_id: string | null;
  customer_contact_name: string | null;
  customer_contact_phone: string | null;
  customer_contact_email: string | null;
  source_type: ServiceCaseSourceType;
  source_reference_id: string | null;
  service_advisor_id: string | null;
  status: ServiceCaseStatus;
  intake_odometer_km: number | null;
  final_odometer_km: number | null;
  opened_at: string;
  checked_in_at: string | null;
  completed_at: string | null;
  released_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  prior_service_case_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerConcernEntity {
  id: string;
  service_case_id: string;
  vehicle_id: string;
  concern_type: string;
  description: string;
  related_issue_id: string | null;
  related_maintenance_requirement_id: string | null;
  reported_by: string;
  reported_at: string;
  priority: CustomerConcernPriority;
  created_at: string;
}

export interface VehicleCheckInEntity {
  id: string;
  service_case_id: string;
  vehicle_id: string;
  checked_in_at: string;
  odometer_value: number;
  odometer_unit: string;
  odometer_observation_id: string | null;
  fuel_level: string | null;
  vehicle_condition_summary: string | null;
  keys_received_count: number;
  documents_received: string | null;
  created_by: string;
  created_at: string;
}

export interface VehicleIntakeObservationEntity {
  id: string;
  vehicle_check_in_id: string;
  service_case_id: string;
  category: string;
  position: string | null;
  description: string;
  severity: string;
  media_reference_ids: string | null;
  created_by: string;
  created_at: string;
}

export interface VehicleIntakeItemEntity {
  id: string;
  vehicle_check_in_id: string;
  service_case_id: string;
  item_name: string;
  item_type: string;
  quantity: number;
  condition_notes: string | null;
  created_at: string;
}

export interface InspectionTemplateEntity {
  id: string;
  name: string;
  vehicle_class: string;
  inspection_type: InspectionType;
  version: number;
  status: string;
  created_at: string;
}

export interface InspectionTemplateItemEntity {
  id: string;
  template_id: string;
  category: string;
  item_name: string;
  description: string | null;
  requires_measurement: number; // 0 or 1
  measurement_unit: string | null;
  display_order: number;
}

export interface VehicleInspectionEntity {
  id: string;
  service_case_id: string;
  vehicle_id: string;
  inspection_type: InspectionType;
  template_id: string | null;
  status: InspectionStatus;
  performed_by_technician_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionItemResultEntity {
  id: string;
  inspection_id: string;
  item_name: string;
  category: string;
  result: InspectionItemResultValue;
  measured_value: number | null;
  measurement_unit: string | null;
  notes: string | null;
  media_reference_ids: string | null;
  created_at: string;
}

export interface InspectionFindingEntity {
  id: string;
  inspection_id: string;
  service_case_id: string;
  vehicle_id: string;
  category: string;
  component_definition_id: string | null;
  vehicle_component_id: string | null;
  finding_type: string;
  severity: FindingSeverity;
  description: string;
  recommended_action: string | null;
  evidence_references: string | null;
  related_issue_id: string | null;
  created_by: string;
  created_at: string;
}

export interface RecommendedWorkItemEntity {
  id: string;
  service_case_id: string;
  related_finding_id: string | null;
  related_issue_id: string | null;
  maintenance_task_id: string | null;
  service_category: string;
  description: string;
  priority: RecommendedWorkPriority;
  estimated_labor_hours: number;
  estimated_labor_cost: number;
  estimated_parts_cost: number;
  currency: string;
  status: RecommendedWorkStatus;
  declined_reason: string | null;
  declined_at: string | null;
  declined_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceAuthorizationEntity {
  id: string;
  service_case_id: string;
  authorization_type: ServiceAuthorizationType;
  scope_version: number;
  amount_authorized: number;
  currency: string;
  authorized_by: string;
  authorized_at: string;
  authorization_channel: AuthorizationChannel;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface ServiceAuthorizationItemEntity {
  id: string;
  authorization_id: string;
  recommended_work_item_id: string;
  created_at: string;
}

export interface WorkOrderEntity {
  id: string;
  service_case_id: string;
  provider_id: string;
  branch_id: string;
  vehicle_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  opened_at: string;
  started_at: string | null;
  completed_at: string | null;
  assigned_service_advisor_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderItemEntity {
  id: string;
  work_order_id: string;
  work_type: WorkType;
  service_category: string;
  description: string;
  related_recommended_work_item_id: string | null;
  related_issue_id: string | null;
  related_maintenance_task_id: string | null;
  related_finding_id: string | null;
  status: WorkOrderItemStatus;
  authorization_status: string;
  assigned_technician_id: string | null;
  estimated_hours: number;
  actual_hours: number;
  billable_hours: number;
  hourly_rate: number;
  started_at: string | null;
  completed_at: string | null;
  block_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TechnicianAssignmentEntity {
  id: string;
  work_order_id: string;
  work_order_item_id: string | null;
  technician_id: string;
  provider_membership_id: string | null;
  role: TechnicianAssignmentRole;
  assigned_at: string;
  assigned_by: string;
  status: string;
}

export interface TechnicianWorkSessionEntity {
  id: string;
  work_order_item_id: string;
  technician_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  labor_type: LaborSessionType;
  notes: string | null;
  status: string;
}

export interface WorkOrderPartEntity {
  id: string;
  work_order_item_id: string;
  work_order_id: string;
  part_number: string | null;
  description: string;
  quantity: number;
  source: WorkOrderPartSource;
  unit_cost: number;
  unit_price: number;
  currency: string;
  status: WorkOrderPartStatus;
  vehicle_component_id: string | null;
  replaced_component_id: string | null;
  installed_at: string | null;
  installed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderHoldEntity {
  id: string;
  work_order_id: string;
  reason: string;
  description: string;
  placed_at: string;
  placed_by: string;
  released_at: string | null;
  released_by: string | null;
}

export interface QualityControlCheckEntity {
  id: string;
  work_order_id: string;
  inspection_id: string | null;
  performed_by: string;
  performed_at: string;
  result: QualityControlResult;
  checklist_results: string | null; // JSON
  notes: string | null;
  rework_instructions: string | null;
  created_at: string;
}

export interface RoadTestEntity {
  id: string;
  work_order_id: string;
  performed_by: string;
  started_at: string;
  ended_at: string | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  result: RoadTestResult;
  notes: string | null;
  created_at: string;
}

export interface VehicleReleaseEntity {
  id: string;
  service_case_id: string;
  work_order_id: string;
  released_at: string;
  released_by: string;
  recipient_user_id: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  final_odometer_km: number | null;
  final_odometer_observation_id: string | null;
  handover_notes: string | null;
  acknowledgement_status: string;
  created_at: string;
}

export interface ServiceCaseNoteEntity {
  id: string;
  service_case_id: string;
  author_id: string;
  author_name: string;
  visibility: ServiceCaseNoteVisibility;
  content: string;
  created_at: string;
}

export interface ServiceCaseActivityEntity {
  id: string;
  service_case_id: string;
  work_order_id: string | null;
  action: string;
  actor_id: string;
  actor_name: string | null;
  details: string | null;
  occurred_at: string;
}

// ---------------- Aggregates & Detail Views ----------------

export interface ServiceCaseAggregate {
  case: ServiceCaseEntity;
  vehicle_summary?: {
    make: string;
    model: string;
    year: number;
    license_plate: string;
    vin?: string;
  };
  provider_summary?: {
    name: string;
    branch_name?: string;
  };
  concerns: CustomerConcernEntity[];
  check_in?: VehicleCheckInEntity & {
    observations: VehicleIntakeObservationEntity[];
    intake_items: VehicleIntakeItemEntity[];
  };
  inspections: Array<
    VehicleInspectionEntity & {
      results: InspectionItemResultEntity[];
      findings: InspectionFindingEntity[];
    }
  >;
  recommended_work: RecommendedWorkItemEntity[];
  authorizations: Array<
    ServiceAuthorizationEntity & {
      item_ids: string[];
    }
  >;
  work_order?: WorkOrderAggregate;
  release?: VehicleReleaseEntity;
  notes: ServiceCaseNoteEntity[];
  activities: ServiceCaseActivityEntity[];
}

export interface WorkOrderAggregate {
  order: WorkOrderEntity;
  items: Array<
    WorkOrderItemEntity & {
      technician_assignments: TechnicianAssignmentEntity[];
      work_sessions: TechnicianWorkSessionEntity[];
      parts: WorkOrderPartEntity[];
    }
  >;
  holds: WorkOrderHoldEntity[];
  qc_checks: QualityControlCheckEntity[];
  road_tests: RoadTestEntity[];
}

// ---------------- Request / DTO Types ----------------

export interface CreateServiceCaseDto {
  provider_id: string;
  branch_id: string;
  vehicle_id: string;
  customer_user_id?: string;
  customer_contact_name?: string;
  customer_contact_phone?: string;
  customer_contact_email?: string;
  source_type: ServiceCaseSourceType;
  source_reference_id?: string;
  service_advisor_id?: string;
  initial_concerns?: Array<{
    concern_type: string;
    description: string;
    priority?: CustomerConcernPriority;
    related_issue_id?: string;
    related_maintenance_requirement_id?: string;
  }>;
  prior_service_case_id?: string;
}

export interface PerformCheckInDto {
  service_case_id: string;
  odometer_value: number;
  odometer_unit?: string;
  fuel_level?: string;
  vehicle_condition_summary?: string;
  keys_received_count?: number;
  documents_received?: string;
  observations?: Array<{
    category: string;
    position?: string;
    description: string;
    severity?: string;
    media_reference_ids?: string;
  }>;
  intake_items?: Array<{
    item_name: string;
    item_type: string;
    quantity: number;
    condition_notes?: string;
  }>;
}

export interface CreateInspectionDto {
  service_case_id: string;
  inspection_type: InspectionType;
  template_id?: string;
  performed_by_technician_id?: string;
  notes?: string;
}

export interface RecordInspectionResultsDto {
  inspection_id: string;
  results: Array<{
    item_name: string;
    category: string;
    result: InspectionItemResultValue;
    measured_value?: number;
    measurement_unit?: string;
    notes?: string;
    media_reference_ids?: string;
  }>;
  findings?: Array<{
    category: string;
    component_definition_id?: string;
    vehicle_component_id?: string;
    finding_type: string;
    severity: FindingSeverity;
    description: string;
    recommended_action?: string;
    evidence_references?: string;
    related_issue_id?: string;
  }>;
  complete_inspection?: boolean;
  notes?: string;
}

export interface RecommendWorkItemDto {
  service_case_id: string;
  related_finding_id?: string;
  related_issue_id?: string;
  maintenance_task_id?: string;
  service_category: string;
  description: string;
  priority: RecommendedWorkPriority;
  estimated_labor_hours: number;
  estimated_labor_cost: number;
  estimated_parts_cost: number;
  currency?: string;
}

export interface AuthorizeServiceDto {
  service_case_id: string;
  authorization_type?: ServiceAuthorizationType;
  recommended_work_item_ids: string[];
  amount_authorized: number;
  currency?: string;
  authorized_by: string;
  authorization_channel: AuthorizationChannel;
  notes?: string;
  declined_items?: Array<{
    recommended_work_item_id: string;
    reason: string;
  }>;
}

export interface CreateWorkOrderDto {
  service_case_id: string;
  assigned_service_advisor_id?: string;
}

export interface AssignTechnicianDto {
  work_order_id: string;
  work_order_item_id?: string;
  technician_id: string;
  role?: TechnicianAssignmentRole;
}

export interface StartLaborSessionDto {
  work_order_item_id: string;
  technician_id: string;
  labor_type?: LaborSessionType;
  notes?: string;
}

export interface EndLaborSessionDto {
  session_id: string;
  notes?: string;
}

export interface AddWorkOrderPartDto {
  work_order_id: string;
  work_order_item_id: string;
  part_number?: string;
  description: string;
  quantity: number;
  source?: WorkOrderPartSource;
  unit_cost?: number;
  unit_price?: number;
  currency?: string;
  vehicle_component_id?: string;
  replaced_component_id?: string;
}

export interface PerformQcCheckDto {
  work_order_id: string;
  inspection_id?: string;
  result: QualityControlResult;
  checklist_results?: Record<string, boolean | string>;
  notes?: string;
  rework_instructions?: string;
}

export interface PerformRoadTestDto {
  work_order_id: string;
  started_at: string;
  ended_at: string;
  start_odometer_km?: number;
  end_odometer_km?: number;
  result: RoadTestResult;
  notes?: string;
}

export interface ReleaseVehicleDto {
  service_case_id: string;
  recipient_name: string;
  recipient_user_id?: string;
  recipient_phone?: string;
  final_odometer_km: number;
  handover_notes?: string;
  acknowledgement_status?: string;
}
