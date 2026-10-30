/**
 * Canonical Vehicle Timeline Event Projector (GAR-005 §40-§45)
 *
 * Subscribes to canonical domain events and idempotently projects them
 * into persistent vehicle timeline entries and updates the materialized passport projection.
 */

import { eventBus } from '../events/eventBus';
import { timelineRepository } from './timelineRepository';
import { passportBuilder } from './passportBuilder';
import { logger } from '../observability/logger';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  VehicleTimelineEntryEntity,
  TimelineEntryType,
  TimelineCategory,
  TimelineSourceType,
  TimelineVerificationStatus,
  TimelineVisibility,
  TimelineSensitivity,
} from './types';
import { EventEnvelope } from '../../shared/types';
import { OdometerUnit } from '../vehicle/types';

export class TimelineProjector {
  private isInitialized = false;

  /**
   * Initializes event bus subscriptions for timeline projection.
   */
  initialize(): void {
    if (this.isInitialized) return;

    eventBus.subscribe('vehicle.created', this.handleVehicleCreated.bind(this));
    eventBus.subscribe('odometer.recorded', this.handleOdometerRecorded.bind(this));
    eventBus.subscribe('odometer.flagged', this.handleOdometerFlagged.bind(this));
    eventBus.subscribe('odometer.corrected', this.handleOdometerCorrected.bind(this));
    eventBus.subscribe('vehicle.document.added', this.handleDocumentAdded.bind(this));
    eventBus.subscribe('vehicle.relationship.added', this.handleRelationshipAdded.bind(this));
    eventBus.subscribe('vehicle.relationship.revoked', this.handleRelationshipRevoked.bind(this));
    eventBus.subscribe('vehicle.archived', this.handleVehicleArchived.bind(this));
    eventBus.subscribe('maintenance.completed', this.handleMaintenanceCompleted.bind(this));
    eventBus.subscribe('vehicle.issue.reported', this.handleIssueReported.bind(this));
    eventBus.subscribe('vehicle.issue.occurrence_recorded', this.handleIssueOccurrenceRecorded.bind(this));
    eventBus.subscribe('vehicle.issue.diagnosis_recorded', this.handleIssueDiagnosisRecorded.bind(this));
    eventBus.subscribe('vehicle.issue.intervention_recorded', this.handleIssueInterventionRecorded.bind(this));
    eventBus.subscribe('vehicle.issue.resolved', this.handleIssueResolved.bind(this));
    eventBus.subscribe('vehicle.issue.recurred', this.handleIssueRecurred.bind(this));
    eventBus.subscribe('vehicle.component.installed', this.handleComponentInstalled.bind(this));
    eventBus.subscribe('vehicle.component.replaced', this.handleComponentReplaced.bind(this));
    eventBus.subscribe('vehicle.component.removed', this.handleComponentRemoved.bind(this));
    eventBus.subscribe('vehicle.tyre.installed', this.handleTyreInstalled.bind(this));
    eventBus.subscribe('vehicle.tyre.rotated', this.handleTyreRotated.bind(this));
    eventBus.subscribe('vehicle.tyre.replaced', this.handleTyreReplaced.bind(this));
    eventBus.subscribe('vehicle.modification.recorded', this.handleModificationRecorded.bind(this));
    eventBus.subscribe('service_case.checked_in', this.handleServiceCaseCheckedIn.bind(this));
    eventBus.subscribe('service_case.inspection_completed', this.handleServiceCaseInspectionCompleted.bind(this));
    eventBus.subscribe('service_case.work_order_completed', this.handleServiceCaseWorkOrderCompleted.bind(this));
    eventBus.subscribe('service_case.vehicle_released', this.handleServiceCaseVehicleReleased.bind(this));
    eventBus.subscribe('roadside.incident.reported', this.handleRoadsideIncidentReported.bind(this));
    eventBus.subscribe('roadside.intervention.completed', this.handleRoadsideInterventionCompleted.bind(this));

    this.isInitialized = true;
    logger.info('TimelineProjector registered all canonical event listeners');
  }

  /**
   * Handler for vehicle.created
   */
  async handleVehicleCreated(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      display_name: string;
      make: string;
      model: string;
      model_year: number;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    // 1. Vehicle Created Entry
    const createdEntry: VehicleTimelineEntryEntity = {
      id: `vte_cre_${vehicleId}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.VEHICLE_CREATED,
      category: TimelineCategory.IDENTITY,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle profile registered',
      summary: `${payload.display_name || `${payload.model_year} ${payload.make} ${payload.model}`} registered on Garage OS`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'DOMAIN_EVENT',
      source_reference_id: event.event_id,
      source_event_id: `${event.event_id}:veh_created`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {
        make: payload.make,
        model: payload.model,
        model_year: payload.model_year,
      },
      created_at: now,
      updated_at: now,
    };
    timelineRepository.insertTimelineEntry(createdEntry);

    // 2. Ownership Started Entry
    const ownershipEntry: VehicleTimelineEntryEntity = {
      id: `vte_own_${vehicleId}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.OWNERSHIP_STARTED,
      category: TimelineCategory.OWNERSHIP,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Initial vehicle ownership established',
      summary: 'Vehicle registered under initial primary ownership',
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'DOMAIN_EVENT',
      source_reference_id: event.event_id,
      source_event_id: `${event.event_id}:own_started`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    };
    timelineRepository.insertTimelineEntry(ownershipEntry);

    // Rebuild passport projection
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to build initial passport for vehicle ${vehicleId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for odometer.recorded
   */
  async handleOdometerRecorded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      observation_id: string;
      reading_km: number;
      reading_value?: number;
      unit?: OdometerUnit;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const readingKm = payload.reading_km ?? payload.reading_value ?? 0;
    const unit = payload.unit || OdometerUnit.KM;

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_odo_${payload.observation_id || Date.now()}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ODOMETER_RECORDED,
      category: TimelineCategory.MILEAGE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Mileage observation recorded',
      summary: `Odometer reading confirmed at ${readingKm.toLocaleString()} km`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ODOMETER_OBSERVATION',
      source_reference_id: payload.observation_id,
      source_event_id: `${event.event_id}:odo_rec`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.VERIFIED,
      confidence: 1.0,
      odometer_value: readingKm,
      odometer_unit: unit,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {
        reading_km: readingKm,
        unit,
      },
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after odometer recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for odometer.flagged
   */
  async handleOdometerFlagged(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      observation_id: string;
      reading_km: number;
      unit?: OdometerUnit;
      flag_reason?: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const readingKm = payload.reading_km ?? 0;

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_odo_flg_${payload.observation_id || Date.now()}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ODOMETER_RECORDED,
      category: TimelineCategory.MILEAGE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Mileage observation flagged for review',
      summary: `Odometer reading of ${readingKm.toLocaleString()} km flagged: ${payload.flag_reason || 'Mileage regression detected'}`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ODOMETER_OBSERVATION',
      source_reference_id: payload.observation_id,
      source_event_id: `${event.event_id}:odo_flg`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.DISPUTED,
      confidence: 0.5,
      odometer_value: readingKm,
      odometer_unit: payload.unit || OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {
        reading_km: readingKm,
        flag_reason: payload.flag_reason,
      },
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after odometer flagged: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for odometer.corrected
   */
  async handleOdometerCorrected(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      superseded_id: string;
      new_reading_km: number;
      reason: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_odo_corr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ODOMETER_CORRECTED,
      category: TimelineCategory.MILEAGE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Mileage observation corrected',
      summary: `Odometer reading corrected to ${payload.new_reading_km.toLocaleString()} km. Reason: ${payload.reason}`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ODOMETER_OBSERVATION',
      source_reference_id: payload.superseded_id,
      source_event_id: `${event.event_id}:odo_corr`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.VERIFIED,
      confidence: 1.0,
      odometer_value: payload.new_reading_km,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {
        superseded_observation_id: payload.superseded_id,
        reason: payload.reason,
      },
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after odometer corrected: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.document.added
   */
  async handleDocumentAdded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      document_id: string;
      title?: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_doc_${payload.document_id || Date.now()}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.DOCUMENT_ADDED,
      category: TimelineCategory.DOCUMENT,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle document added',
      summary: `Document "${payload.title || 'Vehicle record'}" uploaded to vehicle passport`,
      source_type: TimelineSourceType.DOCUMENT_SUPPORTED,
      source_reference_type: 'VEHICLE_DOCUMENT',
      source_reference_id: payload.document_id,
      source_event_id: `${event.event_id}:doc_add`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.EVIDENCE_SUPPORTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after doc added: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.relationship.added
   */
  async handleRelationshipAdded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      relationship_type: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_rel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.OWNERSHIP_STARTED,
      category: TimelineCategory.OWNERSHIP,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle relationship established',
      summary: `New authorized relationship (${payload.relationship_type || 'AUTHORIZED_USER'}) added to vehicle`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_RELATIONSHIP',
      source_reference_id: null,
      source_event_id: `${event.event_id}:rel_add`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: { relationship_type: payload.relationship_type },
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after relationship added: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.relationship.revoked
   */
  async handleRelationshipRevoked(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      relationship_id: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_rel_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.OWNERSHIP_ENDED,
      category: TimelineCategory.OWNERSHIP,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle relationship terminated',
      summary: 'Authorized relationship revoked from vehicle',
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_RELATIONSHIP',
      source_reference_id: payload.relationship_id,
      source_event_id: `${event.event_id}:rel_rev`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after relationship revoked: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.archived
   */
  async handleVehicleArchived(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const vehicleId = event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_arc_${vehicleId}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.VEHICLE_ARCHIVED,
      category: TimelineCategory.IDENTITY,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle profile archived',
      summary: 'Vehicle profile transitioned to archived status',
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE',
      source_reference_id: vehicleId,
      source_event_id: `${event.event_id}:veh_arc`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.OWNER_ONLY,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after vehicle archived: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for maintenance.completed (GAR-005, GAR-006 §32)
   */
  async handleMaintenanceCompleted(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      completion_id: string;
      vehicle_id: string;
      requirement_name: string;
      completed_at: string;
      odometer_value: number;
      odometer_unit: string;
      service_provider_name?: string;
      cost_total?: number;
      currency?: string;
      replaced_parts?: Array<{ name: string; quantity: number }>;
      verification_status?: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const partsSummary = payload.replaced_parts && payload.replaced_parts.length > 0
      ? `Parts: ${payload.replaced_parts.map((p) => `${p.name} (x${p.quantity})`).join(', ')}`
      : '';

    const summaryText = [
      `Completed at ${Number(payload.odometer_value || 0).toLocaleString()} ${payload.odometer_unit || 'KM'} by ${payload.service_provider_name || 'Owner'}`,
      partsSummary,
      payload.cost_total ? `Total: ${payload.currency || 'KES'} ${Number(payload.cost_total).toLocaleString()}` : '',
    ]
      .filter(Boolean)
      .join(' • ');

    let verStatus = TimelineVerificationStatus.OWNER_ASSERTED;
    if (payload.verification_status === 'PROVIDER_CONFIRMED') {
      verStatus = TimelineVerificationStatus.PROVIDER_RECORDED;
    } else if (payload.verification_status === 'DOCUMENT_VERIFIED') {
      verStatus = TimelineVerificationStatus.EVIDENCE_SUPPORTED;
    }

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_mnt_${payload.completion_id || Date.now()}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.MAINTENANCE_COMPLETED,
      category: TimelineCategory.MAINTENANCE,
      occurred_at: payload.completed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `${payload.requirement_name || 'Maintenance'} completed`,
      summary: summaryText,
      source_type: payload.service_provider_name && payload.service_provider_name !== 'Owner / Self'
        ? TimelineSourceType.PROVIDER_RECORDED
        : TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'MAINTENANCE_COMPLETION',
      source_reference_id: payload.completion_id,
      source_event_id: `${event.event_id}:maint_comp`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: verStatus,
      confidence: 1.0,
      odometer_value: payload.odometer_value !== undefined ? Number(payload.odometer_value) : null,
      odometer_unit: (payload.odometer_unit as any) || null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);

    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport for vehicle ${vehicleId} after maintenance completion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.reported (GAR-008 §47)
   */
  async handleIssueReported(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      title: string;
      category: string;
      severity: string;
      symptom_category: string;
      occurred_at: string;
      odometer_km?: number | null;
      is_safety_critical?: boolean;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_rep_${payload.issue_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ISSUE_REPORTED,
      category: TimelineCategory.ISSUE,
      occurred_at: payload.occurred_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Issue logged: ${payload.title}`,
      summary: `Vehicle issue reported (${payload.category} • Severity: ${payload.severity})`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_ISSUE',
      source_reference_id: payload.issue_id,
      source_event_id: `${event.event_id}:issue_rep`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 0.9,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.AUTHORIZED_VEHICLE_USERS,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after issue reported: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.occurrence_recorded (GAR-008 §50)
   */
  async handleIssueOccurrenceRecorded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      occurrence_count: number;
      persistence_state: string;
      occurred_at: string;
      odometer_km?: number | null;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_occ_${payload.issue_id}_${payload.occurrence_count}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ISSUE_REPORTED,
      category: TimelineCategory.ISSUE,
      occurred_at: payload.occurred_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Repeat symptom occurrence logged`,
      summary: `Occurrence #${payload.occurrence_count} recorded. Persistence state: ${payload.persistence_state}`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ISSUE_OCCURRENCE',
      source_reference_id: payload.issue_id,
      source_event_id: `${event.event_id}:issue_occ`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 0.9,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.AUTHORIZED_VEHICLE_USERS,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after occurrence recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.diagnosis_recorded (GAR-008 §17-§19)
   */
  async handleIssueDiagnosisRecorded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      diagnosis_id: string;
      provider_name: string;
      diagnosis_summary: string;
      confirmed_component?: string | null;
      outcome: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_diag_${payload.diagnosis_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.DIAGNOSTIC_COMPLETED,
      category: TimelineCategory.DIAGNOSTIC,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Diagnostic findings recorded by ${payload.provider_name}`,
      summary: `${payload.diagnosis_summary}${payload.confirmed_component ? ` • Confirmed: ${payload.confirmed_component}` : ''} (${payload.outcome})`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'ISSUE_DIAGNOSIS',
      source_reference_id: payload.diagnosis_id,
      source_event_id: `${event.event_id}:issue_diag`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after diagnosis recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.intervention_recorded (GAR-008 §20-§24)
   */
  async handleIssueInterventionRecorded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      intervention_id: string;
      intervention_type: string;
      description: string;
      performed_at: string;
      provider_name?: string | null;
      replaced_parts?: string[];
      cost_total?: number;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const partsText = payload.replaced_parts && payload.replaced_parts.length > 0
      ? `Replaced: ${payload.replaced_parts.join(', ')}`
      : '';

    const summaryParts = [
      payload.description,
      payload.provider_name ? `Performed by ${payload.provider_name}` : '',
      partsText,
    ].filter(Boolean);

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_intv_${payload.intervention_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.REPAIR_COMPLETED,
      category: TimelineCategory.REPAIR,
      occurred_at: payload.performed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Corrective intervention: ${payload.intervention_type}`,
      summary: summaryParts.join(' • '),
      source_type: payload.provider_name ? TimelineSourceType.PROVIDER_RECORDED : TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ISSUE_INTERVENTION',
      source_reference_id: payload.intervention_id,
      source_event_id: `${event.event_id}:issue_intv`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: payload.provider_name ? TimelineVerificationStatus.PROVIDER_RECORDED : TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after intervention recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.resolved (GAR-008 §25-§26)
   */
  async handleIssueResolved(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      resolution_id: string;
      resolution_type: string;
      resolution_summary: string;
      resolved_at: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_res_${payload.resolution_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ISSUE_RESOLVED,
      category: TimelineCategory.ISSUE,
      occurred_at: payload.resolved_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Issue confirmed resolved',
      summary: `${payload.resolution_summary} (${payload.resolution_type})`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'ISSUE_RESOLUTION',
      source_reference_id: payload.resolution_id,
      source_event_id: `${event.event_id}:issue_res`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after issue resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.issue.recurred (GAR-008 §27)
   */
  async handleIssueRecurred(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      issue_id: string;
      vehicle_id: string;
      recurred_at: string;
      occurrence_count: number;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_iss_rec_${payload.issue_id}_${payload.occurrence_count}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ISSUE_RECURRED,
      category: TimelineCategory.ISSUE,
      occurred_at: payload.recurred_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Issue symptom recurred',
      summary: `Previously resolved issue has recurred (occurrence #${payload.occurrence_count}). Transitioned to RECURRED.`,
      source_type: TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_ISSUE',
      source_reference_id: payload.issue_id,
      source_event_id: `${event.event_id}:issue_rec`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 0.9,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.AUTHORIZED_VEHICLE_USERS,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after issue recurred: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.component.installed (GAR-010 §9)
   */
  async handleComponentInstalled(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      component_id: string;
      custom_name: string;
      category: string;
      brand?: string | null;
      part_number?: string | null;
      position?: string | null;
      installed_at: string;
      installed_odometer_km?: number | null;
      provider_name?: string | null;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_comp_inst_${payload.component_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.PART_INSTALLED,
      category: TimelineCategory.PARTS,
      occurred_at: payload.installed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Installed component: ${payload.custom_name}`,
      summary: `${payload.custom_name} (${payload.category}) installed${payload.provider_name ? ` by ${payload.provider_name}` : ''}${payload.position ? ` at position ${payload.position}` : ''}`,
      source_type: payload.provider_name ? TimelineSourceType.PROVIDER_RECORDED : TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_COMPONENT',
      source_reference_id: payload.component_id,
      source_event_id: `${event.event_id}:comp_inst`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: payload.provider_name ? TimelineVerificationStatus.PROVIDER_RECORDED : TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: payload.installed_odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after component installed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.component.replaced (GAR-010 §13)
   */
  async handleComponentReplaced(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      replacement_id: string;
      old_component_id: string;
      old_component_name: string;
      new_component_id: string;
      new_component_name: string;
      replaced_at: string;
      odometer_km?: number | null;
      reason: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_comp_rep_${payload.replacement_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.PART_INSTALLED,
      category: TimelineCategory.PARTS,
      occurred_at: payload.replaced_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Replaced component: ${payload.old_component_name} → ${payload.new_component_name}`,
      summary: `Replaced ${payload.old_component_name} with ${payload.new_component_name}. Reason: ${payload.reason}`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_COMPONENT_REPLACEMENT',
      source_reference_id: payload.replacement_id,
      source_event_id: `${event.event_id}:comp_rep`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after component replaced: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.component.removed (GAR-010 §12)
   */
  async handleComponentRemoved(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      component_id: string;
      component_name: string;
      removed_at: string;
      odometer_km?: number | null;
      reason: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_comp_rem_${payload.component_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.PART_REMOVED,
      category: TimelineCategory.PARTS,
      occurred_at: payload.removed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Removed component: ${payload.component_name}`,
      summary: `Component ${payload.component_name} removed from vehicle. Reason: ${payload.reason}`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_COMPONENT',
      source_reference_id: payload.component_id,
      source_event_id: `${event.event_id}:comp_rem`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after component removed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.tyre.installed (GAR-010 §30)
   */
  async handleTyreInstalled(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      tyre_id: string;
      brand: string;
      model: string;
      size: string;
      position: string;
      installed_at: string;
      odometer_km?: number | null;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_tyre_inst_${payload.tyre_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.TYRE_INSTALLED,
      category: TimelineCategory.TYRES,
      occurred_at: payload.installed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Installed tyre: ${payload.brand} ${payload.model} (${payload.position})`,
      summary: `${payload.brand} ${payload.model} ${payload.size} mounted at ${payload.position}`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_TYRE',
      source_reference_id: payload.tyre_id,
      source_event_id: `${event.event_id}:tyre_inst`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after tyre installed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.tyre.rotated (GAR-010 §34)
   */
  async handleTyreRotated(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      rotation_id: string;
      pattern: string;
      performed_at: string;
      odometer_km?: number | null;
      moves_count: number;
      provider_name?: string | null;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_tyre_rot_${payload.rotation_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.TYRE_ROTATED,
      category: TimelineCategory.TYRES,
      occurred_at: payload.performed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Tyre rotation completed (${payload.pattern})`,
      summary: `Completed ${payload.moves_count}-tyre rotation (${payload.pattern})${payload.provider_name ? ` by ${payload.provider_name}` : ''}`,
      source_type: payload.provider_name ? TimelineSourceType.PROVIDER_RECORDED : TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'TYRE_ROTATION',
      source_reference_id: payload.rotation_id,
      source_event_id: `${event.event_id}:tyre_rot`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: payload.provider_name ? TimelineVerificationStatus.PROVIDER_RECORDED : TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after tyre rotated: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.tyre.replaced (GAR-010 §31)
   */
  async handleTyreReplaced(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      old_tyre_id: string;
      new_tyre_id: string;
      position: string;
      replaced_at: string;
      odometer_km?: number | null;
      reason: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_tyre_rep_${payload.new_tyre_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.TYRE_REPLACED,
      category: TimelineCategory.TYRES,
      occurred_at: payload.replaced_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Tyre replaced at ${payload.position}`,
      summary: `Tyre replaced at wheel position ${payload.position}. Reason: ${payload.reason}`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_TYRE',
      source_reference_id: payload.new_tyre_id,
      source_event_id: `${event.event_id}:tyre_rep`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after tyre replaced: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for vehicle.modification.recorded (GAR-010 §54)
   */
  async handleModificationRecorded(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      vehicle_id: string;
      modification_id: string;
      name: string;
      category: string;
      installed_at: string;
      odometer_km?: number | null;
      provider_name?: string | null;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_mod_${payload.modification_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.MODIFICATION_INSTALLED,
      category: TimelineCategory.MODIFICATION,
      occurred_at: payload.installed_at || event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Modification: ${payload.name}`,
      summary: `Installed ${payload.name} (${payload.category})${payload.provider_name ? ` by ${payload.provider_name}` : ''}`,
      source_type: payload.provider_name ? TimelineSourceType.PROVIDER_RECORDED : TimelineSourceType.OWNER_ENTERED,
      source_reference_type: 'VEHICLE_MODIFICATION',
      source_reference_id: payload.modification_id,
      source_event_id: `${event.event_id}:mod_rec`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: payload.provider_name ? TimelineVerificationStatus.PROVIDER_RECORDED : TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 1.0,
      odometer_value: payload.odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after modification recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for service_case.checked_in
   */
  async handleServiceCaseCheckedIn(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const vehicleId = event.subject_ids.vehicle;
    if (!vehicleId) return;

    const payload = event.payload as {
      check_in: { id: string; odometer_value: number; odometer_unit: string; vehicle_condition_summary?: string };
      observations_count: number;
    };

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_sci_${payload.check_in.id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.SERVICE_COMPLETED,
      category: TimelineCategory.SERVICE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle Workshop Check-In',
      summary: `Vehicle checked into workshop for service. Intake odometer: ${payload.check_in.odometer_value} ${payload.check_in.odometer_unit}.${payload.observations_count ? ` ${payload.observations_count} intake observations noted.` : ''}`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'SERVICE_CASE_CHECKIN',
      source_reference_id: payload.check_in.id,
      source_event_id: `${event.event_id}:sci`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: event.subject_ids.provider || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.check_in.odometer_value,
      odometer_unit: (payload.check_in.odometer_unit as OdometerUnit) || OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
  }

  /**
   * Handler for service_case.inspection_completed
   */
  async handleServiceCaseInspectionCompleted(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const vehicleId = event.subject_ids.vehicle;
    if (!vehicleId) return;

    const payload = event.payload as {
      inspection_id: string;
      findings_count: number;
    };

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_insp_${payload.inspection_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.INSPECTION_COMPLETED,
      category: TimelineCategory.SERVICE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Workshop Inspection Completed',
      summary: `Vehicle workshop inspection completed with ${payload.findings_count} diagnostic findings documented.`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_INSPECTION',
      source_reference_id: payload.inspection_id,
      source_event_id: `${event.event_id}:insp`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: event.subject_ids.provider || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
  }

  /**
   * Handler for service_case.work_order_completed
   */
  async handleServiceCaseWorkOrderCompleted(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const vehicleId = event.subject_ids.vehicle;
    if (!vehicleId) return;

    const payload = event.payload as {
      work_order_id: string;
      final_odometer_km?: number | null;
    };

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_woc_${payload.work_order_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.SERVICE_COMPLETED,
      category: TimelineCategory.SERVICE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Workshop Service & Repairs Completed',
      summary: `Automotive workshop service operations and authorized repairs successfully completed and verified through Quality Control.`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'WORK_ORDER',
      source_reference_id: payload.work_order_id,
      source_event_id: `${event.event_id}:woc`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: event.subject_ids.provider || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.final_odometer_km ?? null,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after work order completed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for service_case.vehicle_released
   */
  async handleServiceCaseVehicleReleased(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const vehicleId = event.subject_ids.vehicle;
    if (!vehicleId) return;

    const payload = event.payload as {
      release: { id: string; recipient_name: string; final_odometer_km: number };
    };

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_rel_${payload.release.id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.SERVICE_COMPLETED,
      category: TimelineCategory.SERVICE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: 'Vehicle Released to Customer',
      summary: `Vehicle handed over and released to ${payload.release.recipient_name}. Final odometer: ${payload.release.final_odometer_km} km.`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'VEHICLE_RELEASE',
      source_reference_id: payload.release.id,
      source_event_id: `${event.event_id}:rel`,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: event.subject_ids.provider || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.release.final_odometer_km,
      odometer_unit: OdometerUnit.KM,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after vehicle released: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for roadside.incident.reported
   */
  async handleRoadsideIncidentReported(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      incident_id: string;
      incident_number: string;
      vehicle_id: string;
      incident_type: string;
      severity: string;
      reported_by_name: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const entry: VehicleTimelineEntryEntity = {
      id: `vte_rsa_${payload.incident_id || event.event_id}`,
      vehicle_id: vehicleId,
      entry_type: TimelineEntryType.ROADSIDE_INCIDENT,
      category: TimelineCategory.ROADSIDE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: `Roadside breakdown reported (${payload.incident_number || 'Incident'})`,
      summary: `Breakdown reported: ${payload.incident_type || 'Unknown'} (Severity: ${payload.severity || 'ROUTINE'})`,
      source_type: TimelineSourceType.PLATFORM_OPERATOR,
      source_reference_type: 'ROADSIDE_INCIDENT',
      source_reference_id: payload.incident_id,
      source_event_id: event.event_id,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: 0.95,
      odometer_value: null,
      odometer_unit: null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after roadside incident: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handler for roadside.intervention.completed
   */
  async handleRoadsideInterventionCompleted(event: EventEnvelope<Record<string, unknown>>): Promise<void> {
    const payload = event.payload as {
      incident_id: string;
      vehicle_id: string;
      intervention_id: string;
      result: string;
      final_drivability: string;
      odometer_reading_km?: number;
      tow_required: boolean;
      tow_destination?: string;
      summary_notes: string;
    };

    const vehicleId = payload.vehicle_id || event.subject_ids.vehicle;
    if (!vehicleId) return;

    const now = getCurrentUtcIsoString();
    const isTow = payload.tow_required;

    const entry: VehicleTimelineEntryEntity = {
      id: `vte_rsi_${payload.intervention_id || event.event_id}`,
      vehicle_id: vehicleId,
      entry_type: isTow ? TimelineEntryType.TOW_COMPLETED : TimelineEntryType.REPAIR_COMPLETED,
      category: TimelineCategory.ROADSIDE,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at || now,
      title: isTow ? 'Roadside Tow Recovery Handoff' : 'Roadside Assistance Mobile Repair Completed',
      summary: payload.summary_notes || (isTow ? `Vehicle recovered by tow truck to ${payload.tow_destination || 'repair facility'}` : 'Roadside mobile intervention resolved incident'),
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'ROADSIDE_INTERVENTION',
      source_reference_id: payload.intervention_id,
      source_event_id: event.event_id,
      actor_type: event.actor_type || null,
      actor_id: event.actor_id || null,
      organization_id: event.subject_ids.provider || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: payload.odometer_reading_km || null,
      odometer_unit: payload.odometer_reading_km ? OdometerUnit.KM : null,
      location_reference: null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: payload,
      created_at: now,
      updated_at: now,
    };

    timelineRepository.insertTimelineEntry(entry);
    try {
      passportBuilder.buildPassport(vehicleId);
    } catch (err) {
      logger.warn(`Failed to update passport after roadside intervention: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const timelineProjector = new TimelineProjector();
