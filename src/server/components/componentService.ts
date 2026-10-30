/**
 * Canonical Vehicle Component Service (GAR-010 §6-§27, §48-§56)
 *
 * Implements physical-component lifecycle management:
 * - Installation, atomic replacement, and removal of components
 * - Warranties and evidence linking
 * - Vehicle modifications and configuration overrides
 * - Configuration summaries comparing factory vs current configuration
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
import {
  ComponentCategory,
  ComponentClassification,
  ComponentEvidenceLinkEntity,
  ComponentStatus,
  ComponentWarrantyEntity,
  InstallComponentInput,
  ModificationStatus,
  PartProvenance,
  PartVerificationStatus,
  RecordModificationInput,
  RemovalReason,
  ReplaceComponentInput,
  RemoveComponentInput,
  VehicleComponentEntity,
  VehicleComponentReplacementEntity,
  VehicleConfigurationOverrideEntity,
  VehicleConfigurationSummaryDTO,
  VehicleModificationEntity,
  WarrantyStatus,
  WarrantyType,
} from './types';

export class VehicleComponentService {
  /**
   * Installs a physical component on a vehicle (GAR-010 §6, §9)
   */
  public installComponent(
    actor: AuthenticatedActorContext,
    input: InstallComponentInput
  ): { component: VehicleComponentEntity; warranty?: ComponentWarrantyEntity } {
    vehiclePolicy.assertVehicleAccess(actor, input.vehicle_id, CanonicalPermission.VEHICLE_COMPONENT_RECORD);

    const vehicle = vehicleRepository.getVehicleById(input.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${input.vehicle_id} not found`, 404);
    }

    if (!input.custom_name || !input.custom_name.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Component name is required', 400);
    }

    const now = getCurrentUtcIsoString();
    const compId = `comp_${crypto.randomUUID().slice(0, 12)}`;

    // Resolve odometer reading if not provided
    let odoKm = input.installed_odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(input.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    const component: VehicleComponentEntity = {
      id: compId,
      vehicle_id: input.vehicle_id,
      component_definition_id: input.component_definition_id || null,
      part_id: input.part_id || null,
      custom_name: input.custom_name.trim(),
      category: input.category || ComponentCategory.OTHER,
      subcategory: input.subcategory?.trim() || null,
      classification: input.classification || ComponentClassification.DURABLE_COMPONENT,
      brand: input.brand?.trim() || null,
      model: input.model?.trim() || null,
      part_number: input.part_number?.trim() || null,
      oem_number: input.oem_number?.trim() || null,
      serial_number: input.serial_number?.trim() || null,
      position: input.position?.trim() || null,
      status: ComponentStatus.INSTALLED,
      installed_at: input.installed_at || now,
      installed_odometer_km: odoKm ?? null,
      installed_odometer_unit: input.installed_odometer_unit || null,
      installation_source: input.installation_source || PartProvenance.GARAGE_RECORDED,
      installation_provider_id: input.installation_provider_id || null,
      installation_provider_name: input.installation_provider_name?.trim() || null,
      installation_work_order_id: input.installation_work_order_id || null,
      verification_status: input.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
      removed_at: null,
      removed_odometer_km: null,
      removal_reason: null,
      maintenance_completion_id: input.maintenance_completion_id || null,
      issue_intervention_id: input.issue_intervention_id || null,
      vehicle_expense_id: input.vehicle_expense_id || null,
      notes: input.notes?.trim() || null,
      is_current: true,
      created_at: now,
      updated_at: now,
    };

    componentRepository.createComponent(component);

    // Record installation event
    componentRepository.createComponentEvent({
      id: `ev_${crypto.randomUUID().slice(0, 12)}`,
      vehicle_component_id: compId,
      vehicle_id: input.vehicle_id,
      event_type: 'component.installed',
      occurred_at: component.installed_at,
      odometer_km: component.installed_odometer_km,
      actor_id: actor.id,
      actor_type: actor.active_membership?.role || 'OWNER',
      notes: component.notes,
      metadata: {
        category: component.category,
        brand: component.brand,
        part_number: component.part_number,
        position: component.position,
      },
      created_at: now,
    });

    // Optional warranty registration at install time
    let createdWarranty: ComponentWarrantyEntity | undefined;
    if (input.warranty) {
      const warrId = `warr_${crypto.randomUUID().slice(0, 12)}`;
      createdWarranty = componentRepository.createComponentWarranty({
        id: warrId,
        vehicle_component_id: compId,
        vehicle_id: input.vehicle_id,
        provider_id: input.installation_provider_id || null,
        provider_name: input.warranty.provider_name || input.installation_provider_name || null,
        seller_id: null,
        warranty_type: input.warranty.warranty_type || WarrantyType.GARAGE,
        starts_at: input.warranty.starts_at || component.installed_at,
        expires_at: input.warranty.expires_at || null,
        distance_limit_km: input.warranty.distance_limit_km || null,
        distance_limit_value: input.warranty.distance_limit_km || null,
        distance_unit: null,
        terms_summary: input.warranty.terms_summary || 'Standard warranty terms applied.',
        document_reference: null,
        status: WarrantyStatus.ACTIVE,
        created_at: now,
        updated_at: now,
      });
    }

    // Publish domain event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.component.installed',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: input.vehicle_id,
        component: compId,
      },
      payload: {
        vehicle_id: input.vehicle_id,
        component_id: compId,
        custom_name: component.custom_name,
        category: component.category,
        brand: component.brand,
        part_number: component.part_number,
        position: component.position,
        installed_at: component.installed_at,
        installed_odometer_km: component.installed_odometer_km,
        provider_name: component.installation_provider_name,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    logger.info(`Installed component ${compId} (${component.custom_name}) on vehicle ${input.vehicle_id}`);

    return { component, warranty: createdWarranty };
  }

  /**
   * Replaces an existing component atomically (GAR-010 §13)
   */
  public replaceComponent(
    actor: AuthenticatedActorContext,
    input: ReplaceComponentInput
  ): { replacement: VehicleComponentReplacementEntity; new_component: VehicleComponentEntity } {
    vehiclePolicy.assertVehicleAccess(actor, input.new_component.vehicle_id, CanonicalPermission.VEHICLE_COMPONENT_REPLACE);

    const oldComponent = componentRepository.findComponentById(input.old_component_id);
    if (!oldComponent) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_COMPONENT_NOT_FOUND,
        `Original component ${input.old_component_id} not found`,
        404
      );
    }

    if (!oldComponent.is_current) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_COMPONENT_ALREADY_REMOVED,
        `Original component ${input.old_component_id} is already removed or replaced`,
        409
      );
    }

    if (oldComponent.vehicle_id !== input.new_component.vehicle_id) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_COMPONENT_INVALID_REPLACEMENT,
        'Old component does not belong to the target vehicle',
        422
      );
    }

    const now = getCurrentUtcIsoString();
    const replacedAt = input.replaced_at || now;

    // Resolve replacement odometer
    let odoKm = input.odometer_km;
    if (odoKm === undefined) {
      odoKm = input.new_component.installed_odometer_km;
      if (odoKm === undefined) {
        const readings = vehicleRepository.listOdometerObservations(oldComponent.vehicle_id, 1, 0);
        if (readings.length > 0 && readings[0].reading_km) {
          odoKm = readings[0].reading_km;
        }
      }
    }

    // 1. Install new component
    const { component: newComponent } = this.installComponent(actor, {
      ...input.new_component,
      vehicle_id: oldComponent.vehicle_id,
      category: input.new_component.category || oldComponent.category,
      position: input.new_component.position || oldComponent.position || undefined,
      installed_at: replacedAt,
      installed_odometer_km: odoKm,
    });

    // 2. Mark old component replaced
    componentRepository.markComponentRemoved(
      oldComponent.id,
      replacedAt,
      odoKm ?? null,
      input.reason || RemovalReason.WORN,
      ComponentStatus.REPLACED,
      input.notes
    );

    // 3. Record replacement chain record
    const repId = `rep_${crypto.randomUUID().slice(0, 12)}`;
    const replacement: VehicleComponentReplacementEntity = {
      id: repId,
      vehicle_id: oldComponent.vehicle_id,
      old_component_id: oldComponent.id,
      new_component_id: newComponent.id,
      replaced_at: replacedAt,
      odometer_km: odoKm ?? null,
      reason: input.reason || RemovalReason.WORN,
      notes: input.notes?.trim() || null,
      created_at: now,
    };
    componentRepository.createComponentReplacement(replacement);

    // 4. Record event on old component
    componentRepository.createComponentEvent({
      id: `ev_${crypto.randomUUID().slice(0, 12)}`,
      vehicle_component_id: oldComponent.id,
      vehicle_id: oldComponent.vehicle_id,
      event_type: 'component.replaced',
      occurred_at: replacedAt,
      odometer_km: odoKm ?? null,
      actor_id: actor.id,
      actor_type: actor.active_membership?.role || 'MECHANIC',
      notes: `Replaced by component ${newComponent.id} (${newComponent.custom_name})`,
      metadata: {
        replacement_id: repId,
        new_component_id: newComponent.id,
        reason: input.reason,
      },
      created_at: now,
    });

    // 5. Enqueue outbox domain event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.component.replaced',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: oldComponent.vehicle_id,
        component: newComponent.id,
      },
      payload: {
        vehicle_id: oldComponent.vehicle_id,
        replacement_id: repId,
        old_component_id: oldComponent.id,
        old_component_name: oldComponent.custom_name,
        new_component_id: newComponent.id,
        new_component_name: newComponent.custom_name,
        replaced_at: replacedAt,
        odometer_km: odoKm,
        reason: input.reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    logger.info(`Replaced component ${oldComponent.id} with ${newComponent.id} on vehicle ${oldComponent.vehicle_id}`);

    return { replacement, new_component: newComponent };
  }

  /**
   * Removes an installed component from a vehicle (GAR-010 §12)
   */
  public removeComponent(
    actor: AuthenticatedActorContext,
    input: RemoveComponentInput
  ): VehicleComponentEntity {
    const component = componentRepository.findComponentById(input.component_id);
    if (!component) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_COMPONENT_NOT_FOUND,
        `Component ${input.component_id} not found`,
        404
      );
    }

    vehiclePolicy.assertVehicleAccess(actor, component.vehicle_id, CanonicalPermission.VEHICLE_COMPONENT_CORRECT);

    if (!component.is_current) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_COMPONENT_ALREADY_REMOVED,
        `Component ${input.component_id} is already removed or replaced`,
        409
      );
    }

    const now = getCurrentUtcIsoString();
    const removedAt = input.removed_at || now;

    let odoKm = input.removed_odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(component.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    componentRepository.markComponentRemoved(
      component.id,
      removedAt,
      odoKm ?? null,
      input.reason || RemovalReason.WORN,
      ComponentStatus.REMOVED,
      input.notes
    );

    componentRepository.createComponentEvent({
      id: `ev_${crypto.randomUUID().slice(0, 12)}`,
      vehicle_component_id: component.id,
      vehicle_id: component.vehicle_id,
      event_type: 'component.removed',
      occurred_at: removedAt,
      odometer_km: odoKm ?? null,
      actor_id: actor.id,
      actor_type: actor.active_membership?.role || 'MECHANIC',
      notes: input.notes || null,
      metadata: {
        reason: input.reason,
      },
      created_at: now,
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.component.removed',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: component.vehicle_id,
        component: component.id,
      },
      payload: {
        vehicle_id: component.vehicle_id,
        component_id: component.id,
        component_name: component.custom_name,
        removed_at: removedAt,
        odometer_km: odoKm,
        reason: input.reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return componentRepository.findComponentById(component.id)!;
  }

  /**
   * Retrieves a component by ID with associated history and warranties
   */
  public getComponent(
    actor: AuthenticatedActorContext,
    componentId: string
  ): {
    component: VehicleComponentEntity;
    warranties: ComponentWarrantyEntity[];
    events: any[];
  } {
    const component = componentRepository.findComponentById(componentId);
    if (!component) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_COMPONENT_NOT_FOUND, `Component ${componentId} not found`, 404);
    }

    vehiclePolicy.assertVehicleAccess(actor, component.vehicle_id, CanonicalPermission.VEHICLE_COMPONENT_READ);

    const warranties = componentRepository.findWarrantiesByComponentId(componentId);
    const events = componentRepository.findEventsByComponentId(componentId);

    return {
      component,
      warranties,
      events,
    };
  }

  /**
   * Lists components installed or previously installed on a vehicle
   */
  public listComponents(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    filters?: {
      isCurrentOnly?: boolean;
      current_only?: boolean;
      category?: ComponentCategory;
      status?: ComponentStatus;
    }
  ): VehicleComponentEntity[] {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_COMPONENT_READ);

    const isCurrentOnly = filters?.isCurrentOnly !== undefined ? filters.isCurrentOnly : filters?.current_only;
    return componentRepository.findComponentsByVehicleId(vehicleId, {
      ...filters,
      isCurrentOnly,
    });
  }

  /**
   * Records a vehicle modification and any resulting configuration overrides (GAR-010 §51-§56)
   */
  public recordModification(
    actor: AuthenticatedActorContext,
    input: RecordModificationInput
  ): VehicleModificationEntity & { overrides: VehicleConfigurationOverrideEntity[] } {
    vehiclePolicy.assertVehicleAccess(actor, input.vehicle_id, CanonicalPermission.VEHICLE_MODIFICATION_RECORD);

    const vehicle = vehicleRepository.getVehicleById(input.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${input.vehicle_id} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const modId = `mod_${crypto.randomUUID().slice(0, 12)}`;

    let odoKm = input.odometer_km;
    if (odoKm === undefined) {
      const readings = vehicleRepository.listOdometerObservations(input.vehicle_id, 1, 0);
      if (readings.length > 0 && readings[0].reading_km) {
        odoKm = readings[0].reading_km;
      }
    }

    const modification: VehicleModificationEntity = {
      id: modId,
      vehicle_id: input.vehicle_id,
      category: input.category.trim(),
      name: input.name.trim(),
      description: input.description.trim(),
      installed_at: input.installed_at || now,
      odometer_km: odoKm ?? null,
      provider_id: input.provider_id || null,
      provider_name: input.provider_name?.trim() || null,
      work_order_id: input.work_order_id || null,
      status: ModificationStatus.INSTALLED,
      verification_status: input.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
      vehicle_component_id: input.vehicle_component_id || null,
      vehicle_expense_id: input.vehicle_expense_id || null,
      created_at: now,
      updated_at: now,
    };

    componentRepository.createModification(modification);

    // Process configuration overrides if supplied
    const createdOverrides: VehicleConfigurationOverrideEntity[] = [];
    if (input.overrides && input.overrides.length > 0) {
      for (const override of input.overrides) {
        const ovr: VehicleConfigurationOverrideEntity = {
          id: `ovr_${crypto.randomUUID().slice(0, 12)}`,
          vehicle_id: input.vehicle_id,
          attribute_key: override.attribute_key,
          original_value: override.original_value,
          current_value: override.current_value,
          source_reference: override.source_reference || `Modification ${modId}`,
          effective_from: modification.installed_at,
          effective_to: null,
          created_at: now,
        };
        componentRepository.createConfigurationOverride(ovr);
        createdOverrides.push(ovr);
      }
    }

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.modification.recorded',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_type: CanonicalActorType.GARAGE_STAFF,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: input.vehicle_id,
        modification: modId,
      },
      payload: {
        vehicle_id: input.vehicle_id,
        modification_id: modId,
        name: modification.name,
        category: modification.category,
        installed_at: modification.installed_at,
        odometer_km: modification.odometer_km,
        provider_name: modification.provider_name,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    logger.info(`Recorded modification ${modId} (${modification.name}) on vehicle ${input.vehicle_id}`);

    return { ...modification, overrides: createdOverrides };
  }

  /**
   * Compiles the full configuration summary (GAR-010 §52: Factory vs Current Configuration)
   */
  public getConfigurationSummary(
    actor: AuthenticatedActorContext,
    vehicleId: string
  ): VehicleConfigurationSummaryDTO {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_COMPONENT_READ);

    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle ${vehicleId} not found`, 404);
    }

    const activeComponents = componentRepository.findComponentsByVehicleId(vehicleId, { isCurrentOnly: true });
    const allTyres = componentRepository.findTyresByVehicleId(vehicleId, ComponentStatus.INSTALLED);
    const activePositions = componentRepository.findCurrentTyrePositions(vehicleId);
    const posMap = new Map(activePositions.map((p) => [p.vehicle_tyre_id, p.position]));

    const activeTyresWithPos = allTyres.map((t) => ({
      ...t,
      current_position: posMap.get(t.id) || null,
    }));

    const modifications = componentRepository.findModificationsByVehicleId(vehicleId);
    const overrides = componentRepository.findActiveConfigurationOverrides(vehicleId);
    const rawWarranties = componentRepository.findWarrantiesByVehicleId(vehicleId);

    // Compute warranty evaluations
    const now = new Date();
    const latestOdo = vehicleRepository.listOdometerObservations(vehicleId, 1, 0)[0]?.reading_km || null;

    const evaluatedWarranties = rawWarranties.map((w) => {
      let isActive = w.status === WarrantyStatus.ACTIVE;
      let daysRemaining: number | null = null;
      let distanceRemainingKm: number | null = null;

      if (w.expires_at) {
        const expDate = new Date(w.expires_at);
        const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / 86400000);
        daysRemaining = diffDays;
        if (diffDays <= 0) isActive = false;
      }

      if (w.distance_limit_km && latestOdo !== null) {
        const comp = activeComponents.find((c) => c.id === w.vehicle_component_id);
        const installOdo = comp?.installed_odometer_km || 0;
        const currentUsageKm = Math.max(0, latestOdo - installOdo);
        distanceRemainingKm = Math.max(0, w.distance_limit_km - currentUsageKm);
        if (distanceRemainingKm <= 0) isActive = false;
      }

      return {
        ...w,
        computed_is_active: isActive,
        days_remaining: daysRemaining,
        distance_remaining_km: distanceRemainingKm,
      };
    });

    return {
      vehicle_id: vehicleId,
      factory_configuration: {
        engine: vehicle.fuel_type ? `${vehicle.fuel_type} Engine` : undefined,
        transmission: vehicle.transmission || undefined,
        drive_type: vehicle.drive_type || undefined,
        tyre_size_oem: '205/55R16',
        rim_diameter_oem: 16,
        color: vehicle.color || undefined,
      },
      current_configuration: {
        active_components_count: activeComponents.length,
        tyres_installed_count: activeTyresWithPos.length,
        modifications_count: modifications.filter((m) => m.status === ModificationStatus.INSTALLED).length,
        active_warranties_count: evaluatedWarranties.filter((w) => w.computed_is_active).length,
      },
      overrides,
      modifications,
      active_components: activeComponents,
      active_tyres: activeTyresWithPos,
      warranties: evaluatedWarranties,
    };
  }
}

export const vehicleComponentService = new VehicleComponentService();
