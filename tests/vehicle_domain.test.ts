/**
 * Canonical Vehicle Domain Kernel Tests (GAR-004, GAR-033 §12A, GAR-034)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/server/database/migrations';
import { setDatabaseForTesting } from '../src/server/database/connection';
import { vehicleService } from '../src/server/vehicle/vehicleService';
import { vehicleRepository } from '../src/server/vehicle/vehicleRepository';
import {
  VehicleStatus,
  VehicleType,
  FuelType,
  TransmissionType,
  OdometerUnit,
  OdometerObservationStatus,
  VehicleRelationshipType,
} from '../src/server/vehicle/types';
import {
  normalizeVin,
  isValidStandardVin,
  normalizeRegistrationNumber,
  normalizeDistanceToKm,
  convertDistanceFromKm,
  formatVehicleDisplayName,
} from '../src/server/vehicle/normalizer';
import { authService } from '../src/server/identity/authService';
import { AuthenticatedActorContext, AccountStatus } from '../src/server/identity/types';
import { CanonicalAppError } from '../src/shared/errors';

describe('Vehicle Domain Kernel (GAR-004)', () => {
  let db: DatabaseSync;
  let ownerActor: AuthenticatedActorContext;
  let otherActor: AuthenticatedActorContext;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    setDatabaseForTesting(db);
    runMigrations(db);
    // Create distinct test actors
    const owner = authService.registerUser({
      email: `owner_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`,
      fullName: 'David Mwangi',
      password: 'StrongPassw0rd!2026',
    });

    const other = authService.registerUser({
      email: `other_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`,
      fullName: 'Alice Chemutai',
      password: 'StrongPassw0rd!2026',
    });

    ownerActor = authService.getActorContextById(owner.user.id)!;
    otherActor = authService.getActorContextById(other.user.id)!;
  });

  test('normalizer utilities correctly format and validate automotive primitives', () => {
    // VIN normalization & validation
    assert.equal(normalizeVin(' jte-bh51j-005123456 '), 'JTEBH51J005123456');
    assert.equal(isValidStandardVin('JTEBH51J005123456'), true);
    assert.equal(isValidStandardVin('INVALID_I_VIN1234'), false); // 'I' is illegal in ISO 3779

    // Registration number normalization
    assert.equal(normalizeRegistrationNumber('kda789x', 'KE'), 'KDA 789X');
    assert.equal(normalizeRegistrationNumber('  kda  789x  ', 'KE'), 'KDA 789X');

    // Distance conversion
    assert.equal(normalizeDistanceToKm(100, OdometerUnit.KM), 100);
    assert.equal(normalizeDistanceToKm(100, OdometerUnit.MILES), 160.9);
    assert.equal(convertDistanceFromKm(160.9, OdometerUnit.MILES), 100);

    // Display name
    assert.equal(
      formatVehicleDisplayName('Toyota', 'Land Cruiser Prado', 2021, 'TX-L'),
      '2021 Toyota Land Cruiser Prado TX-L'
    );
  });

  test('creates a vehicle aggregate root with initial identifiers, owner relationship, and odometer', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Toyota',
      model: 'Land Cruiser Prado',
      model_year: 2022,
      trim: 'TX-L 2.8L',
      vin: 'JTEBH51J005999888',
      registration_number: 'KDA 999Z',
      fuel_type: FuelType.DIESEL,
      transmission: TransmissionType.AUTOMATIC,
      initial_odometer_value: 45000,
      initial_odometer_unit: OdometerUnit.KM,
    });

    assert.ok(created.vehicle.id.startsWith('veh_'));
    assert.equal(created.vehicle.make, 'Toyota');
    assert.equal(created.vehicle.model, 'Land Cruiser Prado');
    assert.equal(created.vehicle.model_year, 2022);
    assert.equal(created.vehicle.current_odometer_cache, 45000);
    assert.equal(created.vehicle.status, VehicleStatus.ACTIVE);

    // Verify identifiers created
    assert.equal(created.identifiers.length, 2);
    const vinIdent = created.identifiers.find((i) => i.type === 'VIN');
    assert.ok(vinIdent);
    assert.equal(vinIdent.normalized_value, 'JTEBH51J005999888');

    // Verify ownership relationship
    assert.ok(created.user_relationship);
    assert.equal(created.user_relationship.user_id, ownerActor.user_id);
    assert.equal(created.user_relationship.relationship_type, VehicleRelationshipType.OWNER);
    assert.equal(created.user_relationship.is_primary_owner, true);
  });

  test('detects duplicate VIN conflicts across active vehicles', () => {
    const vin = 'JTEBH51J005777666';

    vehicleService.createVehicle(ownerActor, {
      make: 'Toyota',
      model: 'Harrier',
      model_year: 2020,
      vin,
      registration_number: 'KDB 111A',
    });

    // Attempting to register another vehicle with same VIN must throw 409 Conflict
    assert.throws(
      () => {
        vehicleService.createVehicle(otherActor, {
          make: 'Toyota',
          model: 'Harrier',
          model_year: 2020,
          vin,
          registration_number: 'KDB 222B',
        });
      },
      (err: any) => {
        return err instanceof CanonicalAppError && err.statusCode === 409;
      }
    );
  });

  test('enforces relationship-based access control and prevents IDOR', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Subaru',
      model: 'Forester',
      model_year: 2021,
      registration_number: 'KDC 333C',
    });

    // Owner can access details
    const ownerDetails = vehicleService.getVehicleDetails(ownerActor, created.vehicle.id);
    assert.equal(ownerDetails.vehicle.id, created.vehicle.id);

    // Unrelated actor cannot access (throws 403 NOT_AUTHORIZED)
    assert.throws(
      () => {
        vehicleService.getVehicleDetails(otherActor, created.vehicle.id);
      },
      (err: any) => {
        return err instanceof CanonicalAppError && err.statusCode === 403;
      }
    );
  });

  test('appends valid odometer observation and updates vehicle cache', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Mazda',
      model: 'CX-5',
      model_year: 2021,
      initial_odometer_value: 30000,
      initial_odometer_unit: OdometerUnit.KM,
    });

    const newReading = vehicleService.recordOdometer(ownerActor, created.vehicle.id, {
      value: 32500,
      unit: OdometerUnit.KM,
      notes: 'Trip to Nakuru',
    });

    assert.equal(newReading.status, OdometerObservationStatus.VALID);
    assert.equal(newReading.reading_km, 32500);

    const refreshed = vehicleRepository.getVehicleById(created.vehicle.id)!;
    assert.equal(refreshed.current_odometer_cache, 32500);
  });

  test('detects odometer regression anomaly, flags observation, and preserves vehicle cache', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Nissan',
      model: 'X-Trail',
      model_year: 2019,
      initial_odometer_value: 60000,
      initial_odometer_unit: OdometerUnit.KM,
    });

    // Lower reading than 60,000 km
    const regressed = vehicleService.recordOdometer(ownerActor, created.vehicle.id, {
      value: 55000,
      unit: OdometerUnit.KM,
      notes: 'Accidental typo or tampering attempt',
    });

    assert.equal(regressed.status, OdometerObservationStatus.FLAGGED);
    assert.ok(regressed.flag_reason?.includes('ODOMETER_REGRESSION_DETECTED'));

    // Cache must remain 60000 km
    const refreshed = vehicleRepository.getVehicleById(created.vehicle.id)!;
    assert.equal(refreshed.current_odometer_cache, 60000);
  });

  test('corrects erroneous odometer observation and supersedes previous record', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Honda',
      model: 'CR-V',
      model_year: 2020,
      initial_odometer_value: 40000,
      initial_odometer_unit: OdometerUnit.KM,
    });

    // Enter a bad reading
    const badObs = vehicleService.recordOdometer(ownerActor, created.vehicle.id, {
      value: 950000, // Typo for 95,000
      unit: OdometerUnit.KM,
    });

    // Correct the bad reading
    const corrected = vehicleService.correctOdometer(ownerActor, created.vehicle.id, {
      supersedes_observation_id: badObs.id,
      corrected_value: 95000,
      unit: OdometerUnit.KM,
      reason: 'Fixed accidental extra zero in entry',
    });

    assert.equal(corrected.status, OdometerObservationStatus.VALID);
    assert.equal(corrected.reading_km, 95000);

    // Verify previous observation is superseded
    const superseded = vehicleRepository.getOdometerObservationById(badObs.id)!;
    assert.equal(superseded.status, OdometerObservationStatus.SUPERSEDED);
    assert.equal(superseded.superseded_by_id, corrected.id);
  });

  test('safely archives vehicle, preserving historical records and disallowing active mutation', () => {
    const created = vehicleService.createVehicle(ownerActor, {
      make: 'Isuzu',
      model: 'D-Max',
      model_year: 2021,
    });

    const archived = vehicleService.archiveVehicle(ownerActor, created.vehicle.id, 'Sold to private buyer');
    assert.equal(archived.status, VehicleStatus.ARCHIVED);
    assert.ok(archived.archived_at);

    // Attempt to update specs on archived vehicle fails
    assert.throws(
      () => {
        vehicleService.updateVehicle(ownerActor, created.vehicle.id, { color: 'Blue' });
      },
      (err: any) => {
        return err instanceof CanonicalAppError && err.statusCode === 400;
      }
    );
  });

  test('retrieves automotive catalog makes and models', () => {
    const makes = vehicleRepository.getCatalogMakes();
    assert.ok(makes.length > 5);

    const toyota = makes.find((m) => m.name === 'Toyota');
    assert.ok(toyota);

    const models = vehicleRepository.getCatalogModels(toyota.id);
    assert.ok(models.length > 0);
    assert.ok(models.some((m) => m.name === 'Land Cruiser Prado'));
  });
});
