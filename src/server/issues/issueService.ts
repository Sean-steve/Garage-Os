/**
 * Canonical Vehicle Issue, Fault & Persistent Problem Domain Service (GAR-008, GAR-034, GAR-035)
 */

import crypto from 'node:crypto';
import { issueRepository } from './issueRepository';
import {
  VehicleIssue,
  IssueOccurrence,
  IssueObservation,
  IssueSuspectedCause,
  IssueDiagnosis,
  IssueIntervention,
  IssueResolution,
  IssueFollowup,
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  IssuePersistenceState,
  SymptomCategory,
  ObservationType,
  SuspectedCauseStatus,
  DiagnosisOutcome,
  IssueInterventionType,
  IssueInterventionResult,
  IssueResolutionType,
  FollowupStatus,
  FollowupResponse,
  NextRecommendedAction,
  EnrichedVehicleIssue,
  PersistentIssueSummary,
  IssueChronologyItem,
  ReportIssueDTO,
  RecordOccurrenceDTO,
  RecordDiagnosisDTO,
  RecordInterventionDTO,
  ResolveIssueDTO,
  RecurIssueDTO,
  FollowupResponseDTO,
} from './types';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { OdometerUnit } from '../vehicle/types';
import { normalizeDistanceToKm } from '../domain/distance';
import { getCurrentUtcIsoString } from '../domain/time';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { logger } from '../observability/logger';
import { componentRepository } from '../components/componentRepository';
import {
  ComponentCategory,
  ComponentClassification,
  ComponentStatus,
  PartProvenance,
  PartVerificationStatus,
} from '../components/types';

export class IssueService {
  /**
   * Evaluates safety screening for reported symptoms (GAR-008 §48)
   */
  public evaluateSafetyScreening(
    category: IssueCategory,
    symptomCategory?: SymptomCategory,
    description?: string
  ): { isSafetyCritical: boolean; recommendedSeverity: IssueSeverity; safetyGuidance?: string } {
    const text = (description || '').toLowerCase();

    // Critical safety conditions
    const isBrakeLoss =
      category === IssueCategory.BRAKES &&
      (text.includes('fail') || text.includes('floor') || text.includes('no brake') || text.includes('sponge'));
    const isSteeringLoss =
      category === IssueCategory.STEERING &&
      (text.includes('locked') || text.includes('loss') || text.includes('unable to steer') || text.includes('stuck'));
    const isFireOrSmoke =
      text.includes('fire') ||
      text.includes('flame') ||
      text.includes('smoke') ||
      text.includes('burning smell') ||
      symptomCategory === SymptomCategory.SMOKE;
    const isFuelLeak =
      category === IssueCategory.FUEL_SYSTEM ||
      text.includes('fuel leak') ||
      text.includes('petrol leak') ||
      text.includes('diesel leak') ||
      (symptomCategory === SymptomCategory.LEAK && text.includes('fuel'));
    const isSevereOverheating =
      symptomCategory === SymptomCategory.OVERHEATING ||
      text.includes('boiling') ||
      text.includes('steam') ||
      text.includes('red temperature');

    if (isBrakeLoss || isSteeringLoss || isFireOrSmoke || isFuelLeak) {
      return {
        isSafetyCritical: true,
        recommendedSeverity: IssueSeverity.CRITICAL,
        safetyGuidance:
          'CRITICAL SAFETY WARNING: This symptom may severely compromise vehicle control and occupant safety. Do not continue driving until the vehicle is professionally inspected and cleared.',
      };
    }

    if (isSevereOverheating || category === IssueCategory.BRAKES || category === IssueCategory.STEERING) {
      return {
        isSafetyCritical: false,
        recommendedSeverity: IssueSeverity.HIGH,
        safetyGuidance:
          'SAFETY ADVISORY: Brake, steering, and thermal issues can escalate rapidly. Have a qualified technician inspect the vehicle promptly.',
      };
    }

    return {
      isSafetyCritical: false,
      recommendedSeverity: IssueSeverity.MODERATE,
    };
  }

  /**
   * Deterministically calculates persistence state based on occurrences and intervention history (GAR-008 §30)
   */
  public calculatePersistenceState(
    occurrenceCount: number,
    interventionCount: number,
    hasRecurredAfterResolution: boolean,
    isIntermittentCondition: boolean
  ): IssuePersistenceState {
    if (hasRecurredAfterResolution) {
      return IssuePersistenceState.RECURRENT_AFTER_RESOLUTION;
    }
    if (occurrenceCount >= 3 || (occurrenceCount >= 2 && interventionCount >= 1)) {
      return IssuePersistenceState.PERSISTENT;
    }
    if (occurrenceCount >= 2) {
      return IssuePersistenceState.REPEATED;
    }
    if (isIntermittentCondition) {
      return IssuePersistenceState.INTERMITTENT;
    }
    return IssuePersistenceState.SINGLE_OCCURRENCE;
  }

  /**
   * Derives the next recommended action for an issue (GAR-008 §54-§55)
   */
  public deriveNextRecommendedAction(issue: VehicleIssue): NextRecommendedAction {
    if (issue.severity === IssueSeverity.CRITICAL) {
      return {
        action_type: 'STOP_DRIVING_SAFETY_WARNING',
        label: 'Stop Driving & Arrange Recovery',
        reason: 'Critical safety risk identified; driving could lead to component failure or collision.',
        priority: 'CRITICAL',
        recommended_provider_type: 'ROADSIDE_ASSISTANCE',
      };
    }

    if (issue.status === IssueStatus.RESOLVED || issue.status === IssueStatus.CLOSED) {
      return {
        action_type: 'RESOLVED_NO_ACTION',
        label: 'Resolved — No Action Needed',
        reason: 'Issue is confirmed resolved. Routine monitoring continues in vehicle passport.',
        priority: 'LOW',
      };
    }

    if (issue.status === IssueStatus.MONITORING) {
      return {
        action_type: 'AWAITING_FOLLOW_UP',
        label: 'Active Monitoring In Progress',
        reason: 'Repair work was performed. Awaiting operational observation before confirming resolution.',
        priority: 'MEDIUM',
      };
    }

    if (issue.status === IssueStatus.RECURRED || issue.persistence_state === IssuePersistenceState.PERSISTENT) {
      return {
        action_type: 'BOOK_DIAGNOSTIC',
        label: 'Book Specialist Workshop Diagnostic',
        reason: `Persistent symptom has returned after ${issue.intervention_count} previous repair attempt(s). Comprehensive root-cause diagnostic required.`,
        priority: 'HIGH',
        recommended_provider_type: 'SPECIALIST_GARAGE',
      };
    }

    if (issue.status === IssueStatus.DIAGNOSED) {
      return {
        action_type: 'BOOK_REPAIR',
        label: 'Schedule Corrective Repair',
        reason: 'Professional diagnostic inspection is complete. Proceed with recommended repairs.',
        priority: 'HIGH',
        recommended_provider_type: 'CERTIFIED_WORKSHOP',
      };
    }

    return {
      action_type: 'BOOK_INSPECTION',
      label: 'Book Professional Inspection',
      reason: 'Symptom reported. Professional garage inspection recommended to identify underlying cause.',
      priority: 'MEDIUM',
      recommended_provider_type: 'INSPECTION_CENTRE',
    };
  }

  /**
   * Reports a new vehicle issue with initial occurrence (GAR-008 §6-§13, §47)
   */
  public reportIssue(
    vehicleId: string,
    dto: ReportIssueDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.VEHICLE_OWNER
  ): EnrichedVehicleIssue {
    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle with ID ${vehicleId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const occurredAt = dto.occurred_at || now;

    // Safety screening
    const screening = this.evaluateSafetyScreening(
      dto.category,
      dto.symptom_category,
      dto.symptom_description || dto.summary
    );

    const severity = dto.severity || screening.recommendedSeverity;

    // Normalizing odometer
    let odoKm: number | null = null;
    if (dto.odometer_value !== undefined && dto.odometer_value !== null) {
      odoKm = normalizeDistanceToKm(dto.odometer_value, (dto.odometer_unit as 'KM' | 'MILES') || 'KM');
    }

    const isIntermittent =
      dto.driving_condition?.toUpperCase().includes('INTERMITTENT') ||
      (dto.summary + ' ' + (dto.symptom_description || '')).toLowerCase().includes('intermittent');

    const issueId = `iss_${crypto.randomUUID().slice(0, 12)}`;
    const issueCode = `ISS-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const issue: VehicleIssue = {
      id: issueId,
      vehicle_id: vehicleId,
      issue_code: issueCode,
      title: dto.title.trim(),
      summary: dto.summary.trim(),
      category: dto.category,
      severity,
      status: IssueStatus.REPORTED,
      persistence_state: isIntermittent ? IssuePersistenceState.INTERMITTENT : IssuePersistenceState.SINGLE_OCCURRENCE,
      primary_component_category: dto.primary_component_category || null,
      first_observed_at: occurredAt,
      last_observed_at: occurredAt,
      first_observed_odometer_km: odoKm,
      last_observed_odometer_km: odoKm,
      occurrence_count: 1,
      diagnosis_count: 0,
      intervention_count: 0,
      last_intervention_id: null,
      created_by: actorId,
      created_at: now,
      updated_at: now,
    };

    issueRepository.createIssue(issue);

    // Create primary occurrence
    const occId = `occ_${crypto.randomUUID().slice(0, 12)}`;
    const occurrence: IssueOccurrence = {
      id: occId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      occurred_at: occurredAt,
      recorded_at: now,
      odometer_value: dto.odometer_value ?? null,
      odometer_unit: dto.odometer_unit || 'KM',
      odometer_km: odoKm,
      description: (dto.symptom_description || dto.summary).trim(),
      symptom_category: dto.symptom_category || SymptomCategory.OTHER,
      driving_condition: dto.driving_condition || null,
      speed_range: dto.speed_range || null,
      engine_temperature_state: dto.engine_temperature_state || null,
      weather_context: dto.weather_context || null,
      road_condition: dto.road_condition || null,
      source_type: DataProvenanceClass.OWNER_ASSERTED,
      actor_id: actorId,
      location_reference: null,
      evidence_count: 0,
      created_at: now,
    };

    issueRepository.createOccurrence(occurrence);

    // Enqueue outbox domain event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.issue.reported',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_occurrence: occId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        title: issue.title,
        category: issue.category,
        severity: issue.severity,
        symptom_category: occurrence.symptom_category,
        occurred_at: occurredAt,
        odometer_km: odoKm,
        is_safety_critical: screening.isSafetyCritical,
        safety_guidance: screening.safetyGuidance,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Vehicle issue reported: ${issueId} for vehicle ${vehicleId}`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Records a repeat occurrence ("It happened again", GAR-008 §50)
   */
  public recordOccurrence(
    vehicleId: string,
    issueId: string,
    dto: RecordOccurrenceDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.VEHICLE_OWNER
  ): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle issue ${issueId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const occurredAt = dto.occurred_at || now;

    let odoKm: number | null = null;
    if (dto.odometer_value !== undefined && dto.odometer_value !== null) {
      odoKm = normalizeDistanceToKm(dto.odometer_value, (dto.odometer_unit as 'KM' | 'MILES') || 'KM');
    }

    const occId = `occ_${crypto.randomUUID().slice(0, 12)}`;
    const occurrence: IssueOccurrence = {
      id: occId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      occurred_at: occurredAt,
      recorded_at: now,
      odometer_value: dto.odometer_value ?? null,
      odometer_unit: dto.odometer_unit || 'KM',
      odometer_km: odoKm,
      description: dto.description.trim(),
      symptom_category: dto.symptom_category || SymptomCategory.OTHER,
      driving_condition: dto.driving_condition || null,
      speed_range: dto.speed_range || null,
      engine_temperature_state: dto.engine_temperature_state || null,
      weather_context: dto.weather_context || null,
      road_condition: dto.road_condition || null,
      source_type: DataProvenanceClass.OWNER_ASSERTED,
      actor_id: actorId,
      location_reference: null,
      evidence_count: 0,
      created_at: now,
    };

    issueRepository.createOccurrence(occurrence);

    const newOccurrenceCount = issue.occurrence_count + 1;
    const isRecurrenceAfterResolution = issue.status === IssueStatus.RESOLVED;

    // Recalculate persistence state
    const newPersistence = this.calculatePersistenceState(
      newOccurrenceCount,
      issue.intervention_count,
      isRecurrenceAfterResolution,
      dto.driving_condition?.includes('INTERMITTENT') || issue.persistence_state === IssuePersistenceState.INTERMITTENT
    );

    // If was resolved, transition to RECURRED
    let newStatus = issue.status;
    if (isRecurrenceAfterResolution) {
      newStatus = IssueStatus.RECURRED;
    }

    issueRepository.updateIssue(issueId, {
      occurrence_count: newOccurrenceCount,
      last_observed_at: occurredAt,
      last_observed_odometer_km: odoKm || issue.last_observed_odometer_km,
      persistence_state: newPersistence,
      status: newStatus,
    });

    // Enqueue outbox event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: isRecurrenceAfterResolution ? 'vehicle.issue.recurred' : 'vehicle.issue.occurrence_recorded',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_occurrence: occId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        occurrence_count: newOccurrenceCount,
        persistence_state: newPersistence,
        status: newStatus,
        occurred_at: occurredAt,
        odometer_km: odoKm,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Issue occurrence recorded for issue ${issueId}, count: ${newOccurrenceCount}`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Records a professional diagnosis by a qualified service provider (GAR-008 §17-§19)
   */
  public recordDiagnosis(
    vehicleId: string,
    issueId: string,
    dto: RecordDiagnosisDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.GARAGE_STAFF
  ): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle issue ${issueId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const diagId = `diag_${crypto.randomUUID().slice(0, 12)}`;

    const diagnosis: IssueDiagnosis = {
      id: diagId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      provider_id: dto.provider_id || 'srv_seed_garage_01',
      provider_name: dto.provider_name.trim(),
      technician_id: dto.technician_id || null,
      technician_name: dto.technician_name ? dto.technician_name.trim() : null,
      diagnosed_at: dto.diagnosed_at || now,
      diagnosis_code: dto.diagnosis_code ? dto.diagnosis_code.trim() : null,
      diagnosis_summary: dto.diagnosis_summary.trim(),
      diagnosis_details: dto.diagnosis_details.trim(),
      confirmed_component: dto.confirmed_component ? dto.confirmed_component.trim() : null,
      outcome: dto.outcome || DiagnosisOutcome.CONFIRMED,
      verification_status: 'PROVIDER_RECORDED', // Explicit invariant: Provider's record is PROVIDER_RECORDED
      evidence_reference_ids: [],
      source_work_order_id: dto.source_work_order_id || null,
      created_at: now,
    };

    issueRepository.createDiagnosis(diagnosis);

    const newDiagnosisCount = issue.diagnosis_count + 1;
    let newStatus = issue.status;
    if (issue.status === IssueStatus.REPORTED || issue.status === IssueStatus.DIAGNOSIS_PENDING) {
      newStatus = IssueStatus.DIAGNOSED;
    }

    issueRepository.updateIssue(issueId, {
      diagnosis_count: newDiagnosisCount,
      primary_component_category: diagnosis.confirmed_component || issue.primary_component_category,
      status: newStatus,
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.issue.diagnosis_recorded',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_diagnosis: diagId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        diagnosis_id: diagId,
        provider_name: diagnosis.provider_name,
        diagnosis_summary: diagnosis.diagnosis_summary,
        confirmed_component: diagnosis.confirmed_component,
        outcome: diagnosis.outcome,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Professional diagnosis recorded for issue ${issueId} by ${diagnosis.provider_name}`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Records an intervention or repair attempt (GAR-008 §20-§24)
   * Critical Invariant: Repair performed DOES NOT equal issue resolved!
   * Transitions issue to MONITORING and schedules a follow-up.
   */
  public recordIntervention(
    vehicleId: string,
    issueId: string,
    dto: RecordInterventionDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.GARAGE_STAFF
  ): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle issue ${issueId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const performedAt = dto.performed_at || now;

    let odoKm: number | null = null;
    if (dto.odometer_value !== undefined && dto.odometer_value !== null) {
      odoKm = normalizeDistanceToKm(dto.odometer_value, (dto.odometer_unit as 'KM' | 'MILES') || 'KM');
    }

    const intvId = `intv_${crypto.randomUUID().slice(0, 12)}`;
    const intervention: IssueIntervention = {
      id: intvId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      intervention_type: dto.intervention_type,
      description: dto.description.trim(),
      performed_at: performedAt,
      odometer_value: dto.odometer_value ?? null,
      odometer_unit: dto.odometer_unit || 'KM',
      odometer_km: odoKm,
      provider_id: dto.provider_id || null,
      provider_name: dto.provider_name ? dto.provider_name.trim() : null,
      work_order_id: dto.work_order_id || null,
      replaced_part_names: dto.replaced_part_names || [],
      cost_total: dto.cost_total ?? 0,
      currency: dto.currency || 'KES',
      result: dto.result || IssueInterventionResult.AWAITING_OBSERVATION,
      verification_status: 'PROVIDER_RECORDED',
      notes: dto.notes ? dto.notes.trim() : null,
      created_at: now,
    };

    issueRepository.createIntervention(intervention);

    // Canonical Migration: If intervention replaced physical parts, record each in canonical vehicle_components
    if (dto.replaced_part_names && dto.replaced_part_names.length > 0) {
      for (const partName of dto.replaced_part_names) {
        if (!partName || !partName.trim()) continue;
        const compId = `comp_${crypto.randomUUID().slice(0, 12)}`;
        componentRepository.createComponent({
          id: compId,
          vehicle_id: vehicleId,
          component_definition_id: null,
          part_id: null,
          custom_name: partName.trim(),
          category: (issue.primary_component_category as ComponentCategory) || ComponentCategory.OTHER,
          subcategory: null,
          classification: ComponentClassification.DURABLE_COMPONENT,
          brand: null,
          model: null,
          part_number: null,
          oem_number: null,
          serial_number: null,
          position: null,
          status: ComponentStatus.INSTALLED,
          installed_at: performedAt,
          installed_odometer_km: odoKm,
          installed_odometer_unit: (dto.odometer_unit as OdometerUnit) || OdometerUnit.KM,
          installation_source: PartProvenance.GARAGE_RECORDED,
          installation_provider_id: dto.provider_id || null,
          installation_provider_name: dto.provider_name ? dto.provider_name.trim() : null,
          installation_work_order_id: dto.work_order_id || null,
          verification_status: PartVerificationStatus.PROVIDER_RECORDED,
          removed_at: null,
          removed_odometer_km: null,
          removal_reason: null,
          maintenance_completion_id: null,
          issue_intervention_id: intvId,
          vehicle_expense_id: null,
          notes: `Installed via intervention for issue: ${issue.title}`,
          is_current: true,
          created_at: now,
          updated_at: now,
        });
      }
    }

    const newInterventionCount = issue.intervention_count + 1;

    // Recalculate persistence state
    const newPersistence = this.calculatePersistenceState(
      issue.occurrence_count,
      newInterventionCount,
      issue.persistence_state === IssuePersistenceState.RECURRENT_AFTER_RESOLUTION,
      issue.persistence_state === IssuePersistenceState.INTERMITTENT
    );

    // Transition to MONITORING state (repair does not equal resolved)
    issueRepository.updateIssue(issueId, {
      intervention_count: newInterventionCount,
      last_intervention_id: intvId,
      status: IssueStatus.MONITORING,
      persistence_state: newPersistence,
      last_observed_odometer_km: odoKm || issue.last_observed_odometer_km,
    });

    // Schedule automated follow-up check (e.g. 7 days or 500 km)
    const followupDays = dto.schedule_followup_days || 7;
    const dueDate = new Date(Date.now() + followupDays * 86400000).toISOString();
    const dueOdoKm = odoKm ? odoKm + (dto.schedule_followup_km || 500) : null;

    const followupId = `fol_${crypto.randomUUID().slice(0, 12)}`;
    const followup: IssueFollowup = {
      id: followupId,
      vehicle_issue_id: issueId,
      intervention_id: intvId,
      scheduled_at: now,
      due_date: dueDate,
      due_odometer_km: dueOdoKm,
      status: FollowupStatus.SCHEDULED,
      prompt_message: `Follow-up check for ${issue.title}: Has the symptom returned following ${dto.intervention_type.toLowerCase()}?`,
      response: null,
      response_notes: null,
      responded_at: null,
      responded_by: null,
      created_at: now,
      updated_at: now,
    };

    issueRepository.createFollowup(followup);

    // Enqueue outbox event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.issue.intervention_recorded',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_intervention: intvId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        intervention_id: intvId,
        intervention_type: intervention.intervention_type,
        description: intervention.description,
        performed_at: performedAt,
        provider_name: intervention.provider_name,
        replaced_parts: intervention.replaced_part_names,
        cost_total: intervention.cost_total,
        status: IssueStatus.MONITORING,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Intervention recorded for issue ${issueId}, issue transitioned to MONITORING`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Explicitly resolves an issue after confirmed symptom cessation (GAR-008 §25-§26)
   */
  public resolveIssue(
    vehicleId: string,
    issueId: string,
    dto: ResolveIssueDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.VEHICLE_OWNER
  ): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle issue ${issueId} not found`, 404);
    }

    if (issue.status === IssueStatus.RESOLVED) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `Issue ${issueId} is already resolved`, 400);
    }

    const now = getCurrentUtcIsoString();
    const resId = `res_${crypto.randomUUID().slice(0, 12)}`;

    const resolution: IssueResolution = {
      id: resId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      resolved_at: dto.resolved_at || now,
      resolved_odometer_km: dto.resolved_odometer_km ?? issue.last_observed_odometer_km,
      resolution_type: dto.resolution_type,
      resolution_summary: dto.resolution_summary.trim(),
      resolved_by: actorId,
      source_type:
        actorType === CanonicalActorType.GARAGE_STAFF ? 'PROVIDER_CONFIRMED' : 'OWNER_CONFIRMED',
      confirmation_state: 'CONFIRMED',
      notes: dto.notes ? dto.notes.trim() : null,
      created_at: now,
    };

    issueRepository.createResolution(resolution);

    issueRepository.updateIssue(issueId, {
      status: IssueStatus.RESOLVED,
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.issue.resolved',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_resolution: resId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        resolution_id: resId,
        resolution_type: resolution.resolution_type,
        resolution_summary: resolution.resolution_summary,
        resolved_at: resolution.resolved_at,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Issue ${issueId} resolved via ${resolution.resolution_type}`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Explicitly reopens a previously resolved issue upon symptom recurrence (GAR-008 §27)
   */
  public recurIssue(
    vehicleId: string,
    issueId: string,
    dto: RecurIssueDTO,
    actorId: string,
    actorType: CanonicalActorType = CanonicalActorType.VEHICLE_OWNER
  ): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Vehicle issue ${issueId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();
    const recurredAt = dto.recurred_at || now;

    let odoKm: number | null = null;
    if (dto.odometer_value !== undefined && dto.odometer_value !== null) {
      odoKm = normalizeDistanceToKm(dto.odometer_value, (dto.odometer_unit as 'KM' | 'MILES') || 'KM');
    }

    const occId = `occ_${crypto.randomUUID().slice(0, 12)}`;
    const occurrence: IssueOccurrence = {
      id: occId,
      vehicle_issue_id: issueId,
      vehicle_id: vehicleId,
      occurred_at: recurredAt,
      recorded_at: now,
      odometer_value: dto.odometer_value ?? null,
      odometer_unit: dto.odometer_unit || 'KM',
      odometer_km: odoKm,
      description: dto.description.trim(),
      symptom_category: SymptomCategory.OTHER,
      driving_condition: dto.driving_condition || null,
      speed_range: dto.speed_range || null,
      engine_temperature_state: null,
      weather_context: null,
      road_condition: null,
      source_type: DataProvenanceClass.OWNER_ASSERTED,
      actor_id: actorId,
      location_reference: null,
      evidence_count: 0,
      created_at: now,
    };

    issueRepository.createOccurrence(occurrence);

    const newOccurrenceCount = issue.occurrence_count + 1;

    // Transition to RECURRED and update persistence state
    issueRepository.updateIssue(issueId, {
      status: IssueStatus.RECURRED,
      persistence_state: IssuePersistenceState.RECURRENT_AFTER_RESOLUTION,
      occurrence_count: newOccurrenceCount,
      last_observed_at: recurredAt,
      last_observed_odometer_km: odoKm || issue.last_observed_odometer_km,
    });

    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.issue.recurred',
      correlation_id: `corr_${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actorId,
      actor_type: actorType,
      provenance_class: DataProvenanceClass.OWNER_ASSERTED,
      subject_ids: {
        vehicle: vehicleId,
        vehicle_issue: issueId,
        issue_occurrence: occId,
      },
      payload: {
        issue_id: issueId,
        vehicle_id: vehicleId,
        status: IssueStatus.RECURRED,
        persistence_state: IssuePersistenceState.RECURRENT_AFTER_RESOLUTION,
        recurred_at: recurredAt,
        occurrence_count: newOccurrenceCount,
      },
    });

    enqueueOutboxEvent(eventEnvelope);
    logger.info(`Issue ${issueId} recurred and transitioned to RECURRED`);

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Responds to an intervention follow-up check ("Still happening?", GAR-008 §51)
   */
  public respondToFollowup(
    vehicleId: string,
    issueId: string,
    followupId: string,
    dto: FollowupResponseDTO,
    actorId: string
  ): EnrichedVehicleIssue {
    const followup = issueRepository.getFollowupById(followupId);
    if (!followup || followup.vehicle_issue_id !== issueId) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `Follow-up ${followupId} not found`, 404);
    }

    const now = getCurrentUtcIsoString();

    issueRepository.updateFollowup(followupId, {
      status: FollowupStatus.RESPONDED,
      response: dto.response,
      response_notes: dto.notes ? dto.notes.trim() : null,
      responded_at: now,
      responded_by: actorId,
    });

    const issue = issueRepository.getIssueById(issueId);
    if (!issue) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Issue ${issueId} not found`, 404);
    }

    // Logic depending on user answer
    if (dto.response === FollowupResponse.YES) {
      // Problem still happening: mark as RECURRED / STILL ACTIVE
      this.recordOccurrence(
        vehicleId,
        issueId,
        {
          description: `Follow-up verification: Owner confirmed symptom is still active after intervention. ${dto.notes || ''}`.trim(),
        },
        actorId
      );
    } else if (dto.response === FollowupResponse.NO) {
      // Symptom stopped: proceed to resolve
      this.resolveIssue(
        vehicleId,
        issueId,
        {
          resolution_type: IssueResolutionType.SYMPTOM_NO_LONGER_PRESENT,
          resolution_summary: `Owner confirmed symptom resolved during post-intervention monitoring follow-up. ${dto.notes || ''}`.trim(),
        },
        actorId
      );
    }

    return this.getEnrichedIssue(issueId);
  }

  /**
   * Finds recurrence candidates for matching similar prior issues (GAR-008 §28, §56)
   */
  public findRecurrenceCandidates(
    vehicleId: string,
    category: IssueCategory,
    queryText?: string
  ): VehicleIssue[] {
    const allIssues = issueRepository.listIssuesForVehicle(vehicleId);
    const q = (queryText || '').toLowerCase();

    return allIssues.filter((issue) => {
      if (issue.category === category) return true;
      if (q && (issue.title.toLowerCase().includes(q) || issue.summary.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }

  /**
   * Returns structured persistent problem summary for a vehicle (GAR-008 §32, §85)
   */
  public getPersistentIssuesSummary(vehicleId: string): PersistentIssueSummary[] {
    const issues = issueRepository.listIssuesForVehicle(vehicleId);
    const persistentOrRecurrent = issues.filter(
      (i) =>
        i.persistence_state === IssuePersistenceState.PERSISTENT ||
        i.persistence_state === IssuePersistenceState.RECURRENT_AFTER_RESOLUTION ||
        i.occurrence_count >= 3 ||
        i.status === IssueStatus.RECURRED
    );

    return persistentOrRecurrent.map((issue) => {
      const diagnoses = issueRepository.listDiagnosesForIssue(issue.id);
      const interventions = issueRepository.listInterventionsForIssue(issue.id);
      const nextAction = this.deriveNextRecommendedAction(issue);

      let currentStateSummary = 'Persistent and currently unresolved';
      if (issue.status === IssueStatus.MONITORING) {
        currentStateSummary = 'Under observation following recent intervention';
      } else if (issue.status === IssueStatus.RECURRED) {
        currentStateSummary = 'Recurred after prior attempted resolution';
      } else if (issue.status === IssueStatus.RESOLVED) {
        currentStateSummary = 'Previously persistent, currently resolved';
      }

      return {
        issue_id: issue.id,
        vehicle_id: issue.vehicle_id,
        title: issue.title,
        category: issue.category,
        severity: issue.severity,
        status: issue.status,
        persistence_state: issue.persistence_state,
        first_observed_at: issue.first_observed_at,
        last_observed_at: issue.last_observed_at,
        occurrence_count: issue.occurrence_count,
        previous_diagnoses: diagnoses.map((d) => ({
          provider_name: d.provider_name,
          diagnosed_at: d.diagnosed_at,
          diagnosis_summary: d.diagnosis_summary,
          confirmed_component: d.confirmed_component,
        })),
        previous_interventions: interventions.map((intv) => ({
          intervention_type: intv.intervention_type,
          description: intv.description,
          performed_at: intv.performed_at,
          provider_name: intv.provider_name,
          result: intv.result,
          replaced_parts: intv.replaced_part_names,
        })),
        current_state_summary: currentStateSummary,
        next_recommended_action: nextAction,
      };
    });
  }

  /**
   * Retrieves enriched issue with all related child entities (GAR-008 §78)
   */
  public getEnrichedIssue(issueId: string): EnrichedVehicleIssue {
    const issue = issueRepository.getIssueById(issueId);
    if (!issue) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Issue with ID ${issueId} not found`, 404);
    }

    const occurrences = issueRepository.listOccurrencesForIssue(issueId);
    const observations = issueRepository.listObservationsForIssue(issueId);
    const suspectedCauses = issueRepository.listSuspectedCausesForIssue(issueId);
    const diagnoses = issueRepository.listDiagnosesForIssue(issueId);
    const interventions = issueRepository.listInterventionsForIssue(issueId);
    const resolution = issueRepository.getResolutionForIssue(issueId);
    const followups = issueRepository.listFollowupsForIssue(issueId);
    const evidence = issueRepository.listEvidenceForIssue(issueId);
    const nextRecommendedAction = this.deriveNextRecommendedAction(issue);

    const firstDate = new Date(issue.first_observed_at).getTime();
    const lastDate = new Date(issue.last_observed_at).getTime();
    const now = Date.now();

    const daysOpen = Math.max(0, Math.floor((now - firstDate) / (1000 * 60 * 60 * 24)));
    const daysSinceLastOccurrence = Math.max(0, Math.floor((now - lastDate) / (1000 * 60 * 60 * 24)));

    return {
      ...issue,
      occurrences,
      observations,
      suspected_causes: suspectedCauses,
      diagnoses,
      interventions,
      resolution,
      followups,
      evidence,
      next_recommended_action: nextRecommendedAction,
      days_open: daysOpen,
      days_since_last_occurrence: daysSinceLastOccurrence,
    };
  }

  /**
   * Compiles the complete chronological timeline for an issue (GAR-008 §33, §101)
   */
  public getIssueChronology(issueId: string): IssueChronologyItem[] {
    const issue = this.getEnrichedIssue(issueId);
    const items: IssueChronologyItem[] = [];

    // Initial report
    items.push({
      id: `chron_rep_${issue.id}`,
      timestamp: issue.first_observed_at,
      event_type: 'REPORTED',
      title: `Issue Reported: ${issue.title}`,
      description: issue.summary,
      actor_name: issue.created_by,
      actor_type: 'VEHICLE_OWNER',
      odometer_km: issue.first_observed_odometer_km,
    });

    // Occurrences
    for (const occ of issue.occurrences) {
      if (occ.occurred_at !== issue.first_observed_at) {
        items.push({
          id: `chron_occ_${occ.id}`,
          timestamp: occ.occurred_at,
          event_type: 'OCCURRENCE',
          title: `Symptom Recurred (${occ.symptom_category})`,
          description: occ.description,
          actor_name: occ.actor_id,
          actor_type: 'VEHICLE_OWNER',
          odometer_km: occ.odometer_km,
          metadata: {
            driving_condition: occ.driving_condition,
            speed_range: occ.speed_range,
          },
        });
      }
    }

    // Observations
    for (const obs of issue.observations) {
      items.push({
        id: `chron_obs_${obs.id}`,
        timestamp: obs.observed_at,
        event_type: 'OBSERVATION',
        title: `Observation Logged (${obs.observation_type})`,
        description: obs.description,
        actor_name: obs.provider_id || obs.actor_id || 'SYSTEM',
        actor_type: obs.source_type,
        odometer_km: null,
      });
    }

    // Diagnoses
    for (const diag of issue.diagnoses) {
      items.push({
        id: `chron_diag_${diag.id}`,
        timestamp: diag.diagnosed_at,
        event_type: 'DIAGNOSIS',
        title: `Professional Diagnostic Conclusion: ${diag.diagnosis_summary}`,
        description: `${diag.diagnosis_details}${diag.confirmed_component ? ` • Confirmed: ${diag.confirmed_component}` : ''}`,
        actor_name: diag.provider_name,
        actor_type: 'GARAGE_STAFF',
        odometer_km: null,
        verification_status: diag.verification_status,
      });
    }

    // Interventions
    for (const intv of issue.interventions) {
      items.push({
        id: `chron_intv_${intv.id}`,
        timestamp: intv.performed_at,
        event_type: 'INTERVENTION',
        title: `Intervention Performed: ${intv.intervention_type}`,
        description: `${intv.description} (Outcome: ${intv.result})${intv.replaced_part_names.length ? ` • Replaced: ${intv.replaced_part_names.join(', ')}` : ''}`,
        actor_name: intv.provider_name || 'Service Provider',
        actor_type: 'GARAGE_STAFF',
        odometer_km: intv.odometer_km,
        verification_status: intv.verification_status,
      });
    }

    // Followups
    for (const fol of issue.followups) {
      if (fol.responded_at) {
        items.push({
          id: `chron_fol_${fol.id}`,
          timestamp: fol.responded_at,
          event_type: 'FOLLOWUP',
          title: `Monitoring Follow-up Response: ${fol.response}`,
          description: fol.response_notes || `Owner indicated problem is ${fol.response === FollowupResponse.YES ? 'still happening' : 'resolved'}.`,
          actor_name: fol.responded_by || 'Vehicle Owner',
          actor_type: 'VEHICLE_OWNER',
          odometer_km: null,
        });
      }
    }

    // Resolution
    if (issue.resolution) {
      items.push({
        id: `chron_res_${issue.resolution.id}`,
        timestamp: issue.resolution.resolved_at,
        event_type: 'RESOLVED',
        title: `Issue Confirmed Resolved (${issue.resolution.resolution_type})`,
        description: issue.resolution.resolution_summary,
        actor_name: issue.resolution.resolved_by,
        actor_type: issue.resolution.source_type,
        odometer_km: issue.resolution.resolved_odometer_km,
      });
    }

    // Sort chronologically ascending
    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return items;
  }
}

export const issueService = new IssueService();
