import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { garageOperationsService } from '../../src/server/operations/garageOperationsService';
import { operationsRepository } from '../../src/server/operations/operationsRepository';
import {
  ServiceCaseStatus,
  InspectionType,
  InspectionItemResultValue,
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
  WorkOrderPartSource,
  QualityControlResult,
  RoadTestResult,
  CustomerConcernPriority,
  ServiceCaseSourceType,
} from '../../src/server/operations/types';
import { FuelType, OdometerUnit, TransmissionType, VehicleType } from '../../src/server/vehicle/types';
import { OrganizationType, MembershipRole } from '../../src/server/identity/types';
import { CanonicalPermission } from '../../src/server/identity/rbac';
import { timelineProjector } from '../../src/server/timeline/timelineProjector';
import { timelineRepository } from '../../src/server/timeline/timelineRepository';
import { TimelineEntryType } from '../../src/server/timeline/types';

describe('Garage Operations Management Architecture (GAR-012)', () => {
  let vehicleId: string;
  let providerOrgId: string;
  let serviceAdvisorActor: any;
  let technicianActor: any;
  let customerActor: any;

  beforeEach(() => {
    resetDatabaseInstance();
    const db = getDatabase({ memory: true });
    runMigrations(db);
    timelineProjector.initialize();

    // 1. Create customer user & vehicle
    const regCustomer = authService.registerUser({
      email: 'customer@garageos.test',
      fullName: 'Alice Customer',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regCustomer.user.id);
    customerActor = authService.getActorContextById(regCustomer.user.id)!;

    const vehicleAgg = vehicleService.createVehicle(customerActor, {
      make: 'Subaru',
      model: 'Outback',
      model_year: 2021,
      vehicle_type: VehicleType.WAGON,
      fuel_type: FuelType.PETROL,
      transmission: TransmissionType.AUTOMATIC,
      registration_number: 'KDD 456Z',
      vin: 'JF1BS9KL6M3019823',
      initial_odometer_value: 45000,
      initial_odometer_unit: OdometerUnit.KM,
    });
    vehicleId = vehicleAgg.vehicle.id;

    // 2. Create provider organization & advisor user
    const regAdvisor = authService.registerUser({
      email: 'advisor@workshop.test',
      fullName: 'Bob Service Advisor',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regAdvisor.user.id);

    const regTech = authService.registerUser({
      email: 'tech@workshop.test',
      fullName: 'Charlie Mechanic',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regTech.user.id);

    providerOrgId = 'org_apex_motors';
    db.prepare(`
      INSERT INTO organizations (
        id, organization_type, name, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(providerOrgId, OrganizationType.AUTOMOTIVE_SERVICE_PROVIDER, 'Apex Motors Workshop');

    // Create service_providers record
    const providerId = 'srv_apex_motors';
    db.prepare(`
      INSERT INTO service_providers (
        id, organization_id, name, provider_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'GARAGE', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(providerId, providerOrgId, 'Apex Motors Workshop');

    // Create provider_locations record
    const locationId = 'loc_apex_main';
    db.prepare(`
      INSERT INTO provider_locations (
        id, provider_id, name, location_type, address_line1, city, county_state, country, latitude, longitude, created_at, updated_at
      ) VALUES (?, ?, ?, 'WORKSHOP', '123 Workshop Rd', 'Nairobi', 'Nairobi', 'KE', -1.28, 36.82, datetime('now'), datetime('now'))
    `).run(locationId, providerId, 'Apex Central');

    // Create provider_branches record
    const branchId = 'branch_apex_main';
    db.prepare(`
      INSERT INTO provider_branches (
        id, provider_id, location_id, name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(branchId, providerId, locationId, 'Apex Main Branch');

    // Add advisor membership
    const advisorMemId = 'mem_advisor_01';
    db.prepare(`
      INSERT INTO organization_memberships (
        id, user_id, organization_id, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(advisorMemId, regAdvisor.user.id, providerOrgId, MembershipRole.SERVICE_ADVISOR);

    // Add tech membership
    const techMemId = 'mem_tech_01';
    db.prepare(`
      INSERT INTO organization_memberships (
        id, user_id, organization_id, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(techMemId, regTech.user.id, providerOrgId, MembershipRole.TECHNICIAN);

    serviceAdvisorActor = {
      ...authService.getActorContextById(regAdvisor.user.id, providerOrgId)!,
      actor_id: regAdvisor.user.id,
      organization_ids: [providerOrgId],
      active_organization_id: providerOrgId,
      permissions: Object.values(CanonicalPermission),
    };

    technicianActor = {
      ...authService.getActorContextById(regTech.user.id, providerOrgId)!,
      actor_id: regTech.user.id,
      organization_ids: [providerOrgId],
      active_organization_id: providerOrgId,
      permissions: Object.values(CanonicalPermission),
    };
  });

  it('executes full automotive workshop lifecycle: intake -> inspection -> authorization -> execution -> QC -> release', () => {
    // -----------------------------------------------------------------------
    // STEP 1: Vehicle Arrives -> Service Case Opened
    // -----------------------------------------------------------------------
    const serviceCase = garageOperationsService.createServiceCase(serviceAdvisorActor, {
      provider_id: 'srv_apex_motors',
      branch_id: 'branch_apex_main',
      vehicle_id: vehicleId,
      customer_user_id: customerActor.id,
      customer_contact_name: 'Alice Customer',
      customer_contact_phone: '+254711223344',
      source_type: ServiceCaseSourceType.WALK_IN,
      initial_concerns: [
        {
          concern_type: 'BRAKES',
          description: 'Squeaking noise from front wheels under moderate braking',
          priority: CustomerConcernPriority.HIGH,
        },
      ],
    });

    assert.ok(serviceCase.case.id.startsWith('sc_'));
    assert.ok(serviceCase.case.service_case_number.startsWith('SC-'));
    assert.equal(serviceCase.case.status, ServiceCaseStatus.OPEN);
    assert.equal(serviceCase.concerns.length, 1);
    assert.equal(serviceCase.concerns[0].priority, CustomerConcernPriority.HIGH);

    const caseId = serviceCase.case.id;

    // -----------------------------------------------------------------------
    // STEP 2: Intake & Check-in
    // -----------------------------------------------------------------------
    const checkedIn = garageOperationsService.performCheckIn(serviceAdvisorActor, {
      service_case_id: caseId,
      odometer_value: 45320,
      odometer_unit: 'KM',
      fuel_level: '3/4',
      vehicle_condition_summary: 'Clean exterior, small paint scratch on rear bumper',
      keys_received_count: 2,
      documents_received: 'Registration logbook copy',
      observations: [
        {
          category: 'BODYWORK',
          position: 'REAR_BUMPER_RIGHT',
          description: '3cm clear coat scratch',
          severity: 'MINOR',
        },
      ],
      intake_items: [
        {
          item_name: 'Tool kit & spare wheel',
          item_type: 'EQUIPMENT',
          quantity: 1,
          condition_notes: 'Present in trunk',
        },
      ],
    });

    assert.equal(checkedIn.case.status, ServiceCaseStatus.CHECKED_IN);
    assert.ok(checkedIn.check_in);
    assert.equal(checkedIn.check_in.odometer_value, 45320);
    assert.equal(checkedIn.check_in.observations.length, 1);
    assert.equal(checkedIn.check_in.intake_items.length, 1);

    // -----------------------------------------------------------------------
    // STEP 3: Customer Concern Added
    // -----------------------------------------------------------------------
    const concern2 = garageOperationsService.addCustomerConcern(serviceAdvisorActor, caseId, {
      concern_type: 'SUSPENSION',
      description: 'Slight vibration through steering wheel at 80 km/h',
      priority: CustomerConcernPriority.MEDIUM,
    });
    assert.ok(concern2.id.startsWith('cc_'));

    // -----------------------------------------------------------------------
    // STEP 4: Start Inspection
    // -----------------------------------------------------------------------
    const templates = garageOperationsService.listInspectionTemplates();
    const defaultTpl = templates.length > 0 ? templates[0] : null;

    const inspection = garageOperationsService.startInspection(technicianActor, {
      service_case_id: caseId,
      inspection_type: InspectionType.DIAGNOSTIC,
      template_id: defaultTpl?.id,
      notes: 'Diagnostic inspection for brake squeak and suspension vibration',
    });

    assert.ok(inspection.id.startsWith('insp_'));
    assert.equal(inspection.status, 'IN_PROGRESS');

    // Verify service case transitioned to IN_INSPECTION
    const aggAfterInsp = garageOperationsService.getServiceCaseAggregate(caseId)!;
    assert.equal(aggAfterInsp.case.status, ServiceCaseStatus.IN_INSPECTION);

    // -----------------------------------------------------------------------
    // STEP 5: Record Inspection Results & Findings
    // -----------------------------------------------------------------------
    const recordedInspection = garageOperationsService.recordInspectionResults(technicianActor, {
      inspection_id: inspection.id,
      complete_inspection: true,
      notes: 'Front brake pads worn below safety limit (2mm remaining); front right rotor grooved',
      results: [
        {
          item_name: 'Front Brake Pads',
          category: 'BRAKES',
          result: InspectionItemResultValue.FAIL_SAFETY_RISK,
          measured_value: 2.1,
          measurement_unit: 'mm',
          notes: 'Friction material below minimum 3mm threshold',
        },
        {
          item_name: 'Brake Rotors',
          category: 'BRAKES',
          result: InspectionItemResultValue.ATTENTION_REQUIRED,
          measured_value: 22.0,
          measurement_unit: 'mm',
          notes: 'Surface grooving observed on front right disc',
        },
      ],
      findings: [
        {
          category: 'BRAKES',
          finding_type: 'EXCESSIVE_WEAR',
          severity: FindingSeverity.SAFETY_CRITICAL,
          description: 'Front brake pads worn to 2mm backing plate proximity',
          recommended_action: 'Replace front brake pad set and resurface rotors',
        },
      ],
    });

    assert.equal(recordedInspection.status, 'COMPLETED');

    // -----------------------------------------------------------------------
    // STEP 6: Recommend Work Item
    // -----------------------------------------------------------------------
    const recItem = garageOperationsService.recommendWorkItem(serviceAdvisorActor, {
      service_case_id: caseId,
      service_category: 'BRAKES',
      description: 'Replace front brake pad set (ceramic) & resurface rotors',
      priority: RecommendedWorkPriority.CRITICAL_SAFETY,
      estimated_labor_hours: 1.5,
      estimated_labor_cost: 4500,
      estimated_parts_cost: 8500,
      currency: 'KES',
    });

    assert.ok(recItem.id.startsWith('rec_'));
    assert.equal(recItem.status, RecommendedWorkStatus.PROPOSED);

    // -----------------------------------------------------------------------
    // STEP 7: Customer Service Authorization
    // -----------------------------------------------------------------------
    const auth = garageOperationsService.authorizeService(serviceAdvisorActor, {
      service_case_id: caseId,
      recommended_work_item_ids: [recItem.id],
      authorization_type: ServiceAuthorizationType.INITIAL,
      amount_authorized: 13000,
      currency: 'KES',
      authorized_by: 'Alice Customer',
      authorization_channel: AuthorizationChannel.IN_PERSON,
      notes: 'Customer signed work estimate authorization at service desk',
    });

    assert.ok(auth.id.startsWith('auth_'));
    assert.equal(auth.status, 'AUTHORIZED');

    // Verify service case moved to AUTHORIZED
    const aggAfterAuth = garageOperationsService.getServiceCaseAggregate(caseId)!;
    assert.equal(aggAfterAuth.case.status, ServiceCaseStatus.AUTHORIZED);

    // -----------------------------------------------------------------------
    // STEP 8: Create Work Order
    // -----------------------------------------------------------------------
    const workOrderAgg = garageOperationsService.createWorkOrder(serviceAdvisorActor, {
      service_case_id: caseId,
      assigned_service_advisor_id: serviceAdvisorActor.actor_id,
    });

    assert.ok(workOrderAgg.order.id.startsWith('wo_'));
    assert.ok(workOrderAgg.order.work_order_number.startsWith('WO-'));
    assert.equal(workOrderAgg.order.status, WorkOrderStatus.OPEN);
    assert.equal(workOrderAgg.items.length, 1);

    const workOrderId = workOrderAgg.order.id;
    const workOrderItemId = workOrderAgg.items[0].id;

    // -----------------------------------------------------------------------
    // STEP 9: Technician Assignment & Labor Execution
    // -----------------------------------------------------------------------
    const assignment = garageOperationsService.assignTechnician(serviceAdvisorActor, {
      work_order_id: workOrderId,
      work_order_item_id: workOrderItemId,
      technician_id: technicianActor.actor_id,
      role: TechnicianAssignmentRole.PRIMARY,
    });
    assert.ok(assignment.id.startsWith('ta_'));

    // Start labor session
    const session = garageOperationsService.startLaborSession(technicianActor, {
      work_order_item_id: workOrderItemId,
      technician_id: technicianActor.actor_id,
      labor_type: LaborSessionType.ACTUAL,
    });
    assert.ok(session.id.startsWith('tws_'));

    // Work order should now be IN_PROGRESS
    const woInProgress = garageOperationsService.getWorkOrderAggregate(workOrderId)!;
    assert.equal(woInProgress.order.status, WorkOrderStatus.IN_PROGRESS);

    // End labor session (1.4 hours worked)
    const endedSession = garageOperationsService.endLaborSession(technicianActor, {
      session_id: session.id,
      notes: 'Brake pads replaced, calipers cleaned and greased, fluid flushed',
    });
    assert.ok(endedSession.ended_at);

    // Record installed part
    const part = garageOperationsService.addWorkOrderPart(technicianActor, {
      work_order_id: workOrderId,
      work_order_item_id: workOrderItemId,
      part_number: 'BPD-SUB-OUT-01',
      description: 'Brembo Front Ceramic Brake Pads Set',
      quantity: 1,
      unit_cost: 8500,
      source: WorkOrderPartSource.WORKSHOP_INVENTORY,
    });
    assert.ok(part.id.startsWith('wop_'));

    // Complete work order item
    garageOperationsService.updateWorkOrderItemStatus(
      serviceAdvisorActor,
      workOrderItemId,
      WorkOrderItemStatus.COMPLETED
    );

    // -----------------------------------------------------------------------
    // STEP 10: Quality Control & Road Test
    // -----------------------------------------------------------------------
    // Verify that releasing vehicle fails if QC check not performed
    assert.throws(() => {
      garageOperationsService.releaseVehicle(serviceAdvisorActor, {
        service_case_id: caseId,
        recipient_name: 'Alice Customer',
        final_odometer_km: 45335,
      });
    }, /quality control/i);

    // Perform QC check
    const qc = garageOperationsService.performQualityControlCheck(serviceAdvisorActor, {
      work_order_id: workOrderId,
      result: QualityControlResult.PASSED,
      checklist_results: {
        torque_wheel_nuts: 'PASS',
        fluid_level: 'PASS',
        pedal_feel: 'PASS',
      },
      notes: 'Pedal firmness confirmed, zero leaks detected',
    });
    assert.ok(qc.id.startsWith('qc_'));
    assert.equal(qc.result, QualityControlResult.PASSED);

    // Perform Road Test
    const roadTest = garageOperationsService.recordRoadTest(technicianActor, {
      work_order_id: workOrderId,
      started_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      start_odometer_km: 45320,
      end_odometer_km: 45332,
      result: RoadTestResult.PASSED,
      notes: 'Braking performance quiet and firm. No high speed vibration.',
    });
    assert.ok(roadTest.id.startsWith('rt_'));

    // Work order should now be in QC_PASSED status
    const woAfterQC = garageOperationsService.getWorkOrderAggregate(workOrderId)!;
    assert.equal(woAfterQC.order.status, WorkOrderStatus.QC_PASSED);

    // Verify service case transitioned to READY_FOR_RELEASE
    const aggBeforeRelease = garageOperationsService.getServiceCaseAggregate(caseId)!;
    assert.equal(aggBeforeRelease.case.status, ServiceCaseStatus.READY_FOR_RELEASE);

    // -----------------------------------------------------------------------
    // STEP 11: Vehicle Handover & Release
    // -----------------------------------------------------------------------
    const release = garageOperationsService.releaseVehicle(serviceAdvisorActor, {
      service_case_id: caseId,
      recipient_name: 'Alice Customer',
      recipient_phone: '+254711223344',
      final_odometer_km: 45332,
      handover_notes: 'Customer inspected vehicle, paid invoice, keys and logbook returned',
    });

    assert.ok(release.id.startsWith('rel_'));
    assert.equal(release.recipient_name, 'Alice Customer');

    // Final check of service case aggregate
    const finalAggregate = garageOperationsService.getServiceCaseAggregate(caseId)!;
    assert.equal(finalAggregate.case.status, ServiceCaseStatus.RELEASED);
    assert.equal(finalAggregate.case.final_odometer_km, 45332);
    assert.ok(finalAggregate.release);
    assert.equal(finalAggregate.release.recipient_name, 'Alice Customer');

    // -----------------------------------------------------------------------
    // STEP 12: Verify Timeline & Digital Passport Projection
    // -----------------------------------------------------------------------
    const timeline = timelineRepository.getTimelineEntries(vehicleId);
    assert.ok(timeline.entries.length > 0, 'Timeline entries must be recorded');
    const releaseTimelineEntry = timeline.entries.find(
      (e) => e.source_reference_type === 'VEHICLE_RELEASE'
    );
    assert.ok(releaseTimelineEntry, 'Vehicle release must project onto vehicle timeline');
    assert.equal(releaseTimelineEntry.odometer_value, 45332);

    const passport = timelineRepository.getPassportProjection(vehicleId);
    assert.ok(passport, 'Digital vehicle passport projection must be built');
    const passportPayload = JSON.parse(passport.passport_payload);
    assert.ok(passportPayload);
    assert.equal(passportPayload.metadata.vehicle_id, vehicleId);
  });
});
