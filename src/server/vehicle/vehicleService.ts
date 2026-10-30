/**
 * Canonical Vehicle Domain Service (GAR-004, GAR-033 §12A, GAR-034)
 *
 * Implements:
 * 1. Vehicle aggregate creation with atomic multi-entity transaction.
 * 2. Immutable canonical identity with structured identifiers (VIN, Chassis, Reg).
 * 3. Relationship-based ownership and delegation management.
 * 4. Append-only odometer observation log with automated regression detection & flagging.
 * 5. Structured audit logging and outbox events for all lifecycle state mutations.
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { recordAuditEvent } from '../security/audit';
import { enqueueOutboxEvent } from '../events/outbox';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalPermission } from '../identity/rbac';
import { DataProvenanceClass } from '../../shared/provenance';
import { CanonicalActorType } from '../../shared/types';
import {
  VehicleEntity,
  VehicleIdentifierEntity,
  VehicleRelationshipEntity,
  OdometerObservationEntity,
  VehicleDocumentEntity,
  CreateVehicleRequestDTO,
  UpdateVehicleRequestDTO,
  RecordOdometerRequestDTO,
  CorrectOdometerRequestDTO,
  AddRelationshipRequestDTO,
  AddDocumentRequestDTO,
  VehicleSummaryDTO,
  VehicleDetailDTO,
  VehicleStatus,
  VehicleType,
  FuelType,
  TransmissionType,
  DriveType,
  VehicleIdentifierType,
  IdentifierVerificationStatus,
  VehicleRelationshipType,
  RelationshipStatus,
  OdometerUnit,
  OdometerObservationStatus,
} from './types';
import {
  normalizeVin,
  normalizeRegistrationNumber,
  isValidStandardVin,
  isValidChassisNumber,
  isValidRegistrationNumber,
  normalizeDistanceToKm,
  validateModelYear,
  formatVehicleDisplayName,
} from './normalizer';
import { vehicleRepository } from './vehicleRepository';
import { vehiclePolicy } from './vehiclePolicy';

export class VehicleService {
  /**
   * Creates a new vehicle aggregate atomically with primary ownership,
   * identifiers, and optional initial odometer evidence.
   */
  createVehicle(actor: AuthenticatedActorContext, dto: CreateVehicleRequestDTO): VehicleDetailDTO {
    // 1. Mandatory Core Specifications Validation
    if (!dto.make || !dto.make.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Vehicle make is required', 400);
    }
    if (!dto.model || !dto.model.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Vehicle model is required', 400);
    }
    if (!dto.model_year) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Vehicle model year is required', 400);
    }

    validateModelYear(dto.model_year);

    const make = dto.make.trim();
    const model = dto.model.trim();
    const modelYear = dto.model_year;
    const trim = dto.trim ? dto.trim.trim() : null;
    const country = dto.country_of_registration ? dto.country_of_registration.trim().toUpperCase() : 'KE';

    const vehicleId = generateCanonicalId('veh');
    const now = getCurrentUtcIsoString();

    // 2. Structured Identifiers Normalization & Conflict Checks
    const identifiers: VehicleIdentifierEntity[] = [];

    // Process VIN / Chassis Number
    const rawVin = dto.vin || dto.chassis_number;
    if (rawVin && rawVin.trim()) {
      const normalizedVin = normalizeVin(rawVin);
      const isStdVin = isValidStandardVin(normalizedVin);
      const isChassis = isValidChassisNumber(normalizedVin);

      if (!isStdVin && !isChassis) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid VIN or chassis identifier format: '${rawVin}'. Standard VIN must be 17 characters (excluding I, O, Q).`,
          400
        );
      }

      const identType = isStdVin ? VehicleIdentifierType.VIN : VehicleIdentifierType.CHASSIS_NUMBER;

      // Duplicate identifier check
      const conflict = vehicleRepository.findIdentifierConflict(identType, normalizedVin);
      if (conflict) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Vehicle identifier conflict: A vehicle with this ${identType} (${normalizedVin}) is already registered and active.`,
          409
        );
      }

      identifiers.push({
        id: generateCanonicalId('vid'),
        vehicle_id: vehicleId,
        type: identType,
        value: rawVin.trim(),
        normalized_value: normalizedVin,
        issuing_country: country,
        source: 'OWNER_ENTERED',
        verification_status: IdentifierVerificationStatus.OWNER_ASSERTED,
        is_primary: true,
        valid_from: now,
        valid_until: null,
        created_at: now,
        updated_at: now,
      });
    }

    // Process Registration Number
    if (dto.registration_number && dto.registration_number.trim()) {
      if (!isValidRegistrationNumber(dto.registration_number)) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid registration number format: '${dto.registration_number}'`,
          400
        );
      }

      const normalizedReg = normalizeRegistrationNumber(dto.registration_number, country);

      // Duplicate registration check
      const conflict = vehicleRepository.findIdentifierConflict(VehicleIdentifierType.REGISTRATION_NUMBER, normalizedReg);
      if (conflict) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Vehicle identifier conflict: A vehicle with registration number (${normalizedReg}) is already registered.`,
          409
        );
      }

      identifiers.push({
        id: generateCanonicalId('vid'),
        vehicle_id: vehicleId,
        type: VehicleIdentifierType.REGISTRATION_NUMBER,
        value: dto.registration_number.trim(),
        normalized_value: normalizedReg,
        issuing_country: country,
        source: 'OWNER_ENTERED',
        verification_status: IdentifierVerificationStatus.OWNER_ASSERTED,
        is_primary: identifiers.length === 0, // Primary if no VIN was provided
        valid_from: now,
        valid_until: null,
        created_at: now,
        updated_at: now,
      });
    }

    // 3. Initial Odometer Reading
    let initialOdometer: OdometerObservationEntity | undefined;
    let initialOdometerKm = 0;
    const initialUnit = dto.initial_odometer_unit || OdometerUnit.KM;

    if (dto.initial_odometer_value !== undefined && dto.initial_odometer_value !== null) {
      initialOdometerKm = normalizeDistanceToKm(dto.initial_odometer_value, initialUnit);
      initialOdometer = {
        id: generateCanonicalId('odo'),
        vehicle_id: vehicleId,
        reading_value: dto.initial_odometer_value,
        unit: initialUnit,
        reading_km: initialOdometerKm,
        observed_at: now,
        recorded_at: now,
        source_class: 'INITIAL_ONBOARDING',
        source_ref: null,
        actor_id: actor.user_id,
        provider_id: null,
        status: OdometerObservationStatus.VALID,
        flag_reason: null,
        superseded_by_id: null,
        correction_reason: null,
        notes: 'Initial odometer reading captured during onboarding',
        created_at: now,
        updated_at: now,
      };
    }

    // 4. Primary Ownership Relationship
    const relationshipType = dto.relationship_type || VehicleRelationshipType.OWNER;
    const relationship: VehicleRelationshipEntity = {
      id: generateCanonicalId('vrel'),
      vehicle_id: vehicleId,
      user_id: actor.user_id,
      organization_id: dto.organization_id || actor.active_organization_id || null,
      relationship_type: relationshipType,
      is_primary_owner: relationshipType === VehicleRelationshipType.OWNER,
      status: RelationshipStatus.ACTIVE,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      valid_from: now,
      valid_until: null,
      notes: 'Initial creator relationship',
      created_at: now,
      updated_at: now,
    };

    // 5. Vehicle Entity Construction
    const displayName = formatVehicleDisplayName(make, model, modelYear, trim);
    const vehicle: VehicleEntity = {
      id: vehicleId,
      display_name: displayName,
      nickname: dto.nickname ? dto.nickname.trim() : null,
      make,
      model,
      model_year: modelYear,
      trim,
      variant: dto.variant ? dto.variant.trim() : null,
      vehicle_type: dto.vehicle_type || VehicleType.SEDAN,
      body_type: dto.body_type ? dto.body_type.trim() : null,
      color: dto.color ? dto.color.trim() : null,
      fuel_type: dto.fuel_type || FuelType.PETROL,
      transmission: dto.transmission || TransmissionType.AUTOMATIC,
      drive_type: dto.drive_type || null,
      engine_number: dto.engine_number ? dto.engine_number.trim() : null,
      engine_type: null,
      engine_displacement_cc: dto.engine_displacement_cc || null,
      manufacture_date: dto.manufacture_date || null,
      first_registration_date: dto.first_registration_date || null,
      country_of_registration: country,
      status: VehicleStatus.ACTIVE,
      verification_status: IdentifierVerificationStatus.OWNER_ASSERTED,
      primary_image_id: dto.primary_image_id || null,
      current_odometer_cache: initialOdometerKm,
      current_odometer_unit: initialUnit,
      timezone: 'Africa/Nairobi',
      version: 1,
      created_by: actor.user_id,
      created_at: now,
      updated_at: now,
      archived_at: null,
    };

    // 6. Atomic Transactional Persistence
    vehicleRepository.createVehicleAggregate({
      vehicle,
      identifiers,
      relationship,
      initialOdometer,
    });

    // 7. Security Audit Logging
    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_CREATED',
      resource_type: 'vehicle',
      resource_id: vehicleId,
      correlation_id: `veh_create_${vehicleId}`,
      source: 'vehicle-domain',
      metadata: {
        display_name: displayName,
        identifiers_count: identifiers.length,
        initial_odometer_km: initialOdometerKm,
      },
    });

    // 8. Outbox Event Publication
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.created',
      producer: 'vehicle-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `veh_create_${vehicleId}`,
      payload: {
        vehicle_id: vehicleId,
        display_name: displayName,
        make,
        model,
        model_year: modelYear,
        status: vehicle.status,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return this.getVehicleDetails(actor, vehicleId);
  }

  /**
   * Retrieves full vehicle details with access control verification.
   */
  getVehicleDetails(actor: AuthenticatedActorContext, vehicleId: string): VehicleDetailDTO {
    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${vehicleId} not found`, 404);
    }

    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_READ);

    const identifiers = vehicleRepository.getVehicleIdentifiers(vehicleId);
    const userRelationship = vehicleRepository.getUserRelationshipForVehicle(vehicleId, actor.user_id);
    const primaryOwner = vehicleRepository.getPrimaryOwner(vehicleId);
    const latestOdometer = vehicleRepository.getLatestOdometerObservation(vehicleId);
    const documents = vehicleRepository.listVehicleDocuments(vehicleId);

    return {
      vehicle,
      identifiers,
      user_relationship: userRelationship,
      primary_owner: primaryOwner,
      latest_odometer: latestOdometer
        ? {
            reading_km: latestOdometer.reading_km,
            reading_value: latestOdometer.reading_value,
            unit: latestOdometer.unit,
            observed_at: latestOdometer.observed_at,
            status: latestOdometer.status,
          }
        : {
            reading_km: vehicle.current_odometer_cache,
            reading_value: vehicle.current_odometer_cache,
            unit: vehicle.current_odometer_unit,
            observed_at: vehicle.created_at,
            status: OdometerObservationStatus.VALID,
          },
      documents_count: documents.length,
    };
  }

  /**
   * Lists all vehicles accessible to the actor ("My Garage").
   */
  listMyVehicles(actor: AuthenticatedActorContext, status?: VehicleStatus): VehicleSummaryDTO[] {
    let records: Array<{ vehicle: VehicleEntity; relationship: VehicleRelationshipEntity }>;

    if (actor.active_organization_id) {
      records = vehicleRepository.listVehiclesForOrganization(actor.active_organization_id, status);
    } else {
      records = vehicleRepository.listVehiclesForUser(actor.user_id, status);
    }

    return records.map(({ vehicle, relationship }) => {
      const identifiers = vehicleRepository.getVehicleIdentifiers(vehicle.id);
      const regIdent = identifiers.find((i) => i.type === VehicleIdentifierType.REGISTRATION_NUMBER);

      return {
        vehicle_id: vehicle.id,
        display_name: vehicle.display_name,
        nickname: vehicle.nickname,
        make: vehicle.make,
        model: vehicle.model,
        model_year: vehicle.model_year,
        registration_number: regIdent ? regIdent.value : null,
        primary_image_id: vehicle.primary_image_id,
        latest_odometer_km: vehicle.current_odometer_cache,
        latest_odometer_unit: vehicle.current_odometer_unit,
        relationship_type: relationship.relationship_type,
        is_primary_owner: relationship.is_primary_owner,
        status: vehicle.status,
        created_at: vehicle.created_at,
      };
    });
  }

  /**
   * Updates mutable vehicle specifications (nickname, color, trim, etc.).
   */
  updateVehicle(actor: AuthenticatedActorContext, vehicleId: string, dto: UpdateVehicleRequestDTO): VehicleEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_UPDATE);

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${vehicleId} not found`, 404);
    }
    if (vehicle.status === VehicleStatus.ARCHIVED) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Cannot update an archived vehicle', 400);
    }

    const updated = vehicleRepository.updateVehicle(vehicleId, {
      nickname: dto.nickname !== undefined ? dto.nickname : vehicle.nickname,
      color: dto.color !== undefined ? dto.color : vehicle.color,
      trim: dto.trim !== undefined ? dto.trim : vehicle.trim,
      variant: dto.variant !== undefined ? dto.variant : vehicle.variant,
      body_type: dto.body_type !== undefined ? dto.body_type : vehicle.body_type,
      primary_image_id: dto.primary_image_id !== undefined ? dto.primary_image_id : vehicle.primary_image_id,
    });

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_UPDATED',
      resource_type: 'vehicle',
      resource_id: vehicleId,
      correlation_id: `veh_upd_${vehicleId}`,
      source: 'vehicle-domain',
      metadata: { updates: dto as any },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.updated',
      producer: 'vehicle-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `veh_upd_${vehicleId}`,
      payload: { vehicle_id: vehicleId, updates: dto },
    });
    enqueueOutboxEvent(eventEnvelope);

    return updated;
  }

  /**
   * Archives a vehicle aggregate while preserving historical integrity.
   */
  archiveVehicle(actor: AuthenticatedActorContext, vehicleId: string, reason?: string): VehicleEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_ARCHIVE);

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${vehicleId} not found`, 404);
    }
    if (vehicle.status === VehicleStatus.ARCHIVED) {
      return vehicle;
    }

    const now = getCurrentUtcIsoString();
    vehicleRepository.archiveVehicle(vehicleId, now);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_ARCHIVED',
      resource_type: 'vehicle',
      resource_id: vehicleId,
      correlation_id: `veh_arch_${vehicleId}`,
      source: 'vehicle-domain',
      metadata: { reason },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.archived',
      producer: 'vehicle-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId },
      correlation_id: `veh_arch_${vehicleId}`,
      payload: { vehicle_id: vehicleId, reason },
    });
    enqueueOutboxEvent(eventEnvelope);

    return vehicleRepository.getVehicleById(vehicleId)!;
  }

  /**
   * Appends an odometer observation with regression detection.
   */
  recordOdometer(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: RecordOdometerRequestDTO
  ): OdometerObservationEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_ODOMETER_CREATE);

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${vehicleId} not found`, 404);
    }
    if (vehicle.status === VehicleStatus.ARCHIVED) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Cannot record odometer on archived vehicle', 400);
    }

    const unit = dto.unit || OdometerUnit.KM;
    const readingKm = normalizeDistanceToKm(dto.value, unit);
    const now = getCurrentUtcIsoString();
    const observedAt = dto.observed_at || now;

    const latestValid = vehicleRepository.getLatestOdometerObservation(vehicleId);
    let status = OdometerObservationStatus.VALID;
    let flagReason: string | null = null;

    // Check for regression against latest valid reading
    if (latestValid && readingKm < latestValid.reading_km) {
      status = OdometerObservationStatus.FLAGGED;
      flagReason = `ODOMETER_REGRESSION_DETECTED: Submitted reading of ${readingKm} km (${dto.value} ${unit}) is lower than latest confirmed observation of ${latestValid.reading_km} km. Flagged for review.`;
    }

    const observation: OdometerObservationEntity = {
      id: generateCanonicalId('odo'),
      vehicle_id: vehicleId,
      reading_value: dto.value,
      unit,
      reading_km: readingKm,
      observed_at: observedAt,
      recorded_at: now,
      source_class: dto.source_class || 'OWNER_ENTERED',
      source_ref: null,
      actor_id: actor.user_id,
      provider_id: null,
      status,
      flag_reason: flagReason,
      superseded_by_id: null,
      correction_reason: null,
      notes: dto.notes ? dto.notes.trim() : null,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.createOdometerObservation(observation);

    // Only update vehicle cache if reading is VALID and advances distance
    if (status === OdometerObservationStatus.VALID && readingKm >= vehicle.current_odometer_cache) {
      vehicleRepository.updateVehicleOdometerCache(vehicleId, readingKm, unit);
    }

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: status === OdometerObservationStatus.FLAGGED ? 'ODOMETER_FLAGGED' : 'ODOMETER_RECORDED',
      resource_type: 'odometer',
      resource_id: observation.id,
      correlation_id: `odo_rec_${observation.id}`,
      source: 'vehicle-domain',
      metadata: {
        vehicle_id: vehicleId,
        reading_km: readingKm,
        status,
        flag_reason: flagReason,
      },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: status === OdometerObservationStatus.FLAGGED ? 'odometer.flagged' : 'odometer.recorded',
      producer: 'vehicle-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId, odometer_observation: observation.id },
      correlation_id: `odo_rec_${observation.id}`,
      payload: {
        vehicle_id: vehicleId,
        observation_id: observation.id,
        reading_km: readingKm,
        unit,
        status,
        flag_reason: flagReason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return observation;
  }

  /**
   * Corrects a previous erroneous odometer observation by superseding it.
   */
  correctOdometer(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: CorrectOdometerRequestDTO
  ): OdometerObservationEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_ODOMETER_CORRECT);

    if (!dto.reason || !dto.reason.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Correction reason is required', 400);
    }

    const previousObs = vehicleRepository.getOdometerObservationById(dto.supersedes_observation_id);
    if (!previousObs || previousObs.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Target odometer observation not found for this vehicle', 404);
    }

    const unit = dto.unit || OdometerUnit.KM;
    const readingKm = normalizeDistanceToKm(dto.corrected_value, unit);
    const now = getCurrentUtcIsoString();
    const newObsId = generateCanonicalId('odo');

    // 1. Mark target observation as SUPERSEDED
    vehicleRepository.supersedeOdometerObservation(previousObs.id, newObsId, dto.reason.trim());

    // 2. Insert corrected observation
    const correctedObs: OdometerObservationEntity = {
      id: newObsId,
      vehicle_id: vehicleId,
      reading_value: dto.corrected_value,
      unit,
      reading_km: readingKm,
      observed_at: dto.observed_at || previousObs.observed_at,
      recorded_at: now,
      source_class: 'USER_CORRECTION',
      source_ref: previousObs.id,
      actor_id: actor.user_id,
      provider_id: null,
      status: OdometerObservationStatus.VALID,
      flag_reason: null,
      superseded_by_id: null,
      correction_reason: dto.reason.trim(),
      notes: dto.notes ? dto.notes.trim() : `Correction superseding ${previousObs.id}`,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.createOdometerObservation(correctedObs);

    // 3. Re-evaluate and sync current vehicle odometer cache to highest valid reading
    const highestValid = vehicleRepository.getLatestOdometerObservation(vehicleId);
    if (highestValid) {
      vehicleRepository.updateVehicleOdometerCache(vehicleId, highestValid.reading_km, highestValid.unit);
    }

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'ODOMETER_CORRECTED',
      resource_type: 'odometer',
      resource_id: newObsId,
      correlation_id: `odo_corr_${newObsId}`,
      source: 'vehicle-domain',
      metadata: {
        vehicle_id: vehicleId,
        superseded_id: previousObs.id,
        new_reading_km: readingKm,
        reason: dto.reason,
      },
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'odometer.corrected',
      producer: 'vehicle-domain',
      actor_id: actor.user_id,
      actor_type: CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId, odometer_observation: newObsId },
      correlation_id: `odo_corr_${newObsId}`,
      payload: {
        vehicle_id: vehicleId,
        superseded_id: previousObs.id,
        new_reading_km: readingKm,
        reason: dto.reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return correctedObs;
  }

  /**
   * Adds a new relationship (e.g. driver, co-owner, custodian) to a vehicle.
   */
  addRelationship(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: AddRelationshipRequestDTO
  ): VehicleRelationshipEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_RELATIONSHIP_MANAGE);

    if (!dto.user_id || !dto.user_id.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Target user ID is required', 400);
    }

    const now = getCurrentUtcIsoString();
    const relationship: VehicleRelationshipEntity = {
      id: generateCanonicalId('vrel'),
      vehicle_id: vehicleId,
      user_id: dto.user_id.trim(),
      organization_id: dto.organization_id || null,
      relationship_type: dto.relationship_type || VehicleRelationshipType.AUTHORIZED_USER,
      is_primary_owner: false,
      status: RelationshipStatus.ACTIVE,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      valid_from: dto.valid_from || now,
      valid_until: dto.valid_until || null,
      notes: dto.notes ? dto.notes.trim() : null,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.addVehicleRelationship(relationship);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_RELATIONSHIP_ADDED',
      resource_type: 'vehicle_relationship',
      resource_id: relationship.id,
      correlation_id: `vrel_add_${relationship.id}`,
      source: 'vehicle-domain',
      metadata: { vehicle_id: vehicleId, relationship: relationship as any },
    });

    return relationship;
  }

  /**
   * Revokes a vehicle relationship.
   */
  revokeRelationship(actor: AuthenticatedActorContext, vehicleId: string, relationshipId: string): void {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_RELATIONSHIP_MANAGE);

    const relationships = vehicleRepository.getVehicleRelationships(vehicleId);
    const target = relationships.find((r) => r.id === relationshipId);
    if (!target) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Vehicle relationship not found', 404);
    }
    if (target.is_primary_owner) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot revoke primary owner relationship without formal ownership transfer',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    vehicleRepository.revokeVehicleRelationship(relationshipId, now);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_RELATIONSHIP_REVOKED',
      resource_type: 'vehicle_relationship',
      resource_id: relationshipId,
      correlation_id: `vrel_rev_${relationshipId}`,
      source: 'vehicle-domain',
      metadata: { vehicle_id: vehicleId, relationship_id: relationshipId },
    });
  }

  /**
   * Records a vehicle document metadata association.
   */
  addDocument(actor: AuthenticatedActorContext, vehicleId: string, dto: AddDocumentRequestDTO): VehicleDocumentEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_DOCUMENT_CREATE);

    if (!dto.file_id || !dto.file_id.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Document file ID is required', 400);
    }
    if (!dto.title || !dto.title.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Document title is required', 400);
    }

    const now = getCurrentUtcIsoString();
    const doc: VehicleDocumentEntity = {
      id: generateCanonicalId('vdoc'),
      vehicle_id: vehicleId,
      document_type: dto.document_type,
      file_id: dto.file_id.trim(),
      title: dto.title.trim(),
      document_number: dto.document_number ? dto.document_number.trim() : null,
      issuer: dto.issuer ? dto.issuer.trim() : null,
      issued_at: dto.issued_at || null,
      expires_at: dto.expires_at || null,
      verification_status: IdentifierVerificationStatus.UNVERIFIED,
      created_by: actor.user_id,
      created_at: now,
      updated_at: now,
    };

    vehicleRepository.addVehicleDocument(doc);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_DOCUMENT_ADDED',
      resource_type: 'vehicle_document',
      resource_id: doc.id,
      correlation_id: `vdoc_add_${doc.id}`,
      source: 'vehicle-domain',
      metadata: { vehicle_id: vehicleId, document_id: doc.id },
    });

    return doc;
  }
}

export const vehicleService = new VehicleService();
