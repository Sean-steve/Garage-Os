/**
 * Canonical Vehicle Tyre Service (GAR-010 §28-§47)
 *
 * Implements physical tyre lifecycle management:
 * - Tyre installation, position tracking, and dimensional validation
 * - Atomic tyre rotations with move chains
 * - Atomic tyre replacements preserving wear history
 * - Tyre wear inspections (inner/center/outer tread depth, pressure, condition rating)
 * - Automatic integration with the unified Component architecture
 */

import crypto from 'node:crypto';
import { componentRepository } from './componentRepository';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { vehiclePolicy } from '../vehicle/vehiclePolicy';
import { CanonicalPermission } from '../identity/rbac';
import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { getCurrentUtcIsoString } from '../domain/time';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { logger } from '../observability/logger';
import { getDatabase } from '../database/connection';
import {
  ComponentCategory,
  ComponentClassification,
  ComponentStatus,
  InspectTyreInput,
  InstallTyreInput,
  PartProvenance,
  PartVerificationStatus,
  RemovalReason,
  ReplaceTyreInput,
  RotateTyresInput,
  TyreConditionRating,
  TyreInspectionEntity,
  TyrePosition,
  TyrePositionAssignmentEntity,
  TyreRotationEntity,
  TyreRotationMoveEntity,
  TyreRotationPattern,
  VehicleComponentEntity,
  VehicleTyreEntity,
} from './types';

export class VehicleTyreService {
  /**
   * Installs a physical tyre at a specific vehicle wheel position (GAR-010 §28, §30)
   */
  public installTyre(
    actor: AuthenticatedActorContext,
    input: InstallTyreInput
  ): { tyre: VehicleTyreEntity; position_assignment: TyrePositionAssignmentEntity } {
    vehiclePolicy.assertVehicleAccess(actor, input.vehicle_id, CanonicalPermission.VEHICLE_TYRE_INSTALL);

    const vehicle = vehicleRepository.getVehicleById(input.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${input.vehicle_id} not found`, 404);
    }

    // Validate position is not already occupied by an active tyre
    const existingAssignment = componentRepository.findCurrentTyreAtPosition(input.vehicle_id, input.position);
    if (existingAssignment) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TYRE_POSITION_OCCUPIED,
        `Position ${input.position} is already occupied by tyre ${existingAssignment.vehicle_tyre_id}. Rotate or replace instead.`,
        409
      );
    }

    // Validate tyre sizing
    if (input.width < 100 || input.width > 400 || input.aspect_ratio < 20 || input.aspect_ratio > 90 || input.rim_diameter < 10 || input.rim_diameter > 30) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TYRE_INVALID_SIZE,
        `Invalid tyre dimensions: ${input.width}/${input.aspect_ratio}R${input.rim_diameter}`,
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const tyreId = `tyre_${crypto.randomUUID().slice(0, 12)}`;
    const compId = `comp_tyre_${crypto.randomUUID().slice(0, 10)}`;

    let odoKm = input.installed_odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(input.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    // 1. Dual-register as unified VehicleComponent (GAR-010 §29)
    const component: VehicleComponentEntity = {
      id: compId,
      vehicle_id: input.vehicle_id,
      component_definition_id: null,
      part_id: input.part_id || null,
      custom_name: `${input.brand} ${input.model} (${input.size_raw})`,
      category: ComponentCategory.TYRES,
      subcategory: 'PNEUMATIC_TYRE',
      classification: ComponentClassification.WEAR_ITEM,
      brand: input.brand,
      model: input.model,
      part_number: null,
      oem_number: null,
      serial_number: input.serial_number || null,
      position: input.position,
      status: ComponentStatus.INSTALLED,
      installed_at: input.installed_at || now,
      installed_odometer_km: odoKm ?? null,
      installed_odometer_unit: null,
      installation_source: input.provenance || PartProvenance.GARAGE_RECORDED,
      installation_provider_id: null,
      installation_provider_name: null,
      installation_work_order_id: null,
      verification_status: input.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
      removed_at: null,
      removed_odometer_km: null,
      removal_reason: null,
      maintenance_completion_id: null,
      issue_intervention_id: null,
      vehicle_expense_id: null,
      notes: null,
      is_current: true,
      created_at: now,
      updated_at: now,
    };
    componentRepository.createComponent(component);

    // 2. Register VehicleTyre record
    const tyre: VehicleTyreEntity = {
      id: tyreId,
      vehicle_id: input.vehicle_id,
      vehicle_component_id: compId,
      part_id: input.part_id || null,
      tyre_set_id: input.tyre_set_id || null,
      brand: input.brand.trim(),
      model: input.model.trim(),
      size_raw: input.size_raw.trim(),
      width: input.width,
      aspect_ratio: input.aspect_ratio,
      rim_diameter: input.rim_diameter,
      construction: input.construction || 'R',
      load_index: input.load_index || null,
      speed_rating: input.speed_rating || null,
      manufacture_dot_code: input.manufacture_dot_code || null,
      serial_number: input.serial_number || null,
      status: ComponentStatus.INSTALLED,
      installed_at: input.installed_at || now,
      installed_odometer_km: odoKm ?? null,
      removed_at: null,
      removed_odometer_km: null,
      removal_reason: null,
      provenance: input.provenance || PartProvenance.GARAGE_RECORDED,
      verification_status: input.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
      created_at: now,
      updated_at: now,
    };
    componentRepository.createTyre(tyre);

    // 3. Assign to wheel position
    const assignment: TyrePositionAssignmentEntity = {
      id: `pos_${crypto.randomUUID().slice(0, 12)}`,
      vehicle_tyre_id: tyreId,
      vehicle_id: input.vehicle_id,
      position: input.position,
      assigned_at: tyre.installed_at,
      assigned_odometer_km: tyre.installed_odometer_km,
      ended_at: null,
      ended_odometer_km: null,
      source: 'INSTALLATION',
      is_current: true,
      created_at: now,
    };
    componentRepository.assignTyrePosition(assignment);

    // 4. Enqueue domain event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.tyre.installed',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: input.vehicle_id,
        tyre: tyreId,
      },
      payload: {
        vehicle_id: input.vehicle_id,
        tyre_id: tyreId,
        brand: tyre.brand,
        model: tyre.model,
        size: tyre.size_raw,
        position: input.position,
        installed_at: tyre.installed_at,
        odometer_km: tyre.installed_odometer_km,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    logger.info(`Installed tyre ${tyreId} at position ${input.position} on vehicle ${input.vehicle_id}`);

    return { tyre: { ...tyre, current_position: input.position }, position_assignment: assignment };
  }

  /**
   * Performs an atomic tyre rotation across multiple positions (GAR-010 §32-§34)
   */
  public rotateTyres(
    actor: AuthenticatedActorContext,
    input: RotateTyresInput
  ): TyreRotationEntity {
    vehiclePolicy.assertVehicleAccess(actor, input.vehicle_id, CanonicalPermission.VEHICLE_TYRE_ROTATE);

    const vehicle = vehicleRepository.getVehicleById(input.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${input.vehicle_id} not found`, 404);
    }

    if (!input.moves || input.moves.length < 2) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TYRE_ROTATION_INVALID,
        'Tyre rotation requires at least 2 position moves',
        400
      );
    }

    // Check no duplicate target positions
    const targetPositions = new Set<TyrePosition>();
    for (const move of input.moves) {
      if (targetPositions.has(move.to_position)) {
        throw new CanonicalAppError(
          ErrorCode.VEHICLE_TYRE_ROTATION_INVALID,
          `Duplicate target position in rotation move list: ${move.to_position}`,
          400
        );
      }
      targetPositions.add(move.to_position);
    }

    // Validate all tyres exist, belong to vehicle, and are currently installed
    for (const move of input.moves) {
      const tyre = componentRepository.findTyreById(move.vehicle_tyre_id);
      if (!tyre || tyre.vehicle_id !== input.vehicle_id || tyre.status !== ComponentStatus.INSTALLED) {
        throw new CanonicalAppError(
          ErrorCode.VEHICLE_TYRE_NOT_FOUND,
          `Active tyre ${move.vehicle_tyre_id} not found on vehicle ${input.vehicle_id}`,
          404
        );
      }
    }

    const now = getCurrentUtcIsoString();
    const performedAt = input.performed_at || now;

    let odoKm = input.odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(input.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    const rotId = `rot_${crypto.randomUUID().slice(0, 12)}`;
    const rotationEntity: TyreRotationEntity = {
      id: rotId,
      vehicle_id: input.vehicle_id,
      performed_at: performedAt,
      odometer_km: odoKm ?? null,
      pattern: input.pattern || TyreRotationPattern.FORWARD_CROSS,
      provider_id: input.provider_id || null,
      provider_name: input.provider_name?.trim() || null,
      work_order_id: input.work_order_id || null,
      notes: input.notes?.trim() || null,
      maintenance_completion_id: input.maintenance_completion_id || null,
      created_at: now,
    };

    const rotationMoves: TyreRotationMoveEntity[] = input.moves.map((m) => ({
      id: `mov_${crypto.randomUUID().slice(0, 12)}`,
      tyre_rotation_id: rotId,
      vehicle_tyre_id: m.vehicle_tyre_id,
      from_position: m.from_position,
      to_position: m.to_position,
      created_at: now,
    }));

    // Perform rotation inside atomic SQLite transaction
    const db = getDatabase();
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      // 1. End all current assignments for the rotated tyres
      for (const move of input.moves) {
        componentRepository.endCurrentTyrePosition(move.vehicle_tyre_id, performedAt, odoKm ?? null);
      }

      // 2. Assign each tyre to its new position
      for (const move of input.moves) {
        componentRepository.assignTyrePosition({
          id: `pos_${crypto.randomUUID().slice(0, 12)}`,
          vehicle_tyre_id: move.vehicle_tyre_id,
          vehicle_id: input.vehicle_id,
          position: move.to_position,
          assigned_at: performedAt,
          assigned_odometer_km: odoKm ?? null,
          ended_at: null,
          ended_odometer_km: null,
          source: 'ROTATION',
          is_current: true,
          created_at: now,
        });
      }

      // 3. Record rotation record and move records
      componentRepository.createTyreRotation(rotationEntity, rotationMoves);

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error(`Tyre rotation transaction failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    // 4. Enqueue domain event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.tyre.rotated',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: input.vehicle_id,
      },
      payload: {
        vehicle_id: input.vehicle_id,
        rotation_id: rotId,
        pattern: rotationEntity.pattern,
        performed_at: rotationEntity.performed_at,
        odometer_km: rotationEntity.odometer_km,
        moves_count: rotationMoves.length,
        provider_name: rotationEntity.provider_name,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    logger.info(`Completed tyre rotation ${rotId} on vehicle ${input.vehicle_id} (${rotationMoves.length} moves)`);

    return { ...rotationEntity, moves: rotationMoves };
  }

  /**
   * Atomically replaces a tyre at its position (GAR-010 §31)
   */
  public replaceTyre(
    actor: AuthenticatedActorContext,
    input: ReplaceTyreInput
  ): { old_tyre: VehicleTyreEntity; new_tyre: VehicleTyreEntity } {
    vehiclePolicy.assertVehicleAccess(actor, input.new_tyre.vehicle_id, CanonicalPermission.VEHICLE_TYRE_REPLACE);

    const oldTyre = componentRepository.findTyreById(input.old_tyre_id);
    if (!oldTyre) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_TYRE_NOT_FOUND, `Tyre ${input.old_tyre_id} not found`, 404);
    }

    if (oldTyre.status !== ComponentStatus.INSTALLED) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TYRE_ALREADY_REMOVED,
        `Tyre ${input.old_tyre_id} is already removed or replaced`,
        409
      );
    }

    // Find position of old tyre
    const currentPos = componentRepository.findCurrentPositionByTyreId(oldTyre.id);
    const targetPosition = input.new_tyre.position || (currentPos ? currentPos.position : TyrePosition.FRONT_LEFT);

    const now = getCurrentUtcIsoString();
    const replacedAt = input.replaced_at || now;

    let odoKm = input.odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(oldTyre.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    // End current position assignment of old tyre
    componentRepository.endCurrentTyrePosition(oldTyre.id, replacedAt, odoKm ?? null);

    // Mark old tyre replaced
    componentRepository.markTyreRemoved(
      oldTyre.id,
      replacedAt,
      odoKm ?? null,
      input.reason || RemovalReason.WORN,
      ComponentStatus.REPLACED
    );

    // If old tyre had a linked component, mark component replaced
    if (oldTyre.vehicle_component_id) {
      componentRepository.markComponentRemoved(
        oldTyre.vehicle_component_id,
        replacedAt,
        odoKm ?? null,
        input.reason || RemovalReason.WORN,
        ComponentStatus.REPLACED,
        input.notes
      );
    }

    // Install new tyre at the vacated position
    const { tyre: newTyre } = this.installTyre(actor, {
      ...input.new_tyre,
      vehicle_id: oldTyre.vehicle_id,
      position: targetPosition,
      installed_at: replacedAt,
      installed_odometer_km: odoKm,
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.tyre.replaced',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: oldTyre.vehicle_id,
        tyre: newTyre.id,
      },
      payload: {
        vehicle_id: oldTyre.vehicle_id,
        old_tyre_id: oldTyre.id,
        new_tyre_id: newTyre.id,
        position: targetPosition,
        replaced_at: replacedAt,
        odometer_km: odoKm,
        reason: input.reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return {
      old_tyre: componentRepository.findTyreById(oldTyre.id)!,
      new_tyre: newTyre,
    };
  }

  /**
   * Records a tyre physical inspection (GAR-010 §42-§45)
   */
  public inspectTyre(
    actor: AuthenticatedActorContext,
    input: InspectTyreInput
  ): TyreInspectionEntity {
    const tyre = componentRepository.findTyreById(input.vehicle_tyre_id);
    if (!tyre) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_TYRE_NOT_FOUND, `Tyre ${input.vehicle_tyre_id} not found`, 404);
    }

    vehiclePolicy.assertVehicleAccess(actor, tyre.vehicle_id, CanonicalPermission.VEHICLE_TYRE_INSPECT);

    // Validate tread depth values
    if (
      (input.tread_depth_inner_mm !== undefined && input.tread_depth_inner_mm < 0) ||
      (input.tread_depth_center_mm !== undefined && input.tread_depth_center_mm < 0) ||
      (input.tread_depth_outer_mm !== undefined && input.tread_depth_outer_mm < 0)
    ) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Tread depth cannot be negative', 400);
    }

    const now = getCurrentUtcIsoString();
    const inspId = `insp_${crypto.randomUUID().slice(0, 12)}`;

    const inspection: TyreInspectionEntity = {
      id: inspId,
      vehicle_tyre_id: input.vehicle_tyre_id,
      vehicle_id: tyre.vehicle_id,
      tread_depth_outer_mm: input.tread_depth_outer_mm ?? null,
      tread_depth_center_mm: input.tread_depth_center_mm ?? null,
      tread_depth_inner_mm: input.tread_depth_inner_mm ?? null,
      pressure_psi: input.pressure_psi ?? null,
      condition_rating: input.condition_rating || TyreConditionRating.GOOD,
      observed_at: input.observed_at || now,
      source_type: input.source_type || 'GARAGE_INSPECTION',
      provider_id: input.provider_id || null,
      notes: input.notes?.trim() || null,
      created_at: now,
    };

    componentRepository.createTyreInspection(inspection);

    logger.info(`Tyre inspection recorded for tyre ${tyre.id}, rating: ${inspection.condition_rating}`);

    return inspection;
  }

  /**
   * Lists all tyres for a vehicle with current wheel assignments and latest inspection
   */
  public listTyres(
    actor: AuthenticatedActorContext,
    vehicleId: string
  ): Array<VehicleTyreEntity & { current_position: TyrePosition | null; latest_inspection?: TyreInspectionEntity }> {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TYRE_READ);

    const tyres = componentRepository.findTyresByVehicleId(vehicleId);
    const currentAssignments = componentRepository.findCurrentTyrePositions(vehicleId);
    const assignMap = new Map(currentAssignments.map((a) => [a.vehicle_tyre_id, a.position]));

    return tyres.map((tyre) => {
      const inspections = componentRepository.findInspectionsByTyreId(tyre.id);
      return {
        ...tyre,
        current_position: assignMap.get(tyre.id) || null,
        latest_inspection: inspections.length > 0 ? inspections[0] : undefined,
      };
    });
  }
}

export const vehicleTyreService = new VehicleTyreService();
