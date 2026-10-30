/**
 * Canonical Maintenance & Service Scheduling Service (GAR-006, GAR-005, GAR-033 §12D)
 *
 * Coordinates maintenance plans, due-state recalculations, completions,
 * deferrals, timeline projections, and outbox domain events.
 */

import { maintenanceRepository } from './maintenanceRepository';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { evaluateMaintenanceDueState } from './dueStateEngine';
import { normalizeDistanceToKm } from '../domain/distance';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalUuid } from '../domain/id';
import { enqueueOutboxEvent } from '../events/outbox';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { withTransaction } from '../database/transaction';
import {
  VehicleMaintenanceStatusSummary,
  EnrichedMaintenanceCycle,
  RecordCompletionInput,
  RecordDeferralInput,
  UpdatePlanEntryInput,
  AddPlanEntryInput,
  MaintenanceCycleStatus,
  MaintenanceVerificationStatus,
  MaintenancePlanStatus,
  MaintenancePlanSource,
  MaintenanceCompletionEntity,
  MaintenanceDeferralEntity,
  MaintenanceCycleEntity,
  MaintenanceReminderEntity,
  MaintenanceReminderType,
  MaintenanceReminderChannel,
  MaintenanceReminderStatus,
} from './types';
import { OdometerUnit } from '../vehicle/types';
import { logger } from '../observability/logger';
import { passportBuilder } from '../timeline/passportBuilder';

export class MaintenanceService {
  /**
   * Retrieves the comprehensive maintenance due-state summary for a vehicle
   */
  getVehicleMaintenanceStatus(vehicleId: string): VehicleMaintenanceStatusSummary {
    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }

    const currentOdoKm = normalizeDistanceToKm(
      vehicle.current_odometer_cache || 0,
      vehicle.current_odometer_unit || OdometerUnit.KM
    );

    const plan = maintenanceRepository.getActivePlanForVehicle(vehicleId);
    if (!plan) {
      return {
        vehicle_id: vehicleId,
        overall_status: MaintenanceCycleStatus.UNKNOWN,
        total_requirements: 0,
        overdue_count: 0,
        due_count: 0,
        approaching_count: 0,
        ok_count: 0,
        deferred_count: 0,
        next_due_item: null,
        active_cycles: [],
        evaluated_at: getCurrentUtcIsoString(),
      };
    }

    const planEntries = maintenanceRepository.listPlanEntries(plan.id);
    const enabledEntries = planEntries.filter((e) => e.enabled);

    const enrichedCycles: EnrichedMaintenanceCycle[] = [];
    const now = getCurrentUtcIsoString();

    for (const entry of enabledEntries) {
      const requirement = maintenanceRepository.getRequirementById(entry.requirement_id);
      const rule = maintenanceRepository.getRuleById(entry.rule_id);
      if (!requirement || !rule) continue;

      let cycle = maintenanceRepository.getActiveCycleForPlanEntry(entry.id);

      // If no active cycle exists, initialize cycle 1
      if (!cycle) {
        const cycleId = `mc_${generateCanonicalUuid()}`;
        const evalResult = evaluateMaintenanceDueState({
          baselineDistanceKm: 0,
          baselineDate: vehicle.manufacture_date || '2024-01-01T00:00:00.000Z',
          currentOdometerKm: currentOdoKm,
          rule,
          planEntry: entry,
        });

        cycle = {
          id: cycleId,
          vehicle_id: vehicleId,
          plan_entry_id: entry.id,
          requirement_id: requirement.id,
          rule_id: rule.id,
          cycle_number: 1,
          baseline_distance_km: 0,
          baseline_date: vehicle.manufacture_date || '2024-01-01T00:00:00.000Z',
          due_distance_km: evalResult.dueDistanceKm,
          due_date: evalResult.dueDate,
          status: evalResult.status,
          trigger_reason: evalResult.triggerReason,
          distance_remaining_km: evalResult.distanceRemainingKm,
          days_remaining: evalResult.daysRemaining,
          deferred_until_date: null,
          deferred_until_distance_km: null,
          deferral_reason: null,
          completed_at: null,
          completion_id: null,
          last_evaluated_at: now,
          created_at: now,
          updated_at: now,
        };
        maintenanceRepository.insertCycle(cycle);
      } else {
        // Re-evaluate cycle against current vehicle odometer
        const evalResult = evaluateMaintenanceDueState({
          baselineDistanceKm: cycle.baseline_distance_km,
          baselineDate: cycle.baseline_date,
          currentOdometerKm: currentOdoKm,
          rule,
          planEntry: entry,
          deferredUntilDate: cycle.deferred_until_date,
          deferredUntilDistanceKm: cycle.deferred_until_distance_km,
          deferralReason: cycle.deferral_reason,
        });

        // Update if values shifted
        if (
          cycle.status !== evalResult.status ||
          cycle.distance_remaining_km !== evalResult.distanceRemainingKm ||
          cycle.days_remaining !== evalResult.daysRemaining
        ) {
          maintenanceRepository.updateCycleEvaluation(cycle.id, {
            status: evalResult.status,
            due_distance_km: evalResult.dueDistanceKm,
            due_date: evalResult.dueDate,
            distance_remaining_km: evalResult.distanceRemainingKm,
            days_remaining: evalResult.daysRemaining,
            trigger_reason: evalResult.triggerReason,
            last_evaluated_at: now,
          });
          cycle.status = evalResult.status;
          cycle.distance_remaining_km = evalResult.distanceRemainingKm;
          cycle.days_remaining = evalResult.daysRemaining;
          cycle.trigger_reason = evalResult.triggerReason;
          cycle.due_distance_km = evalResult.dueDistanceKm;
          cycle.due_date = evalResult.dueDate;
        }
      }

      // Fetch last completion if any
      let lastCompletion: MaintenanceCompletionEntity | null = null;
      if (entry.last_known_completion_id) {
        lastCompletion = maintenanceRepository.getCompletionById(entry.last_known_completion_id);
      }

      const evalResult = evaluateMaintenanceDueState({
        baselineDistanceKm: cycle.baseline_distance_km,
        baselineDate: cycle.baseline_date,
        currentOdometerKm: currentOdoKm,
        rule,
        planEntry: entry,
        deferredUntilDate: cycle.deferred_until_date,
        deferredUntilDistanceKm: cycle.deferred_until_distance_km,
        deferralReason: cycle.deferral_reason,
      });

      enrichedCycles.push({
        cycle,
        requirement,
        rule,
        plan_entry: entry,
        last_completion: lastCompletion,
        distance_progress_percent: evalResult.distanceProgressPercent,
        time_progress_percent: evalResult.timeProgressPercent,
        effective_urgency_score: evalResult.urgencyScore,
      });
    }

    // Sort cycles by urgency score descending
    enrichedCycles.sort((a, b) => b.effective_urgency_score - a.effective_urgency_score);

    // Compute summary counts
    let overdueCount = 0;
    let dueCount = 0;
    let approachingCount = 0;
    let okCount = 0;
    let deferredCount = 0;

    for (const item of enrichedCycles) {
      switch (item.cycle.status) {
        case MaintenanceCycleStatus.OVERDUE:
          overdueCount++;
          break;
        case MaintenanceCycleStatus.DUE:
          dueCount++;
          break;
        case MaintenanceCycleStatus.APPROACHING_DUE:
          approachingCount++;
          break;
        case MaintenanceCycleStatus.DEFERRED:
          deferredCount++;
          break;
        case MaintenanceCycleStatus.OK:
          okCount++;
          break;
      }
    }

    // Determine overall status
    let overallStatus = MaintenanceCycleStatus.OK;
    if (overdueCount > 0) {
      overallStatus = MaintenanceCycleStatus.OVERDUE;
    } else if (dueCount > 0) {
      overallStatus = MaintenanceCycleStatus.DUE;
    } else if (approachingCount > 0) {
      overallStatus = MaintenanceCycleStatus.APPROACHING_DUE;
    } else if (deferredCount > 0 && okCount === 0) {
      overallStatus = MaintenanceCycleStatus.DEFERRED;
    }

    const nextDueItem = enrichedCycles.length > 0
      ? {
          requirement_name: enrichedCycles[0].requirement.name,
          category: enrichedCycles[0].requirement.category,
          status: enrichedCycles[0].cycle.status,
          due_date: enrichedCycles[0].cycle.due_date,
          due_distance_km: enrichedCycles[0].cycle.due_distance_km,
          distance_remaining_km: enrichedCycles[0].cycle.distance_remaining_km,
          days_remaining: enrichedCycles[0].cycle.days_remaining,
        }
      : null;

    return {
      vehicle_id: vehicleId,
      overall_status: overallStatus,
      total_requirements: enrichedCycles.length,
      overdue_count: overdueCount,
      due_count: dueCount,
      approaching_count: approachingCount,
      ok_count: okCount,
      deferred_count: deferredCount,
      next_due_item: nextDueItem,
      active_cycles: enrichedCycles,
      evaluated_at: now,
    };
  }

  /**
   * Records completion of a maintenance requirement
   */
  recordCompletion(
    vehicleId: string,
    input: RecordCompletionInput,
    actorId: string
  ): MaintenanceCompletionEntity {
    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }

    const requirement = maintenanceRepository.getRequirementById(input.requirement_id);
    if (!requirement) {
      throw new Error(`Maintenance requirement not found: ${input.requirement_id}`);
    }

    const now = getCurrentUtcIsoString();
    const completionId = `mcomp_${generateCanonicalUuid()}`;
    const correlationId = generateCanonicalUuid();

    // Normalize completion odometer
    const rawOdo = Number(input.odometer_value);
    if (isNaN(rawOdo) || rawOdo < 0) {
      throw new Error('Valid odometer value is required');
    }
    const odoUnit = (input.odometer_unit as OdometerUnit) || OdometerUnit.KM;
    const normalizedKm = normalizeDistanceToKm(rawOdo, odoUnit);

    const completion: MaintenanceCompletionEntity = {
      id: completionId,
      vehicle_id: vehicleId,
      plan_entry_id: input.plan_entry_id || null,
      requirement_id: input.requirement_id,
      cycle_id: input.cycle_id || null,
      completed_at: input.completed_at || now,
      odometer_value: rawOdo,
      odometer_unit: odoUnit,
      service_provider_id: input.service_provider_id || null,
      service_provider_name: input.service_provider_name || 'Owner / Self',
      service_record_id: null,
      performed_actions: input.performed_actions && input.performed_actions.length > 0
        ? input.performed_actions
        : [`Completed service for ${requirement.name}`],
      replaced_parts: input.replaced_parts || [],
      cost_total: Number(input.cost_total || 0),
      currency: input.currency || 'KES',
      notes: input.notes || null,
      recorded_by: actorId,
      verification_status: input.verification_status || MaintenanceVerificationStatus.OWNER_ASSERTED,
      document_id: input.document_id || null,
      created_at: now,
      updated_at: now,
    };

    let newCycle: MaintenanceCycleEntity | null = null;

    withTransaction(({ db }) => {
      // 1. Insert completion record
      maintenanceRepository.insertCompletion(completion);

      // 2. Resolve plan entry
      let planEntry = input.plan_entry_id
        ? maintenanceRepository.getPlanEntryById(input.plan_entry_id)
        : null;

      if (!planEntry) {
        const plan = maintenanceRepository.getActivePlanForVehicle(vehicleId);
        if (plan) {
          planEntry = maintenanceRepository.getPlanEntryByRequirement(plan.id, input.requirement_id);
        }
      }

      if (planEntry) {
        // Update plan entry's last known completion
        maintenanceRepository.updatePlanEntry(planEntry.id, {
          last_known_completion_id: completionId,
        });

        // 3. Mark current cycle completed
        const activeCycle = maintenanceRepository.getActiveCycleForPlanEntry(planEntry.id);
        if (activeCycle) {
          maintenanceRepository.markCycleCompleted(activeCycle.id, completionId, completion.completed_at);
        }

        // 4. Create NEW cycle (cycle_number + 1)
        const rule = maintenanceRepository.getRuleById(planEntry.rule_id);
        if (rule) {
          const nextCycleNumber = activeCycle ? activeCycle.cycle_number + 1 : 1;
          const nextCycleId = `mc_${generateCanonicalUuid()}`;

          // Evaluate next cycle state starting from this completion
          const currentVehicleKm = normalizeDistanceToKm(
            vehicle.current_odometer_cache || 0,
            vehicle.current_odometer_unit || OdometerUnit.KM
          );
          const effectiveVehicleKm = Math.max(currentVehicleKm, normalizedKm);

          const evalResult = evaluateMaintenanceDueState({
            baselineDistanceKm: normalizedKm,
            baselineDate: completion.completed_at,
            currentOdometerKm: effectiveVehicleKm,
            rule,
            planEntry,
          });

          newCycle = {
            id: nextCycleId,
            vehicle_id: vehicleId,
            plan_entry_id: planEntry.id,
            requirement_id: requirement.id,
            rule_id: rule.id,
            cycle_number: nextCycleNumber,
            baseline_distance_km: normalizedKm,
            baseline_date: completion.completed_at,
            due_distance_km: evalResult.dueDistanceKm,
            due_date: evalResult.dueDate,
            status: evalResult.status,
            trigger_reason: evalResult.triggerReason,
            distance_remaining_km: evalResult.distanceRemainingKm,
            days_remaining: evalResult.daysRemaining,
            deferred_until_date: null,
            deferred_until_distance_km: null,
            deferral_reason: null,
            completed_at: null,
            completion_id: null,
            last_evaluated_at: now,
            created_at: now,
            updated_at: now,
          };
          maintenanceRepository.insertCycle(newCycle);
        }
      }

      // 5. Emit Outbox event: maintenance.completed
      const eventEnvelope = createCanonicalEventEnvelope({
        type: 'maintenance.completed',
        correlation_id: correlationId,
        actor_id: actorId,
        actor_type: CanonicalActorType.VEHICLE_OWNER,
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        subject_ids: {
          vehicle: vehicleId,
          maintenance_completion: completion.id,
          maintenance_requirement: requirement.id,
        },
        payload: {
          completion_id: completion.id,
          vehicle_id: vehicleId,
          requirement_id: requirement.id,
          requirement_code: requirement.code,
          requirement_name: requirement.name,
          completed_at: completion.completed_at,
          odometer_value: completion.odometer_value,
          odometer_unit: completion.odometer_unit,
          normalized_km: normalizedKm,
          service_provider_name: completion.service_provider_name,
          cost_total: completion.cost_total,
          currency: completion.currency,
          replaced_parts: completion.replaced_parts,
          performed_actions: completion.performed_actions,
          verification_status: completion.verification_status,
          recorded_by: actorId,
        },
      });

      enqueueOutboxEvent(eventEnvelope, db);
    });

    // Rebuild passport projection immediately so verified maintenance shows up
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to auto-rebuild passport on maintenance completion: ${err}`);
    }

    logger.info(`Recorded maintenance completion [${completionId}] for vehicle [${vehicleId}]`);
    return completion;
  }

  /**
   * Records deferral of an active maintenance cycle
   */
  recordDeferral(
    vehicleId: string,
    input: RecordDeferralInput,
    actorId: string
  ): void {
    const cycle = maintenanceRepository.getCycleById(input.cycle_id);
    if (!cycle || cycle.vehicle_id !== vehicleId) {
      throw new Error(`Active maintenance cycle not found: ${input.cycle_id}`);
    }

    const now = getCurrentUtcIsoString();
    const deferralId = `mdef_${generateCanonicalUuid()}`;
    const correlationId = generateCanonicalUuid();

    const deferral: MaintenanceDeferralEntity = {
      id: deferralId,
      vehicle_id: vehicleId,
      cycle_id: cycle.id,
      plan_entry_id: cycle.plan_entry_id,
      deferred_at: now,
      deferred_by: actorId,
      reason: input.reason,
      deferred_until_date: input.deferred_until_date || null,
      deferred_until_distance_km: input.deferred_until_distance_km || null,
      created_at: now,
    };

    withTransaction(({ db }) => {
      maintenanceRepository.insertDeferral(deferral);
      maintenanceRepository.deferCycle(cycle.id, {
        deferred_until_date: input.deferred_until_date,
        deferred_until_distance_km: input.deferred_until_distance_km,
        deferral_reason: input.reason,
      });

      const eventEnvelope = createCanonicalEventEnvelope({
        type: 'maintenance.deferred',
        correlation_id: correlationId,
        actor_id: actorId,
        actor_type: CanonicalActorType.VEHICLE_OWNER,
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        subject_ids: {
          vehicle: vehicleId,
          maintenance_cycle: cycle.id,
          maintenance_deferral: deferralId,
        },
        payload: {
          deferral_id: deferralId,
          cycle_id: cycle.id,
          vehicle_id: vehicleId,
          reason: input.reason,
          deferred_until_date: input.deferred_until_date,
          deferred_until_distance_km: input.deferred_until_distance_km,
        },
      });

      enqueueOutboxEvent(eventEnvelope, db);
    });

    logger.info(`Recorded maintenance deferral [${deferralId}] on cycle [${cycle.id}]`);
  }

  /**
   * Adds a requirement to a vehicle's maintenance plan
   */
  addPlanEntry(
    vehicleId: string,
    input: AddPlanEntryInput,
    actorId: string
  ): void {
    let plan = maintenanceRepository.getActivePlanForVehicle(vehicleId);
    const now = getCurrentUtcIsoString();

    if (!plan) {
      const planId = `vmp_${generateCanonicalUuid()}`;
      plan = {
        id: planId,
        vehicle_id: vehicleId,
        name: 'Custom Vehicle Maintenance Plan',
        status: MaintenancePlanStatus.ACTIVE,
        source: MaintenancePlanSource.OWNER_DEFINED,
        notes: null,
        created_at: now,
        activated_at: now,
        updated_at: now,
      };
      maintenanceRepository.insertPlan(plan);
    }

    const requirement = maintenanceRepository.getRequirementById(input.requirement_id);
    if (!requirement) {
      throw new Error(`Requirement not found: ${input.requirement_id}`);
    }

    const rules = maintenanceRepository.listRulesForRequirement(input.requirement_id);
    if (rules.length === 0) {
      throw new Error(`No default rules found for requirement: ${input.requirement_id}`);
    }
    const rule = rules[0];

    const existingEntry = maintenanceRepository.getPlanEntryByRequirement(plan.id, input.requirement_id);
    if (existingEntry) {
      maintenanceRepository.updatePlanEntry(existingEntry.id, {
        enabled: true,
        custom_distance_interval: input.custom_distance_interval,
        custom_time_interval_value: input.custom_time_interval_value,
        custom_time_interval_unit: input.custom_time_interval_unit,
        priority_override: input.priority_override,
      });
      return;
    }

    const entryId = `vmpe_${generateCanonicalUuid()}`;
    maintenanceRepository.insertPlanEntry({
      id: entryId,
      plan_id: plan.id,
      requirement_id: requirement.id,
      rule_id: rule.id,
      enabled: true,
      priority_override: input.priority_override || null,
      custom_distance_interval: input.custom_distance_interval || null,
      custom_time_interval_value: input.custom_time_interval_value || null,
      custom_time_interval_unit: input.custom_time_interval_unit || null,
      last_known_completion_id: null,
      notes: input.notes || null,
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * Updates a plan entry (e.g. interval customization, toggle enabled)
   */
  updatePlanEntry(
    vehicleId: string,
    entryId: string,
    input: UpdatePlanEntryInput,
    actorId: string
  ): void {
    const entry = maintenanceRepository.getPlanEntryById(entryId);
    if (!entry) {
      throw new Error(`Plan entry not found: ${entryId}`);
    }

    maintenanceRepository.updatePlanEntry(entryId, {
      enabled: input.enabled,
      custom_distance_interval: input.custom_distance_interval,
      custom_time_interval_value: input.custom_time_interval_value,
      custom_time_interval_unit: input.custom_time_interval_unit,
      priority_override: input.priority_override,
      notes: input.notes,
    });

    // Re-evaluate current active cycle if active
    const cycle = maintenanceRepository.getActiveCycleForPlanEntry(entryId);
    if (cycle) {
      const vehicle = vehicleRepository.getVehicleById(vehicleId);
      const rule = maintenanceRepository.getRuleById(entry.rule_id);
      if (vehicle && rule) {
        const currentOdoKm = normalizeDistanceToKm(
          vehicle.current_odometer_cache || 0,
          vehicle.current_odometer_unit || OdometerUnit.KM
        );
        const updatedEntry = maintenanceRepository.getPlanEntryById(entryId)!;
        const evalResult = evaluateMaintenanceDueState({
          baselineDistanceKm: cycle.baseline_distance_km,
          baselineDate: cycle.baseline_date,
          currentOdometerKm: currentOdoKm,
          rule,
          planEntry: updatedEntry,
        });

        maintenanceRepository.updateCycleEvaluation(cycle.id, {
          status: evalResult.status,
          due_distance_km: evalResult.dueDistanceKm,
          due_date: evalResult.dueDate,
          distance_remaining_km: evalResult.distanceRemainingKm,
          days_remaining: evalResult.daysRemaining,
          trigger_reason: evalResult.triggerReason,
          last_evaluated_at: getCurrentUtcIsoString(),
        });
      }
    }
  }

  /**
   * Retrieves past maintenance completions for a vehicle
   */
  getMaintenanceHistory(vehicleId: string): MaintenanceCompletionEntity[] {
    return maintenanceRepository.listCompletionsForVehicle(vehicleId, 100);
  }
}

export const maintenanceService = new MaintenanceService();
