/**
 * Sprint 13 Comprehensive Verification & Integration Test Suite
 * Primary Specification: GAR-015 — Towing & Recovery Architecture
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { roadsideService } from '../../src/server/roadside/roadsideService';
import { roadsideRepository } from '../../src/server/roadside/roadsideRepository';
import { towingService } from '../../src/server/towing/towingService';
import { towingRepository } from '../../src/server/towing/towingRepository';
import { TowingCompatibilityEngine } from '../../src/server/towing/compatibilityEngine';
import { timelineProjector } from '../../src/server/timeline/timelineProjector';
import { timelineRepository } from '../../src/server/timeline/timelineRepository';
import {
  TowRequestStatus,
  TowOfferStatus,
  TowAssignmentStatus,
  RecoveryUnitStatus,
  TowReason,
  RecoveryType,
  VehicleMobilityState,
  VehicleConditionState,
  TowDestinationType,
  RecoveryUnitType,
  EquipmentType,
  TowVehicleClass,
  TowCustodyEventType,
  TowDeliveryRecipientType,
  TowDeliveryAcknowledgementMethod,
  TowFailureType,
} from '../../src/server/towing/types';
import {
  RoadsideIncidentStatus,
  IncidentSeverity,
  IncidentType,
  DrivabilityState,
  OccupantSafetyState,
  AssistanceType,
  InterventionResult,
} from '../../src/server/roadside/types';
import { FuelType, TransmissionType, VehicleType, DriveType } from '../../src/server/vehicle/types';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

describe('Towing & Recovery Architecture (GAR-015)', () => {
  let db: any;
  let driverUser: any;
  let driverActor: any;
  let vehicleId: string;
  let providerAId: string;
  let providerBId: string;
  let flatbedUnitAId: string;
  let wheelLiftUnitBId: string;

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);
    timelineProjector.initialize();

    // 1. Create stranded vehicle owner
    const authDriver = authService.registerUser({
      email: 'driver.towing@garage-os.local',
      fullName: 'David Kiprono',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?").run(authDriver.user.id);
    driverUser = authDriver.user;
    driverActor = authService.getActorContextById(driverUser.id)!;
    driverActor.phone = '+254711223344';

    // 2. Register Electric AWD Vehicle (requires Flatbed or Dollies)
    const veh = vehicleService.createVehicle(
      driverActor,
      {
        vin: 'KMHD84LF7JU123456',
        make: 'Hyundai',
        model: 'Ioniq 5 AWD',
        model_year: 2023,
        vehicle_type: VehicleType.SUV,
        fuel_type: FuelType.ELECTRIC,
        transmission: TransmissionType.AUTOMATIC,
        drive_type: DriveType.AWD,
      }
    );
    vehicleId = veh.vehicle.id;

    // 3. Create Towing Provider A (Nairobi Heavy Recovery - with Flatbed)
    providerAId = 'srv_tow_provider_a';
    db.prepare(`
      INSERT INTO organizations (id, organization_type, name, status, created_at, updated_at)
      VALUES ('org_tow_a', 'AUTOMOTIVE_SERVICE_PROVIDER', 'Nairobi Recovery Org', 'ACTIVE', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO service_providers (
        id, organization_id, name, legal_business_name, provider_type,
        status, verification_status, accepts_bookings, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs,
        service_radius_km, currency, created_at, updated_at
      ) VALUES (
        ?, 'org_tow_a', 'Nairobi Heavy Recovery', 'Nairobi Recovery Ltd', 'TOWING_RECOVERY',
        'ACTIVE', 'VERIFIED', 1, 1, 1, 1,
        50.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `).run(providerAId);

    db.prepare(`
      INSERT INTO provider_locations (
        id, provider_id, name, location_type, address_line1, city, county_state, postal_code, country, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (
        'prvloc_tow_a', ?, 'Depot A', 'TOW_YARD', 'Commercial St', 'Nairobi', 'Nairobi', '00100', 'KE', -1.3000, 36.8200, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `).run(providerAId);

    // Register Flatbed Unit for Provider A
    const unitA = towingService.registerRecoveryUnit(providerAId, {
      unit_type: RecoveryUnitType.FLATBED,
      registration_identifier: 'KDA 111A',
      fleet_identifier: 'TOW-A-FLATBED',
      max_vehicle_weight_kg: 5000,
      max_vehicle_length_mm: 6500,
      max_vehicle_width_mm: 2300,
      equipment: [
        { equipment_type: EquipmentType.HYDRAULIC_TILT_TRAY, rating_capacity_kg: 5500 },
        { equipment_type: EquipmentType.WINCH, rating_capacity_kg: 7000 },
        { equipment_type: EquipmentType.SOFT_STRAPS, rating_capacity_kg: 5000 },
      ],
      supported_classes: [TowVehicleClass.PASSENGER_CAR, TowVehicleClass.SUV_CROSSOVER],
    });
    flatbedUnitAId = unitA.id;

    // 4. Create Towing Provider B (Quick Lift Towing - with standard Wheel Lift without dollies)
    providerBId = 'srv_tow_provider_b';
    db.prepare(`
      INSERT INTO organizations (id, organization_type, name, status, created_at, updated_at)
      VALUES ('org_tow_b', 'AUTOMOTIVE_SERVICE_PROVIDER', 'Quick Lift Org', 'ACTIVE', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO service_providers (
        id, organization_id, name, legal_business_name, provider_type,
        status, verification_status, accepts_bookings, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs,
        service_radius_km, currency, created_at, updated_at
      ) VALUES (
        ?, 'org_tow_b', 'Quick Lift Towing', 'Quick Lift Ltd', 'TOWING_RECOVERY',
        'ACTIVE', 'VERIFIED', 1, 1, 1, 1,
        40.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `).run(providerBId);

    db.prepare(`
      INSERT INTO provider_locations (
        id, provider_id, name, location_type, address_line1, city, county_state, postal_code, country, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (
        'prvloc_tow_b', ?, 'Depot B', 'TOW_YARD', 'Mombasa Rd', 'Nairobi', 'Nairobi', '00100', 'KE', -1.3100, 36.8300, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `).run(providerBId);

    const unitB = towingService.registerRecoveryUnit(providerBId, {
      unit_type: RecoveryUnitType.WHEEL_LIFT,
      registration_identifier: 'KDB 222B',
      fleet_identifier: 'TOW-B-LIFT',
      max_vehicle_weight_kg: 3000,
      max_vehicle_length_mm: 5000,
      max_vehicle_width_mm: 2000,
      equipment: [
        { equipment_type: EquipmentType.WHEEL_LIFT, rating_capacity_kg: 3000 },
      ],
      supported_classes: [TowVehicleClass.PASSENGER_CAR, TowVehicleClass.SUV_CROSSOVER],
    });
    wheelLiftUnitBId = unitB.id;
  });

  it('1. Compatibility Engine strictly rejects AWD EV towing on wheel-lift without dollies', () => {
    const vehicleData = {
      fuel_type: FuelType.ELECTRIC,
      drive_type: DriveType.AWD,
      transmission: TransmissionType.AUTOMATIC,
      mobility_state: VehicleMobilityState.NON_ROLLING,
      recovery_type: RecoveryType.ACCIDENT_TOW,
    };

    const unitB = towingRepository.getRecoveryUnitById(wheelLiftUnitBId)!;
    const equipB = towingRepository.listUnitEquipment(wheelLiftUnitBId);
    const classesB = towingRepository.listUnitSupportedClasses(wheelLiftUnitBId);

    const evalB = TowingCompatibilityEngine.evaluate(vehicleData, unitB, equipB, classesB);
    assert.equal(evalB.compatible, false, 'Wheel-lift without dollies must not tow an AWD EV');
    assert.ok(
      evalB.reasons.some(r => r.includes('AWD') || r.includes('Electric') || r.includes('dollies')),
      'Should mention AWD / EV / dollies incompatibility'
    );

    // Conversely, flatbed must be compatible
    const unitA = towingRepository.getRecoveryUnitById(flatbedUnitAId)!;
    const equipA = towingRepository.listUnitEquipment(flatbedUnitAId);
    const classesA = towingRepository.listUnitSupportedClasses(flatbedUnitAId);

    const evalA = TowingCompatibilityEngine.evaluate(vehicleData, unitA, equipA, classesA);
    assert.equal(evalA.compatible, true, 'Flatbed with winch must be compatible with AWD non-rolling EV');
  });

  it('2. End-to-end standalone tow request lifecycle with matching, offer, transit & delivery', async () => {
    // A. Create Standalone Tow Request
    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id: vehicleId,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.MECHANICAL_BREAKDOWN,
        recovery_type: RecoveryType.STANDARD_TOW,
        vehicle_mobility_state: VehicleMobilityState.ROLLING,
        vehicle_condition_state: VehicleConditionState.OPERATIONAL_STEERING,
        pickup_location: {
          address_summary: 'Uhuru Highway near Nyayo Roundabout',
          latitude: -1.2950,
          longitude: 36.8150,
          location_type: 'ROAD_SHOULDER',
        },
        destination: {
          destination_type: TowDestinationType.GARAGE,
          address_summary: 'Central Workshop, Enterprise Rd',
          latitude: -1.3032,
          longitude: 36.8263,
          contact_name: 'Workshop Foreman',
        },
      },
      driverActor
    );

    assert.ok(aggregate.request.id.startsWith('tow_'));
    assert.ok(aggregate.request.sequence_number.startsWith('TOW-'));
    assert.equal(aggregate.request.status, TowRequestStatus.PENDING_DISPATCH);

    // B. Verify Provider A received offer (compatible flatbed within radius)
    const offers = towingRepository.listOffersForRequest(aggregate.request.id);
    assert.ok(offers.length > 0, 'Offers should be generated for compatible providers');
    const offerA = offers.find(o => o.provider_id === providerAId);
    assert.ok(offerA, 'Provider A must have received an offer');
    assert.equal(offerA!.status, TowOfferStatus.OFFERED);
    assert.equal(
      offerA!.estimated_price_minor,
      null,
      'Haversine/static matching must not manufacture a tow price'
    );

    // C. Provider A accepts offer
    const assignment = await towingService.acceptOffer(
      {
        offer_id: offerA!.id,
        provider_id: providerAId,
        operator_name: 'John Operator',
        operator_phone: '+254700111222',
      },
      { id: 'usr_operator_a', roles: ['TOW_OPERATOR'] }
    );

    assert.equal(assignment.status, TowAssignmentStatus.ACCEPTED);
    assert.equal(assignment.recovery_unit_id, flatbedUnitAId);

    // Verify recovery unit is marked EN_ROUTE
    const assignedUnit = towingRepository.getRecoveryUnitById(flatbedUnitAId)!;
    assert.equal(assignedUnit.status, RecoveryUnitStatus.EN_ROUTE);

    // D. Operator moves EN_ROUTE -> ARRIVED_AT_PICKUP
    await towingService.markEnRoute(assignment.id, providerAId);
    const arrived = await towingService.arrivePickup(assignment.id, providerAId);
    assert.equal(arrived.status, TowAssignmentStatus.ARRIVED_AT_PICKUP);

    // E. Pre-tow inspection & evidence
    const inspection = await towingService.recordPickupInspection(
      {
        assignment_id: assignment.id,
        provider_id: providerAId,
        vehicle_condition_summary: 'Front bumper scratched, steering functioning',
        visible_damage: ['Scratch on front left bumper corner'],
        mobility_state_confirmed: VehicleMobilityState.ROLLING,
        odometer_reading_km: 45200,
        evidence: [
          { evidence_type: 'PHOTO_FRONT', file_url: 'https://cdn.garageos.ke/tow/insp_front.jpg' },
        ],
      },
      { id: 'usr_operator_a', roles: ['TOW_OPERATOR'] }
    );
    assert.ok(inspection.id.startsWith('tpi_'));

    // F. Critical Truth Rule: Attempting startTransit BEFORE loading MUST throw CONFLICT
    await assert.rejects(
      async () => {
        await towingService.startTransit(assignment.id, providerAId);
      },
      (err: any) => {
        assert.equal(err.code, ErrorCode.CONFLICT);
        assert.ok(err.message.includes('VEHICLE_LOADED'));
        return true;
      },
      'Starting transit before vehicle is confirmed loaded must fail with CONFLICT'
    );

    // G. Load vehicle & transfer custody
    await towingService.startLoading(assignment.id, providerAId);
    const loadedAssignment = await towingService.confirmVehicleLoaded(assignment.id, providerAId);
    assert.equal(loadedAssignment.status, TowAssignmentStatus.VEHICLE_LOADED);

    // Verify custody event was recorded for loading
    const custodyEvents = towingRepository.listCustodyEvents(assignment.id);
    assert.ok(
      custodyEvents.some(e => e.event_type === TowCustodyEventType.VEHICLE_LOADED),
      'Must record VEHICLE_LOADED custody event'
    );

    // H. Now start transit (Critical Truth: truth matches state)
    const inTransit = await towingService.startTransit(assignment.id, providerAId);
    assert.equal(inTransit.status, TowAssignmentStatus.IN_TRANSIT);

    // Verify Tow Request is IN_TRANSIT
    const reqInTransit = towingRepository.getTowRequestById(aggregate.request.id)!;
    assert.equal(reqInTransit.status, TowRequestStatus.IN_TRANSIT);

    // I. Arrive at destination -> Unload -> Confirm Delivery
    await towingService.arriveDestination(assignment.id, providerAId);
    await towingService.startUnloading(assignment.id, providerAId);

    const deliveryAggregate = await towingService.confirmDelivery(
      {
        assignment_id: assignment.id,
        provider_id: providerAId,
        recipient_type: TowDeliveryRecipientType.GARAGE_STAFF,
        recipient_name: 'James Workshop Manager',
        recipient_signature_reference: 'sig_ref_892348',
        condition_summary: 'Vehicle unloaded in same condition as pickup',
        acknowledgement_method: TowDeliveryAcknowledgementMethod.PHYSICAL_SIGNATURE,
      },
      { id: 'usr_operator_a', roles: ['TOW_OPERATOR'] }
    );

    assert.equal(deliveryAggregate.request.status, TowRequestStatus.COMPLETED);
    assert.equal(deliveryAggregate.assignment?.status, TowAssignmentStatus.COMPLETED);

    // J. Recovery Unit is released back to AVAILABLE
    const releasedUnit = towingRepository.getRecoveryUnitById(flatbedUnitAId)!;
    assert.equal(releasedUnit.status, RecoveryUnitStatus.AVAILABLE);

    // K. Verify Chain of Custody has full audit trail
    const finalCustody = towingRepository.listCustodyEvents(assignment.id);
    assert.equal(finalCustody.length >= 3, true);
    assert.ok(finalCustody.some(e => e.event_type === TowCustodyEventType.VEHICLE_HANDOVER_CONFIRMED));

    // L. Verify Digital Passport & Vehicle Timeline Projection
    const timelineEntries = timelineRepository.listTimelineEntries(vehicleId);
    const towTimelineEntry = timelineEntries.find(t => t.entry_type === 'TOW_COMPLETED');
    assert.ok(towTimelineEntry, 'Tow completion must be projected onto vehicle timeline');
    assert.equal(towTimelineEntry!.odometer_value, 45200);
  });

  it('3. Roadside to Towing Handoff integration creates linked TowRequest', async () => {
    // 1. Create Roadside Incident
    const incident = await roadsideService.createIncident(
      driverActor,
      {
        vehicle_id: vehicleId,
        incident_type: IncidentType.ENGINE_FAILURE,
        reported_severity: IncidentSeverity.SEVERE,
        drivability: DrivabilityState.IMMOBILE,
        occupant_safety: OccupantSafetyState.SAFE_ROAD_SHOULDER,
        location: {
          address: 'Waiyaki Way, Westlands',
          latitude: -1.2650,
          longitude: 36.8050,
        },
      }
    );

    // 2. Dispatch technician & record roadside intervention with tow handoff
    const technician = roadsideRepository.createTechnician({
      id: 'tech_handoff_01',
      provider_id: providerAId,
      full_name: 'Sam Roadside Tech',
      phone: '+254711999000',
      status: 'AVAILABLE',
      current_latitude: -1.2650,
      current_longitude: 36.8050,
      last_location_update_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const assignment = roadsideRepository.createAssignment({
      id: 'asg_roadside_tow_01',
      incident_id: incident.id,
      provider_id: providerAId,
      technician_id: technician.id,
      status: 'ON_SITE',
      assigned_at: new Date().toISOString(),
      dispatched_at: new Date().toISOString(),
      arrived_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Record intervention that requires tow
    await roadsideService.recordIntervention(
      assignment.id,
      {
        result: InterventionResult.TOW_REQUIRED,
        summary_notes: 'Engine seized, unable to repair on roadside',
        final_drivability: DrivabilityState.IMMOBILE,
        tow_required: true,
        tow_handoff: {
          reason: 'Severe internal mechanical failure',
          recommended_vehicle_condition: 'OPERATIONAL_STEERING',
          preferred_destination: {
            destination_type: 'GARAGE',
            address: 'Industrial Area Auto Clinic',
            latitude: -1.3032,
            longitude: 36.8263,
          },
        },
      },
      driverActor
    );

    // 3. Initiate Tow Request from Roadside Handoff
    const towAggregate = await towingService.createFromRoadsideHandoff(
      {
        incident_id: incident.id,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.MECHANICAL_BREAKDOWN,
        destination: {
          destination_type: TowDestinationType.GARAGE,
          address_summary: 'Industrial Area Auto Clinic',
          latitude: -1.3032,
          longitude: 36.8263,
        },
      },
      driverActor
    );

    assert.ok(towAggregate.request.id.startsWith('tow_'));
    assert.equal(towAggregate.request.created_from_roadside_incident_id, incident.id);
    assert.equal(towAggregate.request.vehicle_mobility_state, VehicleMobilityState.ROLLING);
    assert.equal(towAggregate.destination?.address_summary, 'Industrial Area Auto Clinic');
  });

  it('4. Concurrency Guard prevents multiple providers from claiming the same tow job', async () => {
    // 1. Create Tow Request with multiple compatible offers
    // Add flatbed for provider B so B is also compatible
    towingRepository.createRecoveryUnitEquipment({
      id: 'rue_b_fb',
      recovery_unit_id: wheelLiftUnitBId,
      equipment_type: EquipmentType.TOW_DOLLIES,
      rating_capacity_kg: 2500,
      is_operational: true,
      created_at: new Date().toISOString(),
    });

    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id: vehicleId,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.FLAT_TYRE,
        recovery_type: RecoveryType.STANDARD_TOW,
        vehicle_mobility_state: VehicleMobilityState.ROLLING,
        pickup_location: {
          address_summary: 'Mombasa Road',
          latitude: -1.3080,
          longitude: 36.8250,
        },
        destination: {
          destination_type: TowDestinationType.OWNER_HOME,
          address_summary: 'Home, Nairobi West',
        },
      },
      driverActor
    );

    const offers = towingRepository.listOffersForRequest(aggregate.request.id);
    const offerA = offers.find(o => o.provider_id === providerAId);
    const offerB = offers.find(o => o.provider_id === providerBId);

    assert.ok(offerA && offerB, 'Both providers must have received offers');

    // Provider A accepts
    await towingService.acceptOffer(
      {
        offer_id: offerA!.id,
        provider_id: providerAId,
        operator_name: 'Driver A',
      },
      { id: 'usr_op_a', roles: ['TOW_OPERATOR'] }
    );

    // Provider B attempts to accept the already-assigned request
    await assert.rejects(
      async () => {
        await towingService.acceptOffer(
          {
            offer_id: offerB!.id,
            provider_id: providerBId,
            operator_name: 'Driver B',
          },
          { id: 'usr_op_b', roles: ['TOW_OPERATOR'] }
        );
      },
      (err: any) => {
        assert.equal(err.code, ErrorCode.CONFLICT);
        assert.ok(err.message.includes('already been assigned') || err.message.includes('expired'));
        return true;
      },
      'Second provider acceptance must be rejected with 409 CONFLICT'
    );
  });

  it('5. Destination revision preserves audit trail and increments revision count', async () => {
    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id: vehicleId,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.ACCIDENT_DAMAGE,
        recovery_type: RecoveryType.ACCIDENT_TOW,
        vehicle_mobility_state: VehicleMobilityState.NON_ROLLING,
        pickup_location: {
          address_summary: 'Langata Road near Galleria',
          latitude: -1.3500,
          longitude: 36.7600,
        },
        destination: {
          destination_type: TowDestinationType.GARAGE,
          address_summary: 'Karen Auto Workshop',
          latitude: -1.3200,
          longitude: 36.7100,
        },
      },
      driverActor
    );

    assert.equal(aggregate.destination?.revision_number, 1);

    // Update destination (e.g. Owner changes mind or garage is full)
    const updatedDest = await towingService.updateDestination(
      aggregate.request.id,
      {
        destination_type: TowDestinationType.INSURANCE_ASSESSMENT_CENTER,
        address_summary: 'Heritage Insurance Assessment Depot, Industrial Area',
        latitude: -1.3050,
        longitude: 36.8300,
        reason: 'Insurance directed vehicle to approved inspection center',
      },
      driverActor
    );

    assert.equal(updatedDest.revision_number, 2);
    assert.equal(updatedDest.destination_type, TowDestinationType.INSURANCE_ASSESSMENT_CENTER);
    assert.equal(updatedDest.address_summary, 'Heritage Insurance Assessment Depot, Industrial Area');

    // Check revision history record
    const revisions = towingRepository.listDestinationRevisions(aggregate.destination!.id);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].prior_address_summary, 'Karen Auto Workshop');
    assert.equal(revisions[0].change_reason, 'Insurance directed vehicle to approved inspection center');
  });

  it('6. Location Privacy & Scoping: unassigned actors receive obfuscated coordinates', async () => {
    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id: vehicleId,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.MECHANICAL_BREAKDOWN,
        recovery_type: RecoveryType.STANDARD_TOW,
        vehicle_mobility_state: VehicleMobilityState.ROLLING,
        pickup_location: {
          address_summary: 'Specific Private Residence, Gate 4B, Karen',
          latitude: -1.321456,
          longitude: 36.712389,
          access_instructions: 'Gate code 4492, beware of dog',
        },
        destination: {
          destination_type: TowDestinationType.GARAGE,
          address_summary: 'Central Garage',
          latitude: -1.3000,
          longitude: 36.8200,
        },
      },
      driverActor
    );

    // Case A: Fetched by vehicle owner -> Exact coordinates and access instructions
    const ownerView = towingService.getTowRequestById(aggregate.request.id, driverActor);
    assert.equal(ownerView?.pickup_location.latitude, -1.321456);
    assert.equal(ownerView?.pickup_location.access_instructions, 'Gate code 4492, beware of dog');

    // Case B: Fetched by unassigned stranger / competitor provider -> Obfuscated coordinates & stripped instructions
    const unassignedActor = {
      id: 'usr_unassigned_stranger',
      roles: ['TOW_OPERATOR'],
      provider_id: 'srv_other_random_provider',
    };
    const publicView = towingService.getTowRequestById(aggregate.request.id, unassignedActor);
    assert.ok(publicView);
    assert.equal(publicView?.pickup_location.access_instructions, undefined, 'Access instructions must be stripped');
    // Obfuscated coordinates should be rounded to 2 decimal places (~1.1km privacy blur)
    assert.equal(publicView?.pickup_location.latitude, -1.32);
    assert.equal(publicView?.pickup_location.longitude, 36.71);
  });

  it('7. Structured loading failure recording transitions assignment cleanly', async () => {
    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id: vehicleId,
        requesting_user_id: driverActor.id,
        tow_reason: TowReason.DITCH_RECOVERY,
        recovery_type: RecoveryType.WINCH_OUT,
        vehicle_mobility_state: VehicleMobilityState.NON_ROLLING,
        pickup_location: {
          address_summary: 'Southern Bypass embankment',
          latitude: -1.3300,
          longitude: 36.7700,
        },
        destination: {
          destination_type: TowDestinationType.GARAGE,
          address_summary: 'Nairobi Garage',
        },
      },
      driverActor
    );

    const offers = towingRepository.listOffersForRequest(aggregate.request.id);
    const offerA = offers.find(o => o.provider_id === providerAId)!;
    const assignment = await towingService.acceptOffer(
      { offer_id: offerA.id, provider_id: providerAId },
      { id: 'usr_op_a' }
    );

    await towingService.markEnRoute(assignment.id, providerAId);
    await towingService.arrivePickup(assignment.id, providerAId);
    await towingService.startLoading(assignment.id, providerAId);

    // Operator discovers vehicle cannot be recovered without heavy crane / rotator
    const failure = await towingService.recordLoadingFailure(
      {
        assignment_id: assignment.id,
        provider_id: providerAId,
        failure_type: TowFailureType.PHYSICAL_OBSTRUCTION_BLOCKED,
        description: 'Vehicle wedged behind high concrete barrier requiring crane rotator',
        recoverable: true,
      },
      { id: 'usr_op_a' }
    );

    assert.equal(failure.failure_type, TowFailureType.PHYSICAL_OBSTRUCTION_BLOCKED);
    assert.equal(failure.recoverable, true);

    const updatedAssignment = towingRepository.getAssignmentById(assignment.id)!;
    assert.equal(updatedAssignment.status, TowAssignmentStatus.LOADING_FAILED);

    const updatedReq = towingRepository.getTowRequestById(aggregate.request.id)!;
    assert.equal(updatedReq.status, TowRequestStatus.RECOVERY_FAILED);
  });
});
