/**
 * Canonical Garage Operations Management Service (GAR-012)
 *
 * Enforces workshop execution workflows, status transitions, role checks,
 * odometer evidence integrity, QC gate validation, and timeline event emissions.
 */

import { operationsRepository } from './operationsRepository';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { eventBus } from '../events/eventBus';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { AuthenticatedActorContext } from '../identity/types';
import { VehicleIdentifierType } from '../vehicle/types';
import {
  ServiceCaseStatus,
  CustomerConcernPriority,
  InspectionType,
  InspectionStatus,
  FindingSeverity,
  RecommendedWorkPriority,
  RecommendedWorkStatus,
  ServiceAuthorizationType,
  AuthorizationChannel,
  WorkOrderStatus,
  WorkOrderItemStatus,
  WorkType,
  TechnicianAssignmentRole,
  LaborSessionType,
  WorkOrderPartStatus,
  WorkOrderPartSource,
  QualityControlResult,
  RoadTestResult,
  ServiceCaseNoteVisibility,
  ServiceCaseEntity,
  CustomerConcernEntity,
  VehicleCheckInEntity,
  VehicleIntakeObservationEntity,
  VehicleIntakeItemEntity,
  VehicleInspectionEntity,
  InspectionTemplateEntity,
  InspectionItemResultEntity,
  InspectionFindingEntity,
  RecommendedWorkItemEntity,
  ServiceAuthorizationEntity,
  WorkOrderEntity,
  WorkOrderItemEntity,
  TechnicianAssignmentEntity,
  TechnicianWorkSessionEntity,
  WorkOrderPartEntity,
  WorkOrderHoldEntity,
  QualityControlCheckEntity,
  RoadTestEntity,
  VehicleReleaseEntity,
  ServiceCaseNoteEntity,
  ServiceCaseAggregate,
  WorkOrderAggregate,
  CreateServiceCaseDto,
  PerformCheckInDto,
  CreateInspectionDto,
  RecordInspectionResultsDto,
  RecommendWorkItemDto,
  AuthorizeServiceDto,
  CreateWorkOrderDto,
  AssignTechnicianDto,
  StartLaborSessionDto,
  EndLaborSessionDto,
  AddWorkOrderPartDto,
  PerformQcCheckDto,
  PerformRoadTestDto,
  ReleaseVehicleDto,
} from './types';
import {
  OdometerUnit,
  OdometerObservationStatus,
  OdometerObservationEntity,
} from '../vehicle/types';

export interface OperationsActorContext {
  actor_id: string;
  user_id?: string;
  id?: string;
  [key: string]: any;
}

export class GarageOperationsService {
  /**
   * Generates a sequential, human-scannable number: SC-YYYYMM-XXXX
   */
  private generateServiceCaseNumber(): string {
    const d = new Date();
    const yearMonth = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `SC-${yearMonth}-${rand}`;
  }

  /**
   * Generates a sequential, human-scannable number: WO-YYYYMM-XXXX
   */
  private generateWorkOrderNumber(): string {
    const d = new Date();
    const yearMonth = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `WO-${yearMonth}-${rand}`;
  }

  // =========================================================================
  // 1. Service Case Management
  // =========================================================================

  createServiceCase(actor: OperationsActorContext, dto: CreateServiceCaseDto): ServiceCaseAggregate {
    if (!dto.provider_id || !dto.vehicle_id) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Provider ID and Vehicle ID are required to open a Service Case',
        400
      );
    }

    // Verify vehicle exists
    const vehicle = vehicleRepository.getVehicleById(dto.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Vehicle not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const caseId = generateCanonicalId('sc');
    const caseNumber = this.generateServiceCaseNumber();

    const serviceCase: ServiceCaseEntity = {
      id: caseId,
      service_case_number: caseNumber,
      provider_id: dto.provider_id,
      branch_id: dto.branch_id || 'branch_default',
      vehicle_id: dto.vehicle_id,
      customer_user_id: dto.customer_user_id || null,
      customer_contact_name: dto.customer_contact_name || null,
      customer_contact_phone: dto.customer_contact_phone || null,
      customer_contact_email: dto.customer_contact_email || null,
      source_type: dto.source_type,
      source_reference_id: dto.source_reference_id || null,
      service_advisor_id: dto.service_advisor_id || actor.actor_id,
      status: ServiceCaseStatus.OPEN,
      intake_odometer_km: null,
      final_odometer_km: null,
      opened_at: now,
      checked_in_at: null,
      completed_at: null,
      released_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      prior_service_case_id: dto.prior_service_case_id || null,
      created_by: actor.actor_id,
      created_at: now,
      updated_at: now,
    };

    operationsRepository.createServiceCase(serviceCase);

    // Initial concerns
    if (dto.initial_concerns && dto.initial_concerns.length > 0) {
      for (const c of dto.initial_concerns) {
        const concernId = generateCanonicalId('cc');
        operationsRepository.createCustomerConcern({
          id: concernId,
          service_case_id: caseId,
          vehicle_id: dto.vehicle_id,
          concern_type: c.concern_type || 'GENERAL',
          description: c.description,
          related_issue_id: c.related_issue_id || null,
          related_maintenance_requirement_id: c.related_maintenance_requirement_id || null,
          reported_by: dto.customer_contact_name || actor.actor_id,
          reported_at: now,
          priority: c.priority || CustomerConcernPriority.MEDIUM,
          created_at: now,
        });
      }
    }

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: caseId,
      work_order_id: null,
      action: 'SERVICE_CASE_OPENED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Service case ${caseNumber} opened for vehicle ${vehicle.display_name}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.created',
        correlation_id: caseId,
        subject_ids: { vehicle: dto.vehicle_id, provider: dto.provider_id, service_case: caseId },
        actor_id: actor.actor_id,
        payload: { service_case: serviceCase },
      })
    );

    return this.getServiceCaseAggregate(caseId)!;
  }

  getServiceCaseAggregate(serviceCaseId: string): ServiceCaseAggregate | null {
    const sc = operationsRepository.getServiceCaseById(serviceCaseId);
    if (!sc) return null;

    const vehicle = vehicleRepository.getVehicleById(sc.vehicle_id);
    const concerns = operationsRepository.listCustomerConcerns(serviceCaseId);
    const checkInRow = operationsRepository.getVehicleCheckIn(serviceCaseId);

    let checkIn: (VehicleCheckInEntity & { observations: VehicleIntakeObservationEntity[]; intake_items: VehicleIntakeItemEntity[] }) | undefined = undefined;
    if (checkInRow) {
      const observations = operationsRepository.listIntakeObservations(checkInRow.id);
      const intake_items = operationsRepository.listIntakeItems(checkInRow.id);
      checkIn = { ...checkInRow, observations, intake_items };
    }

    const inspectionsRaw = operationsRepository.listInspectionsForCase(serviceCaseId);
    const inspections = inspectionsRaw.map((insp) => ({
      ...insp,
      results: operationsRepository.listInspectionItemResults(insp.id),
      findings: operationsRepository.listInspectionFindings(insp.id),
    }));

    const recommended_work = operationsRepository.listRecommendedWorkItems(serviceCaseId);
    const authorizations = operationsRepository.listServiceAuthorizations(serviceCaseId);

    const woRow = operationsRepository.getWorkOrderByCaseId(serviceCaseId);
    let work_order: WorkOrderAggregate | undefined = undefined;
    if (woRow) {
      work_order = this.getWorkOrderAggregate(woRow.id)!;
    }

    const release = operationsRepository.getVehicleRelease(serviceCaseId) || undefined;
    const notes = operationsRepository.listNotes(serviceCaseId);
    const activities = operationsRepository.listActivity(serviceCaseId);

    const identifiers = vehicle ? vehicleRepository.getVehicleIdentifiers(sc.vehicle_id) : [];
    const regId = identifiers.find((i) => i.type === VehicleIdentifierType.REGISTRATION_NUMBER)?.value;
    const vinId = identifiers.find((i) => i.type === VehicleIdentifierType.VIN)?.value;

    return {
      case: sc,
      vehicle_summary: vehicle
        ? {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.model_year,
            license_plate: regId || vehicle.display_name,
            vin: vinId || null,
          }
        : undefined,
      concerns,
      check_in: checkIn,
      inspections,
      recommended_work,
      authorizations,
      work_order,
      release,
      notes,
      activities,
    };
  }

  listServiceCases(filter: {
    provider_id?: string;
    branch_id?: string;
    vehicle_id?: string;
    status?: string;
  }): ServiceCaseEntity[] {
    return operationsRepository.listServiceCases(filter);
  }

  // =========================================================================
  // 2. Vehicle Intake & Check-in
  // =========================================================================

  performCheckIn(actor: OperationsActorContext, dto: PerformCheckInDto): ServiceCaseAggregate {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    if (sc.status !== ServiceCaseStatus.OPEN) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot check in a service case that is in status ${sc.status}. Must be in OPEN status.`,
        400
      );
    }

    if (dto.odometer_value === undefined || dto.odometer_value === null || dto.odometer_value < 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'A non-negative odometer value is required for vehicle check-in',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const checkInId = generateCanonicalId('chk');

    // 1. Record verified workshop odometer observation into vehicle registry
    const odoId = generateCanonicalId('odo');
    const odoObservation: OdometerObservationEntity = {
      id: odoId,
      vehicle_id: sc.vehicle_id,
      reading_value: dto.odometer_value,
      unit: (dto.odometer_unit as OdometerUnit) || OdometerUnit.KM,
      reading_km: dto.odometer_value,
      observed_at: now,
      recorded_at: now,
      source_class: 'SERVICE_REPAIR',
      source_ref: sc.id,
      actor_id: actor.actor_id,
      provider_id: sc.provider_id,
      status: OdometerObservationStatus.VALID,
      flag_reason: null,
      superseded_by_id: null,
      correction_reason: null,
      notes: `Intake check-in for service case ${sc.service_case_number}`,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.createOdometerObservation(odoObservation);

    // 2. Prepare intake observations & inventory items
    const observations: VehicleIntakeObservationEntity[] = (dto.observations || []).map((o) => ({
      id: generateCanonicalId('vio'),
      vehicle_check_in_id: checkInId,
      service_case_id: sc.id,
      category: o.category,
      position: o.position || null,
      description: o.description,
      severity: o.severity || 'MINOR',
      media_reference_ids: o.media_reference_ids || null,
      created_by: actor.actor_id,
      created_at: now,
    }));

    const items: VehicleIntakeItemEntity[] = (dto.intake_items || []).map((it) => ({
      id: generateCanonicalId('vii'),
      vehicle_check_in_id: checkInId,
      service_case_id: sc.id,
      item_name: it.item_name,
      item_type: it.item_type,
      quantity: it.quantity || 1,
      condition_notes: it.condition_notes || null,
      created_at: now,
    }));

    const checkIn: VehicleCheckInEntity = {
      id: checkInId,
      service_case_id: sc.id,
      vehicle_id: sc.vehicle_id,
      checked_in_at: now,
      odometer_value: dto.odometer_value,
      odometer_unit: dto.odometer_unit || 'KM',
      odometer_observation_id: odoId,
      fuel_level: dto.fuel_level || null,
      vehicle_condition_summary: dto.vehicle_condition_summary || null,
      keys_received_count: dto.keys_received_count !== undefined ? dto.keys_received_count : 1,
      documents_received: dto.documents_received || null,
      created_by: actor.actor_id,
      created_at: now,
    };

    operationsRepository.createVehicleCheckIn(checkIn, observations, items);

    // Update service case status to CHECKED_IN
    operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.CHECKED_IN, {
      checked_in_at: now,
      intake_odometer_km: dto.odometer_value,
    });

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: null,
      action: 'VEHICLE_CHECKED_IN',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Vehicle checked in at ${dto.odometer_value} ${dto.odometer_unit || 'KM'} with ${observations.length} observations recorded.`,
      occurred_at: now,
    });

    // Emit event for odometer and checkin
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'odometer.recorded',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
        actor_id: actor.actor_id,
        payload: { observation: odoObservation },
      })
    );

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.checked_in',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
        actor_id: actor.actor_id,
        payload: { check_in: checkIn, observations_count: observations.length },
      })
    );

    return this.getServiceCaseAggregate(sc.id)!;
  }

  addCustomerConcern(
    actor: OperationsActorContext,
    serviceCaseId: string,
    concern: {
      concern_type: string;
      description: string;
      priority?: CustomerConcernPriority;
      related_issue_id?: string;
      related_maintenance_requirement_id?: string;
    }
  ): CustomerConcernEntity {
    const sc = operationsRepository.getServiceCaseById(serviceCaseId);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const entity: CustomerConcernEntity = {
      id: generateCanonicalId('cc'),
      service_case_id: sc.id,
      vehicle_id: sc.vehicle_id,
      concern_type: concern.concern_type || 'GENERAL',
      description: concern.description,
      related_issue_id: concern.related_issue_id || null,
      related_maintenance_requirement_id: concern.related_maintenance_requirement_id || null,
      reported_by: actor.actor_id,
      reported_at: now,
      priority: concern.priority || CustomerConcernPriority.MEDIUM,
      created_at: now,
    };

    operationsRepository.createCustomerConcern(entity);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: null,
      action: 'CONCERN_RECORDED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Customer concern added: ${concern.description}`,
      occurred_at: now,
    });

    return entity;
  }

  // =========================================================================
  // 3. Inspections & Diagnostics
  // =========================================================================

  listInspectionTemplates(): InspectionTemplateEntity[] {
    return operationsRepository.listInspectionTemplates();
  }

  getInspectionTemplate(templateId: string) {
    const tpl = operationsRepository.getInspectionTemplateWithItems(templateId);
    if (!tpl) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Template not found', 404);
    }
    return tpl;
  }

  startInspection(actor: OperationsActorContext, dto: CreateInspectionDto): VehicleInspectionEntity {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    if (sc.status === ServiceCaseStatus.CLOSED || sc.status === ServiceCaseStatus.CANCELLED) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot inspect vehicle in ${sc.status} service case`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const inspectionId = generateCanonicalId('insp');

    const entity: VehicleInspectionEntity = {
      id: inspectionId,
      service_case_id: sc.id,
      vehicle_id: sc.vehicle_id,
      inspection_type: dto.inspection_type || InspectionType.INTAKE,
      template_id: dto.template_id || null,
      status: InspectionStatus.IN_PROGRESS,
      performed_by_technician_id: dto.performed_by_technician_id || actor.actor_id,
      started_at: now,
      completed_at: null,
      notes: dto.notes || null,
      created_at: now,
      updated_at: now,
    };

    operationsRepository.createVehicleInspection(entity);

    // If service case was CHECKED_IN or OPEN, move to IN_INSPECTION
    if (sc.status === ServiceCaseStatus.OPEN || sc.status === ServiceCaseStatus.CHECKED_IN) {
      operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.IN_INSPECTION);
    }

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: null,
      action: 'INSPECTION_STARTED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Started ${dto.inspection_type} inspection`,
      occurred_at: now,
    });

    return entity;
  }

  recordInspectionResults(actor: OperationsActorContext, dto: RecordInspectionResultsDto): VehicleInspectionEntity {
    const inspection = operationsRepository.getVehicleInspection(dto.inspection_id);
    if (!inspection) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Inspection not found', 404);
    }

    const sc = operationsRepository.getServiceCaseById(inspection.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const now = getCurrentUtcIsoString();

    const results: InspectionItemResultEntity[] = (dto.results || []).map((r) => ({
      id: generateCanonicalId('iir'),
      inspection_id: inspection.id,
      item_name: r.item_name,
      category: r.category,
      result: r.result,
      measured_value: r.measured_value !== undefined ? r.measured_value : null,
      measurement_unit: r.measurement_unit || null,
      notes: r.notes || null,
      media_reference_ids: r.media_reference_ids || null,
      created_at: now,
    }));

    const findings: InspectionFindingEntity[] = (dto.findings || []).map((f) => ({
      id: generateCanonicalId('find'),
      inspection_id: inspection.id,
      service_case_id: sc.id,
      vehicle_id: sc.vehicle_id,
      category: f.category,
      component_definition_id: f.component_definition_id || null,
      vehicle_component_id: f.vehicle_component_id || null,
      finding_type: f.finding_type || 'MECHANICAL_WEAR',
      severity: f.severity || FindingSeverity.MEDIUM,
      description: f.description,
      recommended_action: f.recommended_action || null,
      evidence_references: f.evidence_references || null,
      related_issue_id: f.related_issue_id || null,
      created_by: actor.actor_id,
      created_at: now,
    }));

    operationsRepository.recordInspectionResults(inspection.id, results, findings);

    // Automatically generate recommended work items from findings that have recommended actions
    for (const finding of findings) {
      if (finding.recommended_action) {
        const priority =
          finding.severity === FindingSeverity.SAFETY_CRITICAL
            ? RecommendedWorkPriority.CRITICAL_SAFETY
            : finding.severity === FindingSeverity.HIGH
            ? RecommendedWorkPriority.RECOMMENDED_NOW
            : RecommendedWorkPriority.MONITOR_NEXT_SERVICE;

        operationsRepository.createRecommendedWorkItem({
          id: generateCanonicalId('rec'),
          service_case_id: sc.id,
          related_finding_id: finding.id,
          related_issue_id: finding.related_issue_id,
          maintenance_task_id: null,
          service_category: finding.category,
          description: finding.recommended_action,
          priority,
          estimated_labor_hours: 1.0,
          estimated_labor_cost: 2500,
          estimated_parts_cost: 0,
          currency: 'KES',
          status: RecommendedWorkStatus.PROPOSED,
          declined_reason: null,
          declined_at: null,
          declined_by: null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (dto.complete_inspection) {
      operationsRepository.updateVehicleInspection(inspection.id, {
        status: InspectionStatus.COMPLETED,
        completed_at: now,
      });

      // Advance service case to ESTIMATING or PENDING_AUTHORIZATION
      if (sc.status === ServiceCaseStatus.IN_INSPECTION) {
        operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.ESTIMATING);
      }

      operationsRepository.logActivity({
        id: generateCanonicalId('act'),
        service_case_id: sc.id,
        work_order_id: null,
        action: 'INSPECTION_COMPLETED',
        actor_id: actor.actor_id,
        actor_name: actor.actor_id,
        details: `Inspection completed with ${results.length} item checks and ${findings.length} findings recorded.`,
        occurred_at: now,
      });

      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'service_case.inspection_completed',
          correlation_id: sc.id,
          subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
          actor_id: actor.actor_id,
          payload: { inspection_id: inspection.id, findings_count: findings.length },
        })
      );
    }

    return operationsRepository.getVehicleInspection(inspection.id)!;
  }

  // =========================================================================
  // 4. Recommended Work & Authorization
  // =========================================================================

  recommendWorkItem(actor: OperationsActorContext, dto: RecommendWorkItemDto): RecommendedWorkItemEntity {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const entity: RecommendedWorkItemEntity = {
      id: generateCanonicalId('rec'),
      service_case_id: sc.id,
      related_finding_id: dto.related_finding_id || null,
      related_issue_id: dto.related_issue_id || null,
      maintenance_task_id: dto.maintenance_task_id || null,
      service_category: dto.service_category || 'GENERAL_REPAIR',
      description: dto.description,
      priority: dto.priority || RecommendedWorkPriority.RECOMMENDED_NOW,
      estimated_labor_hours: dto.estimated_labor_hours || 0,
      estimated_labor_cost: dto.estimated_labor_cost || 0,
      estimated_parts_cost: dto.estimated_parts_cost || 0,
      currency: dto.currency || 'KES',
      status: RecommendedWorkStatus.PROPOSED,
      declined_reason: null,
      declined_at: null,
      declined_by: null,
      created_at: now,
      updated_at: now,
    };

    operationsRepository.createRecommendedWorkItem(entity);

    if (sc.status === ServiceCaseStatus.ESTIMATING || sc.status === ServiceCaseStatus.IN_INSPECTION) {
      operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.PENDING_AUTHORIZATION);
    }

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: null,
      action: 'WORK_RECOMMENDED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Recommended work: ${dto.description} (Est. ${dto.estimated_labor_cost + dto.estimated_parts_cost} ${dto.currency || 'KES'})`,
      occurred_at: now,
    });

    return entity;
  }

  authorizeService(actor: OperationsActorContext, dto: AuthorizeServiceDto): ServiceAuthorizationEntity {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    if (!dto.recommended_work_item_ids || dto.recommended_work_item_ids.length === 0) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one recommended work item must be authorized',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const authId = generateCanonicalId('auth');

    // Get current scope version count
    const existingAuths = operationsRepository.listServiceAuthorizations(sc.id);
    const scopeVersion = existingAuths.length + 1;

    const authEntity: ServiceAuthorizationEntity = {
      id: authId,
      service_case_id: sc.id,
      authorization_type: dto.authorization_type || ServiceAuthorizationType.INITIAL,
      scope_version: scopeVersion,
      amount_authorized: dto.amount_authorized || 0,
      currency: dto.currency || 'KES',
      authorized_by: dto.authorized_by,
      authorized_at: now,
      authorization_channel: dto.authorization_channel || AuthorizationChannel.IN_PERSON,
      status: 'AUTHORIZED',
      notes: dto.notes || null,
      created_at: now,
    };

    operationsRepository.createServiceAuthorization(authEntity, dto.recommended_work_item_ids);

    // Handle any explicitly declined items
    if (dto.declined_items && dto.declined_items.length > 0) {
      for (const declined of dto.declined_items) {
        operationsRepository.updateRecommendedWorkItem(declined.recommended_work_item_id, {
          status: RecommendedWorkStatus.DECLINED,
          declined_reason: declined.reason,
          declined_at: now,
          declined_by: dto.authorized_by,
        });
      }
    }

    // Move service case to AUTHORIZED status
    operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.AUTHORIZED);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: null,
      action: 'SERVICE_AUTHORIZED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Service scope authorized by ${dto.authorized_by} via ${dto.authorization_channel} for ${dto.amount_authorized} ${dto.currency || 'KES'}`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.authorized',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
        actor_id: actor.actor_id,
        payload: { authorization: authEntity, authorized_item_ids: dto.recommended_work_item_ids },
      })
    );

    return authEntity;
  }

  // =========================================================================
  // 5. Work Order Generation & Execution
  // =========================================================================

  createWorkOrder(actor: OperationsActorContext, dto: CreateWorkOrderDto): WorkOrderAggregate {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const existingWo = operationsRepository.getWorkOrderByCaseId(sc.id);
    if (existingWo) {
      return this.getWorkOrderAggregate(existingWo.id)!;
    }

    const recommendedItems = operationsRepository.listRecommendedWorkItems(sc.id);
    const authorizedRecItems = recommendedItems.filter((i) => i.status === RecommendedWorkStatus.AUTHORIZED);

    if (authorizedRecItems.length === 0) {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Cannot generate a Work Order without at least one authorized work item.',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const woId = generateCanonicalId('wo');
    const woNumber = this.generateWorkOrderNumber();

    const orderEntity: WorkOrderEntity = {
      id: woId,
      service_case_id: sc.id,
      provider_id: sc.provider_id,
      branch_id: sc.branch_id,
      vehicle_id: sc.vehicle_id,
      work_order_number: woNumber,
      status: WorkOrderStatus.OPEN,
      opened_at: now,
      started_at: null,
      completed_at: null,
      assigned_service_advisor_id: dto.assigned_service_advisor_id || sc.service_advisor_id,
      created_by: actor.actor_id,
      created_at: now,
      updated_at: now,
    };

    const workOrderItems: WorkOrderItemEntity[] = authorizedRecItems.map((rec) => ({
      id: generateCanonicalId('woi'),
      work_order_id: woId,
      work_type: WorkType.REPAIR,
      service_category: rec.service_category,
      description: rec.description,
      related_recommended_work_item_id: rec.id,
      related_issue_id: rec.related_issue_id,
      related_maintenance_task_id: rec.maintenance_task_id,
      related_finding_id: rec.related_finding_id,
      status: WorkOrderItemStatus.NOT_STARTED,
      authorization_status: 'AUTHORIZED',
      assigned_technician_id: null,
      estimated_hours: rec.estimated_labor_hours,
      actual_hours: 0,
      billable_hours: rec.estimated_labor_hours,
      hourly_rate: 2500,
      started_at: null,
      completed_at: null,
      block_reason: null,
      created_at: now,
      updated_at: now,
    }));

    operationsRepository.createWorkOrder(orderEntity, workOrderItems);

    operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.IN_PROGRESS);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: woId,
      action: 'WORK_ORDER_CREATED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Generated Work Order ${woNumber} with ${workOrderItems.length} authorized items.`,
      occurred_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.work_order_created',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, work_order: woId },
        actor_id: actor.actor_id,
        payload: { work_order: orderEntity, item_count: workOrderItems.length },
      })
    );

    return this.getWorkOrderAggregate(woId)!;
  }

  getWorkOrderAggregate(workOrderId: string): WorkOrderAggregate | null {
    const order = operationsRepository.getWorkOrderById(workOrderId);
    if (!order) return null;

    const itemsRaw = operationsRepository.getWorkOrderItems(workOrderId);
    const parts = operationsRepository.listWorkOrderParts(workOrderId);
    const assignments = operationsRepository.listTechnicianAssignments(workOrderId);
    const holds = operationsRepository.listWorkOrderHolds(workOrderId);
    const qc_checks = operationsRepository.listQualityControlChecks(workOrderId);
    const road_tests = operationsRepository.listRoadTests(workOrderId);

    const items = itemsRaw.map((it) => ({
      ...it,
      technician_assignments: assignments.filter((a) => a.work_order_item_id === it.id),
      work_sessions: operationsRepository.listTechnicianWorkSessions(it.id),
      parts: parts.filter((p) => p.work_order_item_id === it.id),
    }));

    return {
      order,
      items,
      holds,
      qc_checks,
      road_tests,
    };
  }

  listWorkOrders(filter: { provider_id?: string; status?: string }): WorkOrderEntity[] {
    return operationsRepository.listWorkOrders(filter);
  }

  assignTechnician(actor: OperationsActorContext, dto: AssignTechnicianDto): TechnicianAssignmentEntity {
    const wo = operationsRepository.getWorkOrderById(dto.work_order_id);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const assignmentId = generateCanonicalId('ta');

    const assignment: TechnicianAssignmentEntity = {
      id: assignmentId,
      work_order_id: wo.id,
      work_order_item_id: dto.work_order_item_id || null,
      technician_id: dto.technician_id,
      provider_membership_id: null,
      role: dto.role || TechnicianAssignmentRole.PRIMARY,
      assigned_at: now,
      assigned_by: actor.actor_id,
      status: 'ACTIVE',
    };

    operationsRepository.createTechnicianAssignment(assignment);

    if (dto.work_order_item_id) {
      operationsRepository.updateWorkOrderItem(dto.work_order_item_id, {
        assigned_technician_id: dto.technician_id,
        status: WorkOrderItemStatus.ASSIGNED,
      });
    }

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: wo.service_case_id,
      work_order_id: wo.id,
      action: 'TECHNICIAN_ASSIGNED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Technician ${dto.technician_id} assigned as ${dto.role || 'PRIMARY'}`,
      occurred_at: now,
    });

    return assignment;
  }

  startLaborSession(actor: OperationsActorContext, dto: StartLaborSessionDto): TechnicianWorkSessionEntity {
    const item = operationsRepository.getWorkOrderItemById(dto.work_order_item_id);
    if (!item) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order Item not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const sessionId = generateCanonicalId('tws');

    const session: TechnicianWorkSessionEntity = {
      id: sessionId,
      work_order_item_id: item.id,
      technician_id: dto.technician_id || actor.actor_id,
      started_at: now,
      ended_at: null,
      duration_minutes: 0,
      labor_type: dto.labor_type || LaborSessionType.ACTUAL,
      notes: dto.notes || null,
      status: 'ACTIVE',
    };

    operationsRepository.createTechnicianWorkSession(session);

    // Update item status to IN_PROGRESS
    operationsRepository.updateWorkOrderItem(item.id, {
      status: WorkOrderItemStatus.IN_PROGRESS,
      started_at: item.started_at || now,
    });

    const wo = operationsRepository.getWorkOrderById(item.work_order_id);
    if (wo && wo.status !== WorkOrderStatus.IN_PROGRESS) {
      operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.IN_PROGRESS, {
        started_at: wo.started_at || now,
      });
    }

    return session;
  }

  endLaborSession(actor: OperationsActorContext, dto: EndLaborSessionDto): TechnicianWorkSessionEntity {
    const session = operationsRepository.getTechnicianWorkSession(dto.session_id);
    if (!session) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Labor session not found', 404);
    }

    if (session.status === 'COMPLETED') {
      return session;
    }

    const now = getCurrentUtcIsoString();
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(now).getTime();
    const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

    operationsRepository.endTechnicianWorkSession(session.id, now, durationMinutes, dto.notes);

    // Update actual hours on item
    const item = operationsRepository.getWorkOrderItemById(session.work_order_item_id);
    if (item) {
      const addedHours = durationMinutes / 60;
      operationsRepository.updateWorkOrderItem(item.id, {
        actual_hours: Math.round((item.actual_hours + addedHours) * 100) / 100,
      });
    }

    return operationsRepository.getTechnicianWorkSession(session.id)!;
  }

  addWorkOrderPart(actor: OperationsActorContext, dto: AddWorkOrderPartDto): WorkOrderPartEntity {
    const wo = operationsRepository.getWorkOrderById(dto.work_order_id);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const partId = generateCanonicalId('wop');

    const entity: WorkOrderPartEntity = {
      id: partId,
      work_order_item_id: dto.work_order_item_id,
      work_order_id: dto.work_order_id,
      part_number: dto.part_number || null,
      description: dto.description || (dto as any).part_name || '',
      quantity: dto.quantity || 1,
      source: dto.source || WorkOrderPartSource.WORKSHOP_INVENTORY,
      unit_cost: dto.unit_cost || 0,
      unit_price: dto.unit_price || 0,
      currency: dto.currency || 'KES',
      status: (dto as any).status || WorkOrderPartStatus.REQUIRED,
      vehicle_component_id: dto.vehicle_component_id || null,
      replaced_component_id: dto.replaced_component_id || null,
      installed_at: (dto as any).status === 'INSTALLED' ? now : null,
      installed_by: (dto as any).status === 'INSTALLED' ? actor.actor_id : null,
      created_at: now,
      updated_at: now,
    };

    operationsRepository.createWorkOrderPart(entity);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: wo.service_case_id,
      work_order_id: wo.id,
      action: 'PART_ALLOCATED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Part added to work order: ${dto.quantity}x ${dto.description}`,
      occurred_at: now,
    });

    return entity;
  }

  updateWorkOrderPartStatus(
    actor: OperationsActorContext,
    partId: string,
    status: WorkOrderPartStatus,
    extras?: { replaced_component_id?: string; vehicle_component_id?: string }
  ): void {
    const now = getCurrentUtcIsoString();
    const updates: Partial<WorkOrderPartEntity> = {
      status,
      updated_at: now,
    };

    if (status === WorkOrderPartStatus.INSTALLED) {
      updates.installed_at = now;
      updates.installed_by = actor.actor_id;
    }
    if (extras?.replaced_component_id) {
      updates.replaced_component_id = extras.replaced_component_id;
    }
    if (extras?.vehicle_component_id) {
      updates.vehicle_component_id = extras.vehicle_component_id;
    }

    operationsRepository.updateWorkOrderPart(partId, updates);
  }

  updateWorkOrderItemStatus(
    actor: OperationsActorContext,
    itemId: string,
    status: WorkOrderItemStatus,
    blockReason?: string
  ): void {
    const item = operationsRepository.getWorkOrderItemById(itemId);
    if (!item) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order Item not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const updates: Partial<WorkOrderItemEntity> = {
      status,
      block_reason: blockReason || null,
      updated_at: now,
    };

    if (status === WorkOrderItemStatus.COMPLETED) {
      updates.completed_at = now;
    }

    operationsRepository.updateWorkOrderItem(itemId, updates);

    // Check if all items for the work order are completed
    const allItems = operationsRepository.getWorkOrderItems(item.work_order_id);
    const updatedItems = allItems.map((i) => (i.id === itemId ? { ...i, ...updates } : i));
    const allCompleted = updatedItems.every(
      (i) => i.status === WorkOrderItemStatus.COMPLETED || i.status === WorkOrderItemStatus.CANCELLED
    );

    if (allCompleted) {
      operationsRepository.updateWorkOrderStatus(item.work_order_id, WorkOrderStatus.QC_PENDING, {
        completed_at: now,
      });

      const wo = operationsRepository.getWorkOrderById(item.work_order_id);
      if (wo) {
        operationsRepository.updateServiceCaseStatus(wo.service_case_id, ServiceCaseStatus.QUALITY_CONTROL);

        operationsRepository.logActivity({
          id: generateCanonicalId('act'),
          service_case_id: wo.service_case_id,
          work_order_id: wo.id,
          action: 'WORK_ORDER_ALL_ITEMS_COMPLETED',
          actor_id: actor.actor_id,
          actor_name: actor.actor_id,
          details: `All work order items completed. Work order moved to QC Pending.`,
          occurred_at: now,
        });
      }
    }
  }

  placeWorkOrderHold(
    actor: OperationsActorContext,
    workOrderId: string,
    reason: string,
    description: string
  ): WorkOrderHoldEntity {
    const wo = operationsRepository.getWorkOrderById(workOrderId);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const hold: WorkOrderHoldEntity = {
      id: generateCanonicalId('woh'),
      work_order_id: wo.id,
      reason,
      description,
      placed_at: now,
      placed_by: actor.actor_id,
      released_at: null,
      released_by: null,
    };

    operationsRepository.createWorkOrderHold(hold);
    operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.ON_HOLD);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: wo.service_case_id,
      work_order_id: wo.id,
      action: 'WORK_ORDER_PLACED_ON_HOLD',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Work Order placed on hold: ${reason} - ${description}`,
      occurred_at: now,
    });

    return hold;
  }

  releaseWorkOrderHold(actor: OperationsActorContext, holdId: string): void {
    const now = getCurrentUtcIsoString();
    operationsRepository.releaseWorkOrderHold(holdId, actor.actor_id, now);
  }

  // =========================================================================
  // 6. Quality Control Gate & Road Test
  // =========================================================================

  performQualityControlCheck(actor: OperationsActorContext, dto: PerformQcCheckDto): QualityControlCheckEntity {
    const wo = operationsRepository.getWorkOrderById(dto.work_order_id);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const qcId = generateCanonicalId('qc');

    const qc: QualityControlCheckEntity = {
      id: qcId,
      work_order_id: wo.id,
      inspection_id: dto.inspection_id || null,
      performed_by: actor.actor_id,
      performed_at: now,
      result: dto.result,
      checklist_results: dto.checklist_results ? JSON.stringify(dto.checklist_results) : null,
      notes: dto.notes || null,
      rework_instructions: dto.rework_instructions || null,
      created_at: now,
    };

    operationsRepository.createQualityControlCheck(qc);

    if (dto.result === QualityControlResult.PASSED || dto.result === QualityControlResult.PASSED_WITH_CONDITIONS) {
      operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.QC_PASSED);
      operationsRepository.updateServiceCaseStatus(wo.service_case_id, ServiceCaseStatus.READY_FOR_RELEASE);

      operationsRepository.logActivity({
        id: generateCanonicalId('act'),
        service_case_id: wo.service_case_id,
        work_order_id: wo.id,
        action: 'QC_PASSED',
        actor_id: actor.actor_id,
        actor_name: actor.actor_id,
        details: `Quality Control Passed by inspector ${actor.actor_id}. Vehicle ready for release.`,
        occurred_at: now,
      });

      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'service_case.qc_passed',
          correlation_id: wo.service_case_id,
          subject_ids: { vehicle: wo.vehicle_id, provider: wo.provider_id, work_order: wo.id },
          actor_id: actor.actor_id,
          payload: { qc_id: qcId, result: dto.result },
        })
      );
    } else {
      // Rework required
      operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.QC_REWORK_REQUIRED);
      operationsRepository.updateServiceCaseStatus(wo.service_case_id, ServiceCaseStatus.IN_PROGRESS);

      operationsRepository.logActivity({
        id: generateCanonicalId('act'),
        service_case_id: wo.service_case_id,
        work_order_id: wo.id,
        action: 'QC_REWORK_REQUIRED',
        actor_id: actor.actor_id,
        actor_name: actor.actor_id,
        details: `Quality Control rejected with rework required: ${dto.rework_instructions || dto.notes}`,
        occurred_at: now,
      });
    }

    return qc;
  }

  recordRoadTest(actor: OperationsActorContext, dto: PerformRoadTestDto): RoadTestEntity {
    const wo = operationsRepository.getWorkOrderById(dto.work_order_id);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const rt: RoadTestEntity = {
      id: generateCanonicalId('rt'),
      work_order_id: wo.id,
      performed_by: actor.actor_id,
      started_at: dto.started_at || now,
      ended_at: dto.ended_at || now,
      start_odometer_km: dto.start_odometer_km || null,
      end_odometer_km: dto.end_odometer_km || null,
      result: dto.result,
      notes: dto.notes || null,
      created_at: now,
    };

    operationsRepository.createRoadTest(rt);

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: wo.service_case_id,
      work_order_id: wo.id,
      action: 'ROAD_TEST_RECORDED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Road test completed with result ${dto.result}.`,
      occurred_at: now,
    });

    return rt;
  }

  // =========================================================================
  // 7. Vehicle Handover & Release
  // =========================================================================

  releaseVehicle(actor: OperationsActorContext, dto: ReleaseVehicleDto): VehicleReleaseEntity {
    const sc = operationsRepository.getServiceCaseById(dto.service_case_id);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const wo = operationsRepository.getWorkOrderByCaseId(sc.id);
    if (!wo) {
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION, 'Cannot release without an associated Work Order', 400);
    }

    // Strict validation: QC must be passed before release!
    const qcChecks = operationsRepository.listQualityControlChecks(wo.id);
    const passedQc = qcChecks.find(
      (q) => q.result === QualityControlResult.PASSED || q.result === QualityControlResult.PASSED_WITH_CONDITIONS
    );

    if (!passedQc) {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Cannot release vehicle before Quality Control gate inspection is PASSED.',
        400
      );
    }

    if (!dto.recipient_name || !dto.recipient_name.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Recipient name is mandatory for vehicle handover', 400);
    }

    if (dto.final_odometer_km === undefined || dto.final_odometer_km === null) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Final release odometer reading is required', 400);
    }

    if (sc.intake_odometer_km !== null && dto.final_odometer_km < sc.intake_odometer_km) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Final odometer reading (${dto.final_odometer_km} km) cannot be less than intake reading (${sc.intake_odometer_km} km)`,
        400
      );
    }

    const now = getCurrentUtcIsoString();

    // Record final release odometer observation
    const odoId = generateCanonicalId('odo');
    const finalOdoObservation: OdometerObservationEntity = {
      id: odoId,
      vehicle_id: sc.vehicle_id,
      reading_value: dto.final_odometer_km,
      unit: OdometerUnit.KM,
      reading_km: dto.final_odometer_km,
      observed_at: now,
      recorded_at: now,
      source_class: 'SERVICE_REPAIR',
      source_ref: sc.id,
      actor_id: actor.actor_id,
      provider_id: sc.provider_id,
      status: OdometerObservationStatus.VALID,
      flag_reason: null,
      superseded_by_id: null,
      correction_reason: null,
      notes: `Final release handover odometer for service case ${sc.service_case_number}`,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.createOdometerObservation(finalOdoObservation);

    const releaseId = generateCanonicalId('rel');
    const releaseEntity: VehicleReleaseEntity = {
      id: releaseId,
      service_case_id: sc.id,
      work_order_id: wo.id,
      released_at: now,
      released_by: actor.actor_id,
      recipient_user_id: dto.recipient_user_id || sc.customer_user_id || null,
      recipient_name: dto.recipient_name,
      recipient_phone: dto.recipient_phone || sc.customer_contact_phone || null,
      final_odometer_km: dto.final_odometer_km,
      final_odometer_observation_id: odoId,
      handover_notes: dto.handover_notes || null,
      acknowledgement_status: dto.acknowledgement_status || 'ACKNOWLEDGED',
      created_at: now,
    };

    operationsRepository.createVehicleRelease(releaseEntity);

    // Update Service Case and Work Order statuses
    operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.CLOSED);
    operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.RELEASED, {
      released_at: now,
      completed_at: now,
      final_odometer_km: dto.final_odometer_km,
    });

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: wo.id,
      action: 'VEHICLE_RELEASED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Vehicle handed over to ${dto.recipient_name} at ${dto.final_odometer_km} km. Service case closed.`,
      occurred_at: now,
    });

    // Publish canonical domain events
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'odometer.recorded',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
        actor_id: actor.actor_id,
        payload: { observation: finalOdoObservation },
      })
    );

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.work_order_completed',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, work_order: wo.id },
        actor_id: actor.actor_id,
        payload: { work_order_id: wo.id, final_odometer_km: dto.final_odometer_km },
      })
    );

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'service_case.vehicle_released',
        correlation_id: sc.id,
        subject_ids: { vehicle: sc.vehicle_id, provider: sc.provider_id, service_case: sc.id },
        actor_id: actor.actor_id,
        payload: { release: releaseEntity },
      })
    );

    return releaseEntity;
  }

  // =========================================================================
  // 8. Notes, Cancellation & Utilities
  // =========================================================================

  addNote(
    actor: OperationsActorContext,
    serviceCaseId: string,
    content: string,
    visibility: ServiceCaseNoteVisibility = ServiceCaseNoteVisibility.INTERNAL_PROVIDER_NOTE
  ): ServiceCaseNoteEntity {
    const sc = operationsRepository.getServiceCaseById(serviceCaseId);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const note: ServiceCaseNoteEntity = {
      id: generateCanonicalId('scn'),
      service_case_id: sc.id,
      author_id: actor.actor_id,
      author_name: actor.actor_id,
      visibility,
      content,
      created_at: now,
    };

    operationsRepository.addNote(note);
    return note;
  }

  cancelServiceCase(actor: OperationsActorContext, serviceCaseId: string, reason: string): void {
    const sc = operationsRepository.getServiceCaseById(serviceCaseId);
    if (!sc) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
    }

    if (sc.status === ServiceCaseStatus.RELEASED || sc.status === ServiceCaseStatus.CLOSED) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Cannot cancel a released or closed service case',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    operationsRepository.updateServiceCaseStatus(sc.id, ServiceCaseStatus.CANCELLED, {
      cancelled_at: now,
      cancellation_reason: reason,
    });

    const wo = operationsRepository.getWorkOrderByCaseId(sc.id);
    if (wo) {
      operationsRepository.updateWorkOrderStatus(wo.id, WorkOrderStatus.CANCELLED);
    }

    operationsRepository.logActivity({
      id: generateCanonicalId('act'),
      service_case_id: sc.id,
      work_order_id: wo?.id || null,
      action: 'SERVICE_CASE_CANCELLED',
      actor_id: actor.actor_id,
      actor_name: actor.actor_id,
      details: `Service case cancelled: ${reason}`,
      occurred_at: now,
    });
  }
}

export const garageOperationsService = new GarageOperationsService();
