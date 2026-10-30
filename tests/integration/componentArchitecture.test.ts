import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { authService } from '../../src/server/identity/authService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { vehicleComponentService } from '../../src/server/components/componentService';
import { vehicleTyreService } from '../../src/server/components/tyreService';
import { componentRepository } from '../../src/server/components/componentRepository';
import {
  ComponentCategory,
  ComponentClassification,
  ComponentStatus,
  PartProvenance,
  PartVerificationStatus,
  RemovalReason,
  TyreConditionRating,
  TyrePosition,
  TyreRotationPattern,
  WarrantyType,
  WarrantyStatus,
} from '../../src/server/components/types';
import { AuthenticatedActorContext } from '../../src/server/identity/types';
import { FuelType, OdometerUnit } from '../../src/server/vehicle/types';

describe('Tyres, Parts, Components & Vehicle Configuration Architecture (GAR-010)', () => {
  let vehicleId: string;
  let ownerActor: AuthenticatedActorContext;
  let providerActor: AuthenticatedActorContext;
  let unauthorizedActor: AuthenticatedActorContext;

  beforeEach(() => {
    resetDatabaseInstance();
    const db = getDatabase({ memory: true });
    runMigrations(db);

    // Register owner
    const regOwner = authService.registerUser({
      email: 'owner@garageos.test',
      fullName: 'Jane Wambui',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regOwner.user.id);
    ownerActor = authService.getActorContextById(regOwner.user.id)!;

    // Register garage provider
    const regProvider = authService.registerUser({
      email: 'provider@garageos.test',
      fullName: 'Peter Mechanic',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regProvider.user.id);
    providerActor = authService.getActorContextById(regProvider.user.id)!;

    // Register unauthorized user (active account, but no relationship to vehicle)
    const regUnauth = authService.registerUser({
      email: 'other@garageos.test',
      fullName: 'Random User',
      password: 'SecurePassword123!',
    });
    db.prepare("UPDATE users SET account_status = 'ACTIVE' WHERE id = ?;").run(regUnauth.user.id);
    unauthorizedActor = authService.getActorContextById(regUnauth.user.id)!;

    // Create test vehicle
    const veh = vehicleService.createVehicle(ownerActor, {
      vin: 'JTEBH51J005999888',
      registration_number: 'KDA 123Z',
      make: 'Toyota',
      model: 'Land Cruiser Prado',
      model_year: 2021,
      fuel_type: FuelType.DIESEL,
      initial_odometer_value: 40000,
      initial_odometer_unit: OdometerUnit.KM,
    });
    vehicleId = veh.vehicle.id;
  });

  it('1. Installs a component with manufacturer warranty and verifies active status', () => {
    const installResult = vehicleComponentService.installComponent(ownerActor, {
      vehicle_id: vehicleId,
      category: ComponentCategory.BATTERY,
      classification: ComponentClassification.DURABLE_COMPONENT,
      custom_name: 'Bosch S5 A13 AGM Heavy Duty Battery 12V 95Ah',
      brand: 'Bosch',
      part_number: '0 092 S5A 130',
      serial_number: 'BSH-AGM-001',
      position: 'ENGINE_BAY',
      installed_at: '2025-09-10T10:00:00Z',
      installed_odometer_km: 42000,
      installation_source: PartProvenance.GARAGE_RECORDED,
      installation_provider_name: 'Nairobi Premier Auto Clinic',
      verification_status: PartVerificationStatus.PROVIDER_RECORDED,
      warranty: {
        warranty_type: WarrantyType.MANUFACTURER,
        starts_at: '2025-09-10T10:00:00Z',
        expires_at: '2027-09-10T10:00:00Z',
        distance_limit_km: 50000,
        terms_summary: '24 Months or 50,000 km full free replacement',
      },
    });

    assert.ok(installResult.component.id);
    assert.equal(installResult.component.status, ComponentStatus.INSTALLED);
    assert.equal(installResult.component.is_current, true);
    assert.equal(installResult.component.brand, 'Bosch');

    // Verify warranty was created
    assert.ok(installResult.warranty);
    assert.equal(installResult.warranty.status, WarrantyStatus.ACTIVE);
    assert.equal(installResult.warranty.vehicle_component_id, installResult.component.id);

    // Verify retrieval
    const activeComponents = vehicleComponentService.listComponents(ownerActor, vehicleId, { current_only: true });
    assert.equal(activeComponents.length, 1);
    assert.equal(activeComponents[0].id, installResult.component.id);
  });

  it('2. Replaces component, preserving chain of custody and marking old component REPLACED', () => {
    // Install initial component
    const oldComp = vehicleComponentService.installComponent(ownerActor, {
      vehicle_id: vehicleId,
      category: ComponentCategory.BRAKES,
      classification: ComponentClassification.WEAR_ITEM,
      custom_name: 'Factory Ceramic Front Brake Pads',
      brand: 'Toyota OEM',
      part_number: '04465-35290',
      position: 'FRONT_AXLE',
      installed_at: '2025-01-01T08:00:00Z',
      installed_odometer_km: 30000,
    }).component;

    // Replace with Brembo pads
    const replaceResult = vehicleComponentService.replaceComponent(ownerActor, {
      old_component_id: oldComp.id,
      reason: RemovalReason.WORN,
      notes: 'Brake pad thickness down to 2mm',
      replaced_at: '2025-10-15T12:00:00Z',
      odometer_km: 45000,
      new_component: {
        vehicle_id: vehicleId,
        category: ComponentCategory.BRAKES,
        classification: ComponentClassification.WEAR_ITEM,
        custom_name: 'Brembo Ceramic Front Brake Pads',
        brand: 'Brembo',
        part_number: 'P83024',
        position: 'FRONT_AXLE',
        installed_at: '2025-10-15T12:00:00Z',
        installed_odometer_km: 45000,
      },
    });

    // Check old component status
    const retrievedOld = componentRepository.findComponentById(oldComp.id);
    assert.ok(retrievedOld);
    assert.equal(retrievedOld.status, ComponentStatus.REPLACED);
    assert.equal(retrievedOld.is_current, false);
    assert.equal(retrievedOld.removed_odometer_km, 45000);
    assert.equal(retrievedOld.removal_reason, RemovalReason.WORN);

    // Check new component status
    assert.equal(replaceResult.new_component.status, ComponentStatus.INSTALLED);
    assert.equal(replaceResult.new_component.is_current, true);

    // Check replacement link
    assert.equal(replaceResult.replacement.old_component_id, oldComp.id);
    assert.equal(replaceResult.replacement.new_component_id, replaceResult.new_component.id);

    // Active list should have only the new one
    const activeList = vehicleComponentService.listComponents(ownerActor, vehicleId, { current_only: true });
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].id, replaceResult.new_component.id);

    // Full list should have both
    const allList = vehicleComponentService.listComponents(ownerActor, vehicleId, { current_only: false });
    assert.equal(allList.length, 2);
  });

  it('3. Removes component and verifies history remains intact', () => {
    const comp = vehicleComponentService.installComponent(ownerActor, {
      vehicle_id: vehicleId,
      category: ComponentCategory.ACCESSORY,
      classification: ComponentClassification.ACCESSORY,
      custom_name: 'Roof Cargo Basket',
      installed_at: '2025-03-01T10:00:00Z',
      installed_odometer_km: 35000,
    }).component;

    const removedComp = vehicleComponentService.removeComponent(ownerActor, {
      component_id: comp.id,
      reason: RemovalReason.UPGRADED,
      notes: 'Removed before selling accessory',
      removed_at: '2025-08-01T10:00:00Z',
      removed_odometer_km: 41000,
    });

    assert.equal(removedComp.status, ComponentStatus.REMOVED);
    assert.equal(removedComp.is_current, false);
    assert.equal(removedComp.removed_odometer_km, 41000);

    const activeList = vehicleComponentService.listComponents(ownerActor, vehicleId, { current_only: true });
    assert.equal(activeList.length, 0);
  });

  it('4. Installs a tyre, dual-creates component entity, and creates position assignment', () => {
    const tyreResult = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'BFGoodrich',
      model: 'All-Terrain T/A KO2',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      load_index: 116,
      speed_rating: 'S',
      position: TyrePosition.FRONT_LEFT,
      manufacture_dot_code: 'DOT BFG 4024',
      installed_at: '2025-08-14T14:30:00Z',
      installed_odometer_km: 42100,
    });

    assert.ok(tyreResult.tyre.id);
    assert.ok(tyreResult.tyre.vehicle_component_id);
    assert.equal(tyreResult.position_assignment.position, TyrePosition.FRONT_LEFT);
    assert.equal(tyreResult.position_assignment.is_current, true);

    // Verify dual component entity exists
    const comp = componentRepository.findComponentById(tyreResult.tyre.vehicle_component_id);
    assert.ok(comp);
    assert.equal(comp.category, ComponentCategory.TYRES);
    assert.equal(comp.position, TyrePosition.FRONT_LEFT);
  });

  it('5. Performs tyre rotation in atomic transaction and records rotation moves', () => {
    // Install 4 tyres
    const fl = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'Michelin',
      model: 'Primacy SUV',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      position: TyrePosition.FRONT_LEFT,
      installed_at: '2025-01-01T08:00:00Z',
      installed_odometer_km: 40000,
    }).tyre;

    const fr = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'Michelin',
      model: 'Primacy SUV',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      position: TyrePosition.FRONT_RIGHT,
      installed_at: '2025-01-01T08:00:00Z',
      installed_odometer_km: 40000,
    }).tyre;

    const rl = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'Michelin',
      model: 'Primacy SUV',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      position: TyrePosition.REAR_LEFT,
      installed_at: '2025-01-01T08:00:00Z',
      installed_odometer_km: 40000,
    }).tyre;

    const rr = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'Michelin',
      model: 'Primacy SUV',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      position: TyrePosition.REAR_RIGHT,
      installed_at: '2025-01-01T08:00:00Z',
      installed_odometer_km: 40000,
    }).tyre;

    // Rotate tyres (Forward Cross pattern: Fronts go straight back, Rears cross to front)
    const rotResult = vehicleTyreService.rotateTyres(ownerActor, {
      vehicle_id: vehicleId,
      pattern: TyreRotationPattern.FORWARD_CROSS,
      performed_at: '2025-07-01T10:00:00Z',
      odometer_km: 48000,
      notes: '8,000 km standard tyre rotation',
      moves: [
        { vehicle_tyre_id: fl.id, from_position: TyrePosition.FRONT_LEFT, to_position: TyrePosition.REAR_LEFT },
        { vehicle_tyre_id: fr.id, from_position: TyrePosition.FRONT_RIGHT, to_position: TyrePosition.REAR_RIGHT },
        { vehicle_tyre_id: rl.id, from_position: TyrePosition.REAR_LEFT, to_position: TyrePosition.FRONT_RIGHT },
        { vehicle_tyre_id: rr.id, from_position: TyrePosition.REAR_RIGHT, to_position: TyrePosition.FRONT_LEFT },
      ],
    });

    assert.ok(rotResult.id);
    assert.equal(rotResult.moves.length, 4);

    // Verify current positions
    const currentPositions = componentRepository.findCurrentTyrePositions(vehicleId);
    const flAssignment = currentPositions.find((p) => p.vehicle_tyre_id === fl.id);
    const rrAssignment = currentPositions.find((p) => p.vehicle_tyre_id === rr.id);

    assert.ok(flAssignment);
    assert.equal(flAssignment.position, TyrePosition.REAR_LEFT);

    assert.ok(rrAssignment);
    assert.equal(rrAssignment.position, TyrePosition.FRONT_LEFT);

    // Verify history for fl tyre
    const flHistory = componentRepository.findPositionHistoryByTyreId(fl.id);
    assert.equal(flHistory.length, 2);
    // Previous position has ended_at set
    const previous = flHistory.find((h) => h.position === TyrePosition.FRONT_LEFT);
    assert.ok(previous?.ended_at);
    assert.equal(previous?.is_current, false);
  });

  it('6. Records tyre inspection measurements', () => {
    const tyre = vehicleTyreService.installTyre(ownerActor, {
      vehicle_id: vehicleId,
      brand: 'Continental',
      model: 'CrossContact AX6',
      size_raw: '265/65 R17',
      width: 265,
      aspect_ratio: 65,
      rim_diameter: 17,
      position: TyrePosition.FRONT_LEFT,
    }).tyre;

    const insp = vehicleTyreService.inspectTyre(ownerActor, {
      vehicle_tyre_id: tyre.id,
      tread_depth_outer_mm: 7.5,
      tread_depth_center_mm: 7.8,
      tread_depth_inner_mm: 7.4,
      pressure_psi: 33.5,
      condition_rating: TyreConditionRating.GOOD,
      observed_at: '2025-08-01T09:00:00Z',
      notes: 'Normal road wear, no sidewall cuts',
    });

    assert.ok(insp.id);
    assert.equal(insp.vehicle_tyre_id, tyre.id);
    assert.equal(insp.tread_depth_center_mm, 7.8);
    assert.equal(insp.condition_rating, TyreConditionRating.GOOD);

    const inspections = componentRepository.findInspectionsByTyreId(tyre.id);
    assert.equal(inspections.length, 1);
  });

  it('7. Records vehicle modification and configuration override', () => {
    const modResult = vehicleComponentService.recordModification(ownerActor, {
      vehicle_id: vehicleId,
      category: 'INFOTAINMENT',
      name: 'Android Touchscreen Head Unit',
      description: '10.25-inch IPS display with Apple CarPlay',
      installed_at: '2025-06-01T10:00:00Z',
      odometer_km: 41000,
      overrides: [
        {
          attribute_key: 'infotainment_screen_size',
          original_value: '7.0 inch factory display',
          current_value: '10.25 inch HD touchscreen',
          source_reference: 'Aftermarket upgrade',
        },
      ],
    });

    assert.ok(modResult.id);
    assert.equal(modResult.name, 'Android Touchscreen Head Unit');
    assert.equal(modResult.overrides.length, 1);
    assert.equal(modResult.overrides[0].attribute_key, 'infotainment_screen_size');

    // Query overrides for vehicle
    const overrides = componentRepository.findOverridesByVehicleId(vehicleId);
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0].current_value, '10.25 inch HD touchscreen');
  });

  it('8. Enforces authorization and prevents unauthorized user mutations (IDOR protection)', () => {
    // Unauthorized actor should be rejected when trying to install a component
    assert.throws(
      () => {
        vehicleComponentService.installComponent(unauthorizedActor, {
          vehicle_id: vehicleId,
          category: ComponentCategory.ENGINE,
          custom_name: 'Unauthorized Alternator',
        });
      },
      (err: any) => {
        return err.statusCode === 403 || err.code === 'PERMISSION_DENIED';
      }
    );

    // Unauthorized actor should be rejected when trying to rotate tyres
    assert.throws(
      () => {
        vehicleTyreService.rotateTyres(unauthorizedActor, {
          vehicle_id: vehicleId,
          pattern: TyreRotationPattern.FRONT_TO_REAR,
          moves: [],
        });
      },
      (err: any) => {
        return err.statusCode === 403 || err.code === 'PERMISSION_DENIED';
      }
    );
  });
});
