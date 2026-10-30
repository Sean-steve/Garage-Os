/**
 * Sprint 12 Comprehensive Verification & Integration Test Suite
 * Primary Specification: GAR-014 — Roadside Assistance Architecture
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { roadsideService } from '../../src/server/roadside/roadsideService';
import { roadsideRepository } from '../../src/server/roadside/roadsideRepository';
import { RoadsideTriageEngine } from '../../src/server/roadside/triageEngine';
import { timelineProjector } from '../../src/server/timeline/timelineProjector';
import { timelineRepository } from '../../src/server/timeline/timelineRepository';
import {
  RoadsideIncidentStatus,
  IncidentSeverity,
  IncidentType,
  DrivabilityState,
  OccupantSafetyState,
  AssistanceType,
  ProviderOfferStatus,
  AssignmentStatus,
  InterventionResult,
  InterventionActionType,
  EvidenceType,
  TowDestinationType,
} from '../../src/server/roadside/types';
import { FuelType, TransmissionType, VehicleType, DriveType } from '../../src/server/vehicle/types';
import { OrganizationType, MembershipRole } from '../../src/server/identity/types';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Roadside Assistance Core Architecture (GAR-014)', () => {
  let db: any;
  let driverUser: any;
  let driverActor: any;
  let vehicleId: string;
  let providerId: string;
  let providerActor: any;

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);
    timelineProjector.initialize();

    // 1. Create stranded driver and organization
    const authDriver = authService.registerUser({
      email: 'driver.stranded@garage-os.local',
      fullName: 'Wanjiku Driver',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(authDriver.user.id);
    driverUser = authDriver.user;
    driverActor = authService.getActorContextById(driverUser.id)!;
    driverActor.phone = '+254711000111';

    // 2. Register vehicle
    const veh = vehicleService.createVehicle(
      driverActor,
      {
        vin: 'KMHD84LF7JU987654',
        make: 'Hyundai',
        model: 'Ioniq 5',
        model_year: 2022,
        vehicle_type: VehicleType.SUV,
        fuel_type: FuelType.ELECTRIC,
        transmission: TransmissionType.AUTOMATIC,
        drive_type: DriveType.AWD,
      }
    );
    vehicleId = veh.vehicle.id;

    // 3. Register service provider organization, provider, and technician user in DB
    const techReg = authService.registerUser({
      email: 'kamau.tech@swiftrescue.ke',
      fullName: 'Kamau Technician',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(techReg.user.id);

    const providerOrgId = 'org_swift_rescue_01';
    db.prepare(`
      INSERT INTO organizations (id, organization_type, name, status, created_at, updated_at)
      VALUES (?, 'AUTOMOTIVE_SERVICE_PROVIDER', 'Swift Roadside Rescue Ltd', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(providerOrgId);

    db.prepare(`
      INSERT INTO organization_memberships (id, user_id, organization_id, role, status, created_at, updated_at)
      VALUES ('mem_tech_01', ?, ?, 'TECHNICIAN', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(techReg.user.id, providerOrgId);

    providerActor = authService.getActorContextById(techReg.user.id)!;
    providerActor.phone = '+254722999888';

    providerId = 'srv_swift_rescue_01';
    db.prepare(`
      INSERT INTO service_providers (
        id, organization_id, name, provider_type, status, verification_status,
        accepts_roadside_jobs, accepts_mobile_jobs, currency, callout_fee, created_at, updated_at
      ) VALUES (
        ?, ?, 'Swift Roadside Rescue Ltd', 'WORKSHOP', 'ACTIVE', 'VERIFIED',
        1, 1, 'KES', 2500, datetime('now'), datetime('now')
      )
    `).run(providerId, providerOrgId);

    db.prepare(`
      INSERT INTO provider_locations (
        id, provider_id, name, location_type, address_line1, city, county_state, country, latitude, longitude, created_at, updated_at
      ) VALUES (
        'loc_swift_01', ?, 'Nairobi Base', 'WORKSHOP', 'Enterprise Rd', 'Nairobi', 'Nairobi', 'KE',
        -1.286389, 36.817223, datetime('now'), datetime('now')
      )
    `).run(providerId);
  });

  it('Scenario A & B: Report breakdown and run deterministic triage engine', async () => {
    // 1. Report breakdown incident
    const aggregate = await roadsideService.reportIncident(
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.PUNCTURE_OR_FLAT_TYRE,
        description: 'Rear left tyre blown on Mombasa Highway',
        reported_by_phone: '+254711000111',
        location: {
          latitude: -1.315,
          longitude: 36.89,
          road_or_highway: 'Mombasa Road (A104)',
          landmark_description: 'Near City Cabanas flyover',
          is_dangerous_location: true,
        },
      },
      driverActor
    );

    assert.ok(aggregate.incident.id);
    assert.match(aggregate.incident.incident_number, /^RSA-\d{4}-\d{5}$/);
    assert.equal(aggregate.incident.status, RoadsideIncidentStatus.DRAFT);
    assert.equal(aggregate.current_location?.road_or_highway, 'Mombasa Road (A104)');
    assert.equal(aggregate.current_location?.is_dangerous_location, true);

    // Check timeline entry projected for incident report
    const timelineEntries = timelineRepository.getTimelineEntries(vehicleId).entries;
    const incidentEntry = timelineEntries.find((e) => e.entry_type === 'ROADSIDE_INCIDENT');
    assert.ok(incidentEntry, 'Vehicle timeline must project roadside incident entry');

    // 2. Conduct Triage: Stranded on live carriageway with NO spare tyre
    const triagedAggregate = await roadsideService.conductTriage(
      aggregate.incident.id,
      {
        is_live_highway_lane: true,
        has_inflated_spare_tyre: false,
        has_locking_wheel_nut_key: false,
        occupants_feel_unsafe: true,
      },
      driverActor
    );

    assert.equal(triagedAggregate.incident.status, RoadsideIncidentStatus.TRIAGED);
    assert.equal(triagedAggregate.incident.severity, IncidentSeverity.CRITICAL_HIGHWAY);
    assert.equal(triagedAggregate.incident.occupant_safety_state, OccupantSafetyState.HAZARDOUS_CARRIAGEWAY);
    assert.equal(triagedAggregate.incident.safety_escalation_required, true);

    // Because it's an AWD EV with no spare, flatbed recovery tow is mandated
    assert.equal(triagedAggregate.triage_record?.tow_required, true);
    assert.equal(triagedAggregate.triage_record?.recommended_assistance_type, AssistanceType.TOW_FLATBED);
  });

  it('Scenario C & D: Assistance request broadcasting, offers & concurrency collision guard', async () => {
    // 1. Report incident
    const initial = await roadsideService.reportIncident(
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.BATTERY_DEAD,
        description: 'Dead battery in car park',
        location: {
          latitude: -1.286,
          longitude: 36.817,
          address_line: 'Kenyatta Avenue, Nairobi CBD',
        },
      },
      driverActor
    );

    // 2. Run triage
    await roadsideService.conductTriage(
      initial.incident.id,
      {
        engine_cranks: false,
        lights_and_dash_work: false,
      },
      driverActor
    );

    // 3. Broadcast assistance request
    const { request, offers } = await roadsideService.requestAssistance(
      initial.incident.id,
      {
        search_radius_km: 25.0,
      },
      driverActor
    );

    assert.ok(request.id);
    assert.ok(offers.length >= 1, 'Should find at least 1 eligible provider');
    const offer = offers[0];
    assert.equal(offer.status, ProviderOfferStatus.OFFERED);

    // 4. Provider accepts offer
    const acceptResult = await roadsideService.respondToOffer(
      offer.id,
      true,
      {
        eta_minutes: 20,
        assigned_technician_name: 'John Specialist',
        assigned_technician_phone: '+254722123456',
        assigned_vehicle_reg: 'KBZ 123X',
      },
      providerActor
    );

    assert.equal(acceptResult.offer.status, ProviderOfferStatus.ACCEPTED);
    assert.ok(acceptResult.assignment);
    assert.equal(acceptResult.assignment.status, AssignmentStatus.ASSIGNED);

    // Incident status should now be DISPATCHED
    const updatedIncident = roadsideRepository.getIncidentById(initial.incident.id);
    assert.equal(updatedIncident?.status, RoadsideIncidentStatus.DISPATCHED);

    // 5. Concurrency Collision Guard: If a second provider attempts to accept after already claimed
    // Create a dummy second offer to simulate competitor
    const competitorOffer = roadsideRepository.createProviderOffer({
      id: 'rpo_competitor_99',
      request_id: request.id,
      incident_id: initial.incident.id,
      provider_id: providerId,
      status: ProviderOfferStatus.OFFERED,
      offered_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600000).toISOString(),
      callout_charge_minor: 300000,
      currency: 'KES',
    });

    await assert.rejects(
      async () => {
        await roadsideService.respondToOffer(
          competitorOffer.id,
          true,
          { eta_minutes: 15 },
          { actor_id: 'usr_competitor', name: 'Competitor' }
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalAppError);
        return true;
      }
    );
  });

  it('Scenario E & F: Full technician workflow with on-site repair and timeline projection', async () => {
    // 1. Report incident: Flat battery
    const incidentAgg = await roadsideService.reportIncident(
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.BATTERY_DEAD,
        location: {
          latitude: -1.29,
          longitude: 36.82,
        },
      },
      driverActor
    );

    // 2. Request assistance
    const { offers } = await roadsideService.requestAssistance(incidentAgg.incident.id, undefined, driverActor);
    const offer = offers[0];

    // 3. Provider accepts
    const { assignment } = await roadsideService.respondToOffer(
      offer.id,
      true,
      {
        eta_minutes: 15,
        assigned_technician_name: 'Kamau Tech',
      },
      providerActor
    );
    assert.ok(assignment);

    // 4. Technician lifecycle: ACKNOWLEDGED -> EN_ROUTE -> ARRIVED -> IN_PROGRESS
    const ack = await roadsideService.updateAssignmentStatus(assignment.id, AssignmentStatus.ACKNOWLEDGED, undefined, providerActor);
    assert.equal(ack.status, AssignmentStatus.ACKNOWLEDGED);

    const enRoute = await roadsideService.updateAssignmentStatus(
      assignment.id,
      AssignmentStatus.EN_ROUTE,
      { latitude: -1.288, longitude: 36.819, eta_minutes: 10 },
      providerActor
    );
    assert.equal(enRoute.status, AssignmentStatus.EN_ROUTE);
    assert.ok(enRoute.en_route_at);

    // Check incident status tracks assignment
    let inc = roadsideRepository.getIncidentById(incidentAgg.incident.id);
    assert.equal(inc?.status, RoadsideIncidentStatus.EN_ROUTE);

    const arrived = await roadsideService.updateAssignmentStatus(
      assignment.id,
      AssignmentStatus.ARRIVED,
      { latitude: -1.29, longitude: 36.82 },
      providerActor
    );
    assert.equal(arrived.status, AssignmentStatus.ARRIVED);
    assert.ok(arrived.arrived_at);

    // 5. Complete Intervention: Battery Jump Start & Alternator test
    const interventionRes = await roadsideService.recordIntervention(
      assignment.id,
      {
        result: InterventionResult.REPAIRED_AND_DRIVABLE,
        summary_notes: '12V auxiliary battery jump-started and load tested. Drivable.',
        labor_duration_minutes: 25,
        final_drivability: DrivabilityState.DRIVABLE,
        odometer_reading_km: 18500,
        fee_minor: 350000,
        actions: [
          {
            action_type: InterventionActionType.BATTERY_BOOST,
            description: 'Applied 12V high-capacity booster pack',
            quantity: 1,
            cost_minor: 0,
          },
          {
            action_type: InterventionActionType.DIAGNOSTIC_SCAN,
            description: 'Cleared low-voltage battery DTC codes',
            quantity: 1,
            cost_minor: 0,
          },
        ],
      },
      providerActor
    );

    assert.equal(interventionRes.intervention.result, InterventionResult.REPAIRED_AND_DRIVABLE);
    assert.equal(interventionRes.intervention.final_drivability, DrivabilityState.DRIVABLE);

    // Assignment completed
    const finalAssign = roadsideRepository.getAssignmentById(assignment.id);
    assert.equal(finalAssign?.status, AssignmentStatus.COMPLETED);

    // Incident resolved
    inc = roadsideRepository.getIncidentById(incidentAgg.incident.id);
    assert.equal(inc?.status, RoadsideIncidentStatus.RESOLVED);
    assert.ok(inc?.resolved_at);

    // Vehicle Timeline projection check
    const timelineEntries = timelineRepository.getTimelineEntries(vehicleId).entries;
    const repairEntry = timelineEntries.find((e) => e.entry_type === 'REPAIR_COMPLETED');
    assert.ok(repairEntry, 'Timeline must project REPAIR_COMPLETED from roadside intervention');
    assert.equal(repairEntry?.odometer_value, 18500);
  });

  it('Scenario G: Non-drivable intervention resulting in Tow Handoff', async () => {
    // 1. Report collision / suspension collapse
    const incidentAgg = await roadsideService.reportIncident(
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.MECHANICAL_BREAKDOWN,
        description: 'Tie rod snapped, front wheel detached',
        location: { latitude: -1.3, longitude: 36.8 },
      },
      driverActor
    );

    const { offers } = await roadsideService.requestAssistance(incidentAgg.incident.id, undefined, driverActor);
    const { assignment } = await roadsideService.respondToOffer(offers[0].id, true, { eta_minutes: 10 }, providerActor);

    await roadsideService.updateAssignmentStatus(assignment!.id, AssignmentStatus.EN_ROUTE, undefined, providerActor);
    await roadsideService.updateAssignmentStatus(assignment!.id, AssignmentStatus.ARRIVED, undefined, providerActor);

    // Record intervention: Cannot repair roadside -> Tow recovery handoff
    const handoffRes = await roadsideService.recordIntervention(
      assignment!.id,
      {
        result: InterventionResult.CANNOT_REPAIR_TOW_REQUIRED,
        summary_notes: 'Severe steering linkage failure; cannot be repaired in field. Flatbed tow mandatory.',
        labor_duration_minutes: 20,
        final_drivability: DrivabilityState.DANGEROUS_TO_OPERATE,
        tow_required: true,
        tow_handoff: {
          destination_type: TowDestinationType.REPAIR_FACILITY,
          destination_name: 'Nairobi Central Service Workshop',
          destination_address: 'Baricho Road, Industrial Area',
          special_instructions: 'Handle with dollies; front left suspension collapsed',
        },
      },
      providerActor
    );

    assert.ok(handoffRes.tow_handoff);
    assert.equal(handoffRes.tow_handoff.destination_name, 'Nairobi Central Service Workshop');

    const inc = roadsideRepository.getIncidentById(incidentAgg.incident.id);
    assert.equal(inc?.status, RoadsideIncidentStatus.TOW_REQUIRED);

    // Check timeline entry projected TOW_COMPLETED
    const timelineEntries = timelineRepository.getTimelineEntries(vehicleId).entries;
    const towEntry = timelineEntries.find((e) => e.entry_type === 'TOW_COMPLETED');
    assert.ok(towEntry, 'Timeline must project TOW_COMPLETED when tow handoff occurs');
  });

  it('Scenario H & I: Cancellation policy, evidence and activity log', async () => {
    // 1. Report incident
    const incidentAgg = await roadsideService.reportIncident(
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.LOCKOUT,
        location: { latitude: -1.29, longitude: 36.82 },
      },
      driverActor
    );

    // 2. Add evidence photo
    const evidence = await roadsideService.addEvidence(
      incidentAgg.incident.id,
      {
        evidence_type: EvidenceType.SCENE_PHOTO,
        caption: 'Keys locked in boot',
        file_url: 'https://storage.garage-os.local/photos/lockout_keys.jpg',
      },
      driverActor
    );
    assert.equal(evidence.evidence_type, EvidenceType.SCENE_PHOTO);

    // 3. Request assistance & dispatch
    const { offers } = await roadsideService.requestAssistance(incidentAgg.incident.id, undefined, driverActor);
    const { assignment } = await roadsideService.respondToOffer(offers[0].id, true, { eta_minutes: 15 }, providerActor);

    // Move technician EN_ROUTE
    await roadsideService.updateAssignmentStatus(assignment!.id, AssignmentStatus.EN_ROUTE, undefined, providerActor);

    // Driver finds spare key and cancels while technician is EN_ROUTE
    const cancelled = await roadsideService.cancelIncident(
      incidentAgg.incident.id,
      {
        reason: 'Spare key retrieved by family member; no longer stranded',
        notes: 'Technician was already en route; cancellation callout fee applies',
      },
      driverActor
    );

    assert.equal(cancelled.status, RoadsideIncidentStatus.CANCELLED);
    assert.ok(cancelled.cancelled_at);

    // Check cancellation record has callout fee
    const cancellationRec = roadsideRepository.getCancellation(incidentAgg.incident.id);
    assert.ok(cancellationRec);
    assert.equal(cancellationRec.fee_incurred_minor, 200000); // 2,000 KES fee

    // Check assignment is also cancelled
    const assign = roadsideRepository.getAssignmentById(assignment!.id);
    assert.equal(assign?.status, AssignmentStatus.CANCELLED);

    // Check activity log contains entries
    const activityLog = roadsideRepository.getActivityLog(incidentAgg.incident.id);
    assert.ok(activityLog.length >= 4);
    const cancelActivity = activityLog.find((a) => a.activity_type === 'INCIDENT_CANCELLED');
    assert.ok(cancelActivity);
  });
});
