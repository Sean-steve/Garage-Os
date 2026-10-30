/**
 * Canonical Due-State Intelligence Engine (GAR-006 §6-§14, §18-§25)
 *
 * Deterministic calculation of maintenance requirements, intervals,
 * approaching-due thresholds, overdue states, and deferral handling.
 */

import {
  MaintenanceCycleStatus,
  MaintenanceIntervalType,
  MaintenanceTriggerPolicy,
  MaintenanceRuleEntity,
  VehicleMaintenancePlanEntryEntity,
} from './types';
import { addCalendarInterval, calculateDaysRemaining } from './calendar';

export interface EvaluationInput {
  baselineDistanceKm: number;
  baselineDate: string | Date;
  currentOdometerKm: number;
  evaluationDate?: string | Date;
  rule: MaintenanceRuleEntity;
  planEntry?: VehicleMaintenancePlanEntryEntity | null;
  deferredUntilDate?: string | null;
  deferredUntilDistanceKm?: number | null;
  deferralReason?: string | null;
}

export interface EvaluationResult {
  dueDistanceKm: number | null;
  dueDate: string | null;
  distanceRemainingKm: number | null;
  daysRemaining: number | null;
  status: MaintenanceCycleStatus;
  triggerReason: string;
  distanceProgressPercent: number | null;
  timeProgressPercent: number | null;
  urgencyScore: number;
}

const STATUS_SEVERITY_RANK: Record<MaintenanceCycleStatus, number> = {
  [MaintenanceCycleStatus.OVERDUE]: 5,
  [MaintenanceCycleStatus.DUE]: 4,
  [MaintenanceCycleStatus.APPROACHING_DUE]: 3,
  [MaintenanceCycleStatus.DEFERRED]: 2,
  [MaintenanceCycleStatus.OK]: 1,
  [MaintenanceCycleStatus.COMPLETED]: 0,
  [MaintenanceCycleStatus.DISMISSED]: 0,
  [MaintenanceCycleStatus.UNKNOWN]: 0,
};

/**
 * Evaluates a single maintenance requirement cycle deterministically
 */
export function evaluateMaintenanceDueState(input: EvaluationInput): EvaluationResult {
  const now = input.evaluationDate ? new Date(input.evaluationDate) : new Date();
  const baselineDate = new Date(input.baselineDate);
  const currentKm = input.currentOdometerKm || 0;

  // 1. Resolve effective intervals (checking plan entry overrides)
  const effectiveDistanceInterval =
    input.planEntry?.custom_distance_interval !== null && input.planEntry?.custom_distance_interval !== undefined
      ? input.planEntry.custom_distance_interval
      : input.rule.distance_interval;

  const effectiveTimeValue =
    input.planEntry?.custom_time_interval_value !== null && input.planEntry?.custom_time_interval_value !== undefined
      ? input.planEntry.custom_time_interval_value
      : input.rule.time_interval_value;

  const effectiveTimeUnit =
    input.planEntry?.custom_time_interval_unit || input.rule.time_interval_unit;

  // 2. Compute due thresholds
  let dueDistanceKm: number | null = null;
  let distanceRemainingKm: number | null = null;
  let distanceProgressPercent: number | null = null;
  let distanceState: MaintenanceCycleStatus | null = null;

  if (
    effectiveDistanceInterval !== null &&
    effectiveDistanceInterval > 0 &&
    input.rule.interval_type !== MaintenanceIntervalType.TIME
  ) {
    dueDistanceKm = Math.round((input.baselineDistanceKm + effectiveDistanceInterval) * 100) / 100;
    distanceRemainingKm = Math.round((dueDistanceKm - currentKm) * 100) / 100;

    const distanceElapsed = currentKm - input.baselineDistanceKm;
    distanceProgressPercent = Math.max(0, Math.round((distanceElapsed / effectiveDistanceInterval) * 100));

    const approachingThreshold = input.rule.approaching_distance_threshold || 1000;
    const dueThreshold = 200; // within 200 km of target

    if (distanceRemainingKm < 0) {
      distanceState = MaintenanceCycleStatus.OVERDUE;
    } else if (distanceRemainingKm <= dueThreshold) {
      distanceState = MaintenanceCycleStatus.DUE;
    } else if (distanceRemainingKm <= approachingThreshold) {
      distanceState = MaintenanceCycleStatus.APPROACHING_DUE;
    } else {
      distanceState = MaintenanceCycleStatus.OK;
    }
  }

  let dueDateIso: string | null = null;
  let daysRemaining: number | null = null;
  let timeProgressPercent: number | null = null;
  let timeState: MaintenanceCycleStatus | null = null;

  if (
    effectiveTimeValue !== null &&
    effectiveTimeValue > 0 &&
    effectiveTimeUnit &&
    input.rule.interval_type !== MaintenanceIntervalType.DISTANCE
  ) {
    const calculatedDueDate = addCalendarInterval(baselineDate, effectiveTimeValue, effectiveTimeUnit);
    dueDateIso = calculatedDueDate.toISOString();
    daysRemaining = calculateDaysRemaining(calculatedDueDate, now);

    const totalTimeSpanMs = calculatedDueDate.getTime() - baselineDate.getTime();
    const elapsedTimeMs = now.getTime() - baselineDate.getTime();
    if (totalTimeSpanMs > 0) {
      timeProgressPercent = Math.max(0, Math.round((elapsedTimeMs / totalTimeSpanMs) * 100));
    }

    const approachingDaysThreshold = input.rule.approaching_time_threshold_days || 30;
    const dueDaysThreshold = 7; // within 7 days of target

    if (daysRemaining < 0) {
      timeState = MaintenanceCycleStatus.OVERDUE;
    } else if (daysRemaining <= dueDaysThreshold) {
      timeState = MaintenanceCycleStatus.DUE;
    } else if (daysRemaining <= approachingDaysThreshold) {
      timeState = MaintenanceCycleStatus.APPROACHING_DUE;
    } else {
      timeState = MaintenanceCycleStatus.OK;
    }
  }

  // 3. Evaluate Deferral
  const hasDeferredDate = !!input.deferredUntilDate;
  const hasDeferredKm = input.deferredUntilDistanceKm !== null && input.deferredUntilDistanceKm !== undefined;

  if (hasDeferredDate || hasDeferredKm) {
    let deferralExpired = false;

    if (hasDeferredDate && input.deferredUntilDate) {
      const defDate = new Date(input.deferredUntilDate);
      if (now.getTime() > defDate.getTime()) {
        deferralExpired = true;
      }
    }

    if (hasDeferredKm && input.deferredUntilDistanceKm !== null && input.deferredUntilDistanceKm !== undefined) {
      if (currentKm > input.deferredUntilDistanceKm) {
        deferralExpired = true;
      }
    }

    if (!deferralExpired) {
      return {
        dueDistanceKm,
        dueDate: dueDateIso,
        distanceRemainingKm,
        daysRemaining,
        status: MaintenanceCycleStatus.DEFERRED,
        triggerReason: input.deferralReason ? `Deferred: ${input.deferralReason}` : 'Deferred by owner',
        distanceProgressPercent,
        timeProgressPercent,
        urgencyScore: 150,
      };
    }
  }

  // 4. Combine Triggers according to Trigger Policy
  let resolvedStatus = MaintenanceCycleStatus.OK;
  let triggerReason = 'Within normal service interval';

  const policy = input.rule.trigger_policy;

  if (policy === MaintenanceTriggerPolicy.DISTANCE_ONLY) {
    resolvedStatus = distanceState || MaintenanceCycleStatus.UNKNOWN;
    triggerReason = distanceRemainingKm !== null && distanceRemainingKm < 0
      ? `Distance target exceeded by ${Math.abs(distanceRemainingKm)} km`
      : `${distanceRemainingKm ?? 0} km remaining`;
  } else if (policy === MaintenanceTriggerPolicy.TIME_ONLY) {
    resolvedStatus = timeState || MaintenanceCycleStatus.UNKNOWN;
    triggerReason = daysRemaining !== null && daysRemaining < 0
      ? `Time interval exceeded by ${Math.abs(daysRemaining)} days`
      : `${daysRemaining ?? 0} days remaining`;
  } else if (policy === MaintenanceTriggerPolicy.WHICHEVER_COMES_LAST) {
    // Both triggers must mature
    if (!distanceState && !timeState) {
      resolvedStatus = MaintenanceCycleStatus.UNKNOWN;
      triggerReason = 'No distance or time rule configured';
    } else if (!distanceState) {
      resolvedStatus = timeState!;
      triggerReason = 'Time-based schedule';
    } else if (!timeState) {
      resolvedStatus = distanceState!;
      triggerReason = 'Mileage-based schedule';
    } else {
      const rankDist = STATUS_SEVERITY_RANK[distanceState];
      const rankTime = STATUS_SEVERITY_RANK[timeState];
      if (rankDist <= rankTime) {
        resolvedStatus = distanceState;
        triggerReason = `Distance trigger trailing (${distanceRemainingKm} km remaining)`;
      } else {
        resolvedStatus = timeState;
        triggerReason = `Time trigger trailing (${daysRemaining} days remaining)`;
      }
    }
  } else {
    // Default: WHICHEVER_COMES_FIRST
    if (!distanceState && !timeState) {
      resolvedStatus = MaintenanceCycleStatus.UNKNOWN;
      triggerReason = 'No interval metrics configured';
    } else if (!distanceState) {
      resolvedStatus = timeState!;
      triggerReason = daysRemaining !== null && daysRemaining < 0
        ? `Overdue by ${Math.abs(daysRemaining)} days`
        : `Due in ${daysRemaining} days`;
    } else if (!timeState) {
      resolvedStatus = distanceState!;
      triggerReason = distanceRemainingKm !== null && distanceRemainingKm < 0
        ? `Overdue by ${Math.abs(distanceRemainingKm)} km`
        : `Due in ${distanceRemainingKm} km`;
    } else {
      const rankDist = STATUS_SEVERITY_RANK[distanceState];
      const rankTime = STATUS_SEVERITY_RANK[timeState];
      if (rankDist >= rankTime) {
        resolvedStatus = distanceState;
        triggerReason = distanceRemainingKm !== null && distanceRemainingKm < 0
          ? `Overdue by ${Math.abs(distanceRemainingKm)} km`
          : `Due in ${distanceRemainingKm} km`;
      } else {
        resolvedStatus = timeState;
        triggerReason = daysRemaining !== null && daysRemaining < 0
          ? `Overdue by ${Math.abs(daysRemaining)} days`
          : `Due in ${daysRemaining} days`;
      }
    }
  }

  // 5. Calculate Deterministic Urgency Score
  let urgencyScore = 0;
  if (resolvedStatus === MaintenanceCycleStatus.OVERDUE) {
    const overdueKmScore = distanceRemainingKm !== null && distanceRemainingKm < 0 ? Math.abs(distanceRemainingKm) / 5 : 0;
    const overdueDaysScore = daysRemaining !== null && daysRemaining < 0 ? Math.abs(daysRemaining) * 10 : 0;
    urgencyScore = 1000 + overdueKmScore + overdueDaysScore;
  } else if (resolvedStatus === MaintenanceCycleStatus.DUE) {
    urgencyScore = 800 + (daysRemaining !== null ? Math.max(0, 100 - daysRemaining * 10) : 50);
  } else if (resolvedStatus === MaintenanceCycleStatus.APPROACHING_DUE) {
    const remainingKmBonus = distanceRemainingKm !== null ? Math.max(0, 1000 - distanceRemainingKm) / 5 : 0;
    const remainingDaysBonus = daysRemaining !== null ? Math.max(0, 30 - daysRemaining) * 5 : 0;
    urgencyScore = 400 + remainingKmBonus + remainingDaysBonus;
  } else if (resolvedStatus === MaintenanceCycleStatus.OK) {
    const progress = Math.max(distanceProgressPercent || 0, timeProgressPercent || 0);
    urgencyScore = 100 + progress;
  }

  return {
    dueDistanceKm,
    dueDate: dueDateIso,
    distanceRemainingKm,
    daysRemaining,
    status: resolvedStatus,
    triggerReason,
    distanceProgressPercent,
    timeProgressPercent,
    urgencyScore: Math.round(urgencyScore),
  };
}
