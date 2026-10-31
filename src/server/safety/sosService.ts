import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { recordAuditEvent } from '../security/audit';
import { jobEngine } from '../jobs/jobEngine';
import { getDatabase } from '../database/connection';
import { vehicleService } from '../vehicle/vehicleService';
import { safetyRepository } from './safetyRepository';
import { sosRepository } from './sosRepository';
import { getSafetyNotificationAdapter } from './safetyNotificationAdapter';
import {
  EmergencyContact,
  HumanSafetyPreferences,
  InitiateSosInput,
  SafetyIncidentLevel,
  SosIncident,
  SosIncidentAggregate,
  SosIncidentStatus,
  SosLocationSnapshot,
  SosNotificationAttempt,
  SosNotificationStatus,
  SosSafetyCheck,
  SosSafetyCheckResponse,
  SosSafetyCheckStatus,
} from './types';

export const SOS_FINALIZE_ACTIVATION_JOB = 'safety.sos.finalize_activation';
export const SOS_NOTIFICATION_ATTEMPT_JOB = 'safety.sos.notification_attempt';
export const SOS_SAFETY_CHECK_TIMEOUT_JOB = 'safety.sos.safety_check_timeout';
export const SOS_LOCATION_RETENTION_JOB = 'safety.sos.location_retention';

const SOS_LOCATION_RETENTION_HOURS = 24;

function actorType(actor: AuthenticatedActorContext): CanonicalActorType {
  return actor.type || CanonicalActorType.VEHICLE_OWNER;
}

function normalizeIncidentType(value?: string): string {
  const normalized = (value || 'UNSPECIFIED_EMERGENCY').trim().toUpperCase().replace(/[^A-Z0-9_ -]/g, '');
  return normalized.slice(0, 80) || 'UNSPECIFIED_EMERGENCY';
}

function normalizeActivationSource(value?: string): string {
  const allowed = new Set(['USER_SOS_BUTTON', 'ROAD_SIDE_ESCALATION', 'MANUAL_SAFETY_ACTION']);
  return value && allowed.has(value) ? value : 'USER_SOS_BUTTON';
}

function sanitizeNotes(value?: string | null, max = 500): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function mapContactChannel(contact: EmergencyContact): 'SMS' | 'EMAIL' | null {
  if (contact.phone_e164) return 'SMS';
  if (contact.email) return 'EMAIL';
  return null;
}

export class SosService {
  initiate(actor: AuthenticatedActorContext, input: InitiateSosInput): SosIncidentAggregate {
    const existing = sosRepository.getActiveIncident(actor.user_id);
    if (existing) {
      return this.getAggregateForOwner(actor, existing.id);
    }

    if (input.vehicle_id) {
      // Server-side vehicle resource authorization. A failed vehicle lookup must not
      // leak another user's vehicle and must not create a partially linked SOS.
      vehicleService.getVehicleDetails(actor, input.vehicle_id);
    }

    const preferences = this.getPreferences(actor.user_id);
    const now = getCurrentUtcIsoString();
    const countdownSeconds = preferences?.sos_cancel_countdown_seconds ?? 5;
    const cancelDeadline = new Date(Date.now() + countdownSeconds * 1000).toISOString();
    const incidentId = generateCanonicalId('sos');
    const source = normalizeActivationSource(input.activation_source);

    const incident: SosIncident = {
      id: incidentId,
      user_id: actor.user_id,
      vehicle_id: input.vehicle_id || null,
      incident_level:
        input.incident_level && Object.values(SafetyIncidentLevel).includes(input.incident_level)
          ? input.incident_level
          : SafetyIncidentLevel.SERIOUS_EMERGENCY,
      incident_type: normalizeIncidentType(input.incident_type),
      status: SosIncidentStatus.COUNTDOWN,
      activation_source: source,
      activation_attempted_at: now,
      server_acknowledged_at: now,
      cancel_deadline_at: cancelDeadline,
      activated_at: null,
      cancelled_at: null,
      closed_at: null,
      cancellation_reason: null,
      closure_reason: null,
      notification_state: 'NOT_STARTED',
      safety_check_state: 'NOT_STARTED',
      assistance_state: 'NOT_REQUESTED',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    withTransaction(({ db }) => {
      sosRepository.createIncident(incident);
      sosRepository.createActivationAttempt({
        id: generateCanonicalId('soa'),
        incident_id: incidentId,
        user_id: actor.user_id,
        client_requested_at: input.client_requested_at || null,
        server_received_at: now,
        server_acknowledged_at: now,
        activation_source: source,
        status: 'ACKNOWLEDGED',
        created_at: now,
      });

      const location = this.buildLocationSnapshot(actor.user_id, incidentId, input, preferences, now);
      if (location) {
        sosRepository.insertLocation(location);
        jobEngine.enqueue(
          SOS_LOCATION_RETENTION_JOB,
          { incident_id: incidentId },
          { runAt: location.expires_at, correlationId: incidentId, maxRetries: 3 }
        );
      }

      sosRepository.recordStatusHistory({
        id: generateCanonicalId('ssh'),
        incident_id: incidentId,
        to_status: SosIncidentStatus.COUNTDOWN,
        actor_id: actor.user_id,
        actor_type: actorType(actor),
        reason: 'SOS activation attempt acknowledged; cancel countdown started.',
        metadata: {
          cancel_deadline_at: cancelDeadline,
          location_retained: Boolean(location),
        },
        occurred_at: now,
      });

      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.activation_attempt.acknowledged',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { user: actor.user_id, sos_incident: incidentId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: {
            incident_id: incidentId,
            status: SosIncidentStatus.COUNTDOWN,
            server_acknowledged_at: now,
            cancel_deadline_at: cancelDeadline,
            location_retained: Boolean(location),
          },
        }),
        db
      );

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'SOS_ACTIVATION_ATTEMPT_ACKNOWLEDGED',
          resource_type: 'sos_incident',
          resource_id: incidentId,
          correlation_id: incidentId,
          source: 'SAFETY_API',
          metadata: {
            incident_level: incident.incident_level,
            activation_source: source,
            countdown_seconds: countdownSeconds,
            location_retained: Boolean(location),
          },
        },
        db
      );

      jobEngine.enqueue(
        SOS_FINALIZE_ACTIVATION_JOB,
        { incident_id: incidentId },
        { runAt: cancelDeadline, correlationId: incidentId, maxRetries: 5 }
      );
    });

    return this.getAggregateForOwner(actor, incidentId);
  }

  cancel(actor: AuthenticatedActorContext, incidentId: string, reason?: string): SosIncidentAggregate {
    const incident = this.requireOwnerIncident(actor, incidentId);
    if (incident.status === SosIncidentStatus.CANCELLED) {
      return this.getAggregateForOwner(actor, incidentId);
    }
    if (incident.status !== SosIncidentStatus.COUNTDOWN) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        'SOS can only be cancelled during the configured countdown. Close an activated incident instead.',
        409
      );
    }

    const now = getCurrentUtcIsoString();
    const changed = withTransaction(({ db }) => {
      const transitioned = sosRepository.transitionIncident({
        incident_id: incidentId,
        expected_status: SosIncidentStatus.COUNTDOWN,
        next_status: SosIncidentStatus.CANCELLED,
        now,
        cancelled_at: now,
        cancellation_reason: sanitizeNotes(reason) || 'USER_CANCELLED_DURING_COUNTDOWN',
      });
      if (!transitioned) return false;

      sosRepository.updateActivationAttemptStatus(incidentId, 'CANCELLED');
      sosRepository.revokeIncidentLocation(incidentId, now);
      sosRepository.recordStatusHistory({
        id: generateCanonicalId('ssh'),
        incident_id: incidentId,
        from_status: SosIncidentStatus.COUNTDOWN,
        to_status: SosIncidentStatus.CANCELLED,
        actor_id: actor.user_id,
        actor_type: actorType(actor),
        reason: sanitizeNotes(reason) || 'USER_CANCELLED_DURING_COUNTDOWN',
        occurred_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.cancelled',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { user: actor.user_id, sos_incident: incidentId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: { incident_id: incidentId, cancelled_at: now },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'SOS_CANCELLED_DURING_COUNTDOWN',
          resource_type: 'sos_incident',
          resource_id: incidentId,
          correlation_id: incidentId,
          source: 'SAFETY_API',
        },
        db
      );
      return true;
    });

    if (!changed) {
      return this.getAggregateForOwner(actor, incidentId);
    }
    return this.getAggregateForOwner(actor, incidentId);
  }

  finalizeActivation(incidentId: string, asOf = getCurrentUtcIsoString()): SosIncident | null {
    const incident = sosRepository.getIncidentById(incidentId);
    if (!incident) return null;
    if (incident.status !== SosIncidentStatus.COUNTDOWN) return incident;
    if (new Date(asOf).getTime() < new Date(incident.cancel_deadline_at).getTime()) {
      jobEngine.enqueue(
        SOS_FINALIZE_ACTIVATION_JOB,
        { incident_id: incidentId },
        { runAt: incident.cancel_deadline_at, correlationId: incidentId, maxRetries: 5 }
      );
      return incident;
    }

    const preferences = this.getPreferences(incident.user_id);
    const now = asOf;
    let activated = false;

    withTransaction(({ db }) => {
      activated = sosRepository.transitionIncident({
        incident_id: incidentId,
        expected_status: SosIncidentStatus.COUNTDOWN,
        next_status: SosIncidentStatus.ACTIVATED,
        now,
        activated_at: now,
        notification_state: 'PREPARING',
        safety_check_state: preferences?.safety_check_enabled ? 'PENDING' : 'DISABLED',
      });
      if (!activated) return;

      sosRepository.updateActivationAttemptStatus(incidentId, 'ACTIVATED');
      const queuedAttempts = this.createContactNotificationAttempts(incident, preferences, now);

      let safetyCheck: SosSafetyCheck | null = null;
      if (preferences?.safety_check_enabled) {
        const dueAt = new Date(
          new Date(now).getTime() + preferences.safety_check_timeout_seconds * 1000
        ).toISOString();
        safetyCheck = {
          id: generateCanonicalId('ssc'),
          incident_id: incidentId,
          user_id: incident.user_id,
          status: SosSafetyCheckStatus.PENDING,
          prompted_at: now,
          due_at: dueAt,
          responded_at: null,
          response: null,
          response_notes: null,
          timed_out_at: null,
          created_at: now,
          updated_at: now,
        };
        sosRepository.createSafetyCheck(safetyCheck);
        jobEngine.enqueue(
          SOS_SAFETY_CHECK_TIMEOUT_JOB,
          { check_id: safetyCheck.id, incident_id: incidentId },
          { runAt: dueAt, correlationId: incidentId, maxRetries: 3 }
        );
      }

      sosRepository.updateIncidentStates(incidentId, {
        notification_state: queuedAttempts > 0 ? 'QUEUED' : 'NO_ELIGIBLE_CONTACTS',
        safety_check_state: safetyCheck ? 'PENDING' : 'DISABLED',
        now,
      });
      sosRepository.recordStatusHistory({
        id: generateCanonicalId('ssh'),
        incident_id: incidentId,
        from_status: SosIncidentStatus.COUNTDOWN,
        to_status: SosIncidentStatus.ACTIVATED,
        actor_type: CanonicalActorType.SYSTEM_WORKER,
        reason: 'Server countdown completed without cancellation.',
        metadata: {
          contact_notification_attempts_queued: queuedAttempts,
          safety_check_created: Boolean(safetyCheck),
          assistance_state: 'NOT_REQUESTED',
        },
        occurred_at: now,
      });

      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.activated',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { user: incident.user_id, sos_incident: incidentId },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            incident_id: incidentId,
            activated_at: now,
            notification_attempts_queued: queuedAttempts,
            safety_check_state: safetyCheck ? 'PENDING' : 'DISABLED',
            assistance_state: 'NOT_REQUESTED',
          },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          action: 'SOS_ACTIVATED_AFTER_COUNTDOWN',
          resource_type: 'sos_incident',
          resource_id: incidentId,
          correlation_id: incidentId,
          source: 'SAFETY_WORKER',
          metadata: {
            notification_attempts_queued: queuedAttempts,
            assistance_requested: false,
          },
        },
        db
      );
    });

    return sosRepository.getIncidentById(incidentId);
  }

  async processNotificationAttempt(attemptId: string): Promise<SosNotificationAttempt | null> {
    const attempt = sosRepository.getNotificationAttempt(attemptId);
    if (
      !attempt ||
      ![SosNotificationStatus.QUEUED, SosNotificationStatus.ATTEMPTED].includes(attempt.status)
    ) return attempt;

    const incident = sosRepository.getIncidentById(attempt.incident_id);
    if (!incident || incident.status !== SosIncidentStatus.ACTIVATED) {
      const now = getCurrentUtcIsoString();
      sosRepository.updateNotificationAttempt(attemptId, {
        status: SosNotificationStatus.SKIPPED,
        failed_at: now,
        failure_code: 'INCIDENT_NOT_ACTIVE',
        failure_message: 'SOS incident is no longer active.',
        updated_at: now,
      });
      this.refreshNotificationState(attempt.incident_id, now);
      return sosRepository.getNotificationAttempt(attemptId);
    }

    const contact = safetyRepository.getContact(incident.user_id, attempt.contact_id);
    if (!contact || contact.status !== 'ACTIVE') {
      const now = getCurrentUtcIsoString();
      sosRepository.updateNotificationAttempt(attemptId, {
        status: SosNotificationStatus.SKIPPED,
        failed_at: now,
        failure_code: 'CONTACT_NOT_ACTIVE',
        failure_message: 'Emergency Circle contact is not active.',
        updated_at: now,
      });
      this.refreshNotificationState(attempt.incident_id, now);
      return sosRepository.getNotificationAttempt(attemptId);
    }

    const destination = attempt.channel === 'SMS' ? contact.phone_e164 : contact.email;
    if (!destination) {
      const now = getCurrentUtcIsoString();
      sosRepository.updateNotificationAttempt(attemptId, {
        status: SosNotificationStatus.SKIPPED,
        failed_at: now,
        failure_code: 'CHANNEL_UNAVAILABLE',
        failure_message: 'The selected contact channel is no longer available.',
        updated_at: now,
      });
      this.refreshNotificationState(attempt.incident_id, now);
      return sosRepository.getNotificationAttempt(attemptId);
    }

    const attemptedAt = getCurrentUtcIsoString();
    sosRepository.updateNotificationAttempt(attemptId, {
      status: SosNotificationStatus.ATTEMPTED,
      attempted_at: attemptedAt,
      updated_at: attemptedAt,
    });

    const result = await getSafetyNotificationAdapter().send({
      idempotency_key: attempt.id,
      channel: attempt.channel,
      destination,
      incident_id: incident.id,
      contact_id: contact.id,
      message: this.buildNotificationMessage(incident, attempt, contact),
    });

    const now = getCurrentUtcIsoString();
    const status = result.outcome as SosNotificationStatus;
    withTransaction(({ db }) => {
      sosRepository.updateNotificationAttempt(attemptId, {
        status,
        provider_name: result.provider_name || null,
        provider_message_id: result.provider_message_id || null,
        attempted_at: attemptedAt,
        provider_accepted_at:
          status === SosNotificationStatus.PROVIDER_ACCEPTED || status === SosNotificationStatus.DELIVERED
            ? now
            : null,
        delivered_at: status === SosNotificationStatus.DELIVERED ? now : null,
        failed_at:
          status === SosNotificationStatus.FAILED || status === SosNotificationStatus.NOT_CONFIGURED
            ? now
            : null,
        failure_code: result.failure_code || null,
        failure_message: result.failure_message || null,
        updated_at: now,
      });

      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: `safety.sos.notification.${status.toLowerCase()}`,
          producer: 'garage-os-safety',
          correlation_id: incident.id,
          subject_ids: {
            user: incident.user_id,
            sos_incident: incident.id,
            notification_attempt: attemptId,
            emergency_contact: contact.id,
          },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            incident_id: incident.id,
            notification_attempt_id: attemptId,
            contact_id: contact.id,
            channel: attempt.channel,
            status,
            provider_name: result.provider_name || null,
            delivery_confirmed: status === SosNotificationStatus.DELIVERED,
          },
        }),
        db
      );
    });

    this.refreshNotificationState(incident.id, now);
    return sosRepository.getNotificationAttempt(attemptId);
  }

  respondSafetyCheck(
    actor: AuthenticatedActorContext,
    incidentId: string,
    response: SosSafetyCheckResponse,
    notes?: string
  ): SosIncidentAggregate {
    const incident = this.requireOwnerIncident(actor, incidentId);
    if (incident.status !== SosIncidentStatus.ACTIVATED) {
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION, 'Safety check is only available for an active SOS', 409);
    }
    if (!Object.values(SosSafetyCheckResponse).includes(response)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid safety check response', 400);
    }
    const check = sosRepository.getSafetyCheck(incidentId);
    if (!check) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Safety check not found', 404);
    }

    const now = getCurrentUtcIsoString();
    const changed = sosRepository.respondSafetyCheck(check.id, response, sanitizeNotes(notes), now);
    if (!changed) {
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION, 'Safety check is no longer pending', 409);
    }

    withTransaction(({ db }) => {
      sosRepository.updateIncidentStates(incidentId, {
        safety_check_state: `RESPONDED_${response}`,
        now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.safety_check.responded',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { user: actor.user_id, sos_incident: incidentId, safety_check: check.id },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: { incident_id: incidentId, response, responded_at: now },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'SOS_SAFETY_CHECK_RESPONDED',
          resource_type: 'sos_incident',
          resource_id: incidentId,
          correlation_id: incidentId,
          source: 'SAFETY_API',
          metadata: { response },
        },
        db
      );
    });

    return this.getAggregateForOwner(actor, incidentId);
  }

  timeoutSafetyCheck(checkId: string, incidentId: string, asOf = getCurrentUtcIsoString()): boolean {
    const changed = sosRepository.timeoutSafetyCheck(checkId, asOf);
    if (!changed) return false;

    withTransaction(({ db }) => {
      sosRepository.updateIncidentStates(incidentId, {
        safety_check_state: 'TIMED_OUT_NO_RESPONSE',
        now: asOf,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.safety_check.timed_out',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { sos_incident: incidentId, safety_check: checkId },
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload: {
            incident_id: incidentId,
            safety_check_id: checkId,
            timed_out_at: asOf,
            injury_inferred: false,
          },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_type: CanonicalActorType.SYSTEM_WORKER,
          action: 'SOS_SAFETY_CHECK_TIMED_OUT',
          resource_type: 'sos_incident',
          resource_id: incidentId,
          correlation_id: incidentId,
          source: 'SAFETY_WORKER',
          metadata: { injury_inferred: false },
        },
        db
      );
    });

    return true;
  }

  close(actor: AuthenticatedActorContext, incidentId: string, reason?: string): SosIncidentAggregate {
    const incident = this.requireOwnerIncident(actor, incidentId);
    if (incident.status === SosIncidentStatus.CLOSED) return this.getAggregateForOwner(actor, incidentId);
    if (incident.status !== SosIncidentStatus.ACTIVATED) {
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION, 'Only an activated SOS may be closed', 409);
    }

    const now = getCurrentUtcIsoString();
    withTransaction(({ db }) => {
      const changed = sosRepository.transitionIncident({
        incident_id: incidentId,
        expected_status: SosIncidentStatus.ACTIVATED,
        next_status: SosIncidentStatus.CLOSED,
        now,
        closed_at: now,
        closure_reason: sanitizeNotes(reason) || 'USER_CONFIRMED_CLOSED',
      });
      if (!changed) {
        throw new CanonicalAppError(ErrorCode.CONFLICT, 'SOS state changed concurrently', 409);
      }
      sosRepository.revokeIncidentLocation(incidentId, now);
      sosRepository.recordStatusHistory({
        id: generateCanonicalId('ssh'),
        incident_id: incidentId,
        from_status: SosIncidentStatus.ACTIVATED,
        to_status: SosIncidentStatus.CLOSED,
        actor_id: actor.user_id,
        actor_type: actorType(actor),
        reason: sanitizeNotes(reason) || 'USER_CONFIRMED_CLOSED',
        occurred_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.sos.closed',
          producer: 'garage-os-safety',
          correlation_id: incidentId,
          subject_ids: { user: actor.user_id, sos_incident: incidentId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: {
            incident_id: incidentId,
            closed_at: now,
            assistance_state: incident.assistance_state,
          },
        }),
        db
      );
    });

    return this.getAggregateForOwner(actor, incidentId);
  }

  getActive(actor: AuthenticatedActorContext): SosIncidentAggregate | null {
    const incident = sosRepository.getActiveIncident(actor.user_id);
    return incident ? this.getAggregateForOwner(actor, incident.id) : null;
  }

  getAggregateForOwner(actor: AuthenticatedActorContext, incidentId: string): SosIncidentAggregate {
    const incident = this.requireOwnerIncident(actor, incidentId);
    return this.buildAggregate(incident);
  }

  getHistory(actor: AuthenticatedActorContext, limit = 20): SosIncident[] {
    return sosRepository.listIncidents(actor.user_id, Math.min(Math.max(limit, 1), 50));
  }

  pruneExpiredLocations(asOf = getCurrentUtcIsoString()): number {
    return sosRepository.pruneExpiredLocations(asOf);
  }

  private buildAggregate(incident: SosIncident): SosIncidentAggregate {
    const now = getCurrentUtcIsoString();
    const attempts = sosRepository.listNotificationAttempts(incident.id);
    const anyDelivered = attempts.some((attempt) => attempt.status === SosNotificationStatus.DELIVERED);

    return {
      incident,
      location: sosRepository.getActiveLocation(incident.id, now),
      notification_attempts: attempts,
      safety_check: sosRepository.getSafetyCheck(incident.id),
      acknowledgement: {
        backend_acknowledged: Boolean(incident.server_acknowledged_at),
        backend_acknowledged_at: incident.server_acknowledged_at,
        activation_complete: incident.status === SosIncidentStatus.ACTIVATED || incident.status === SosIncidentStatus.CLOSED,
        trusted_contact_delivery_confirmed: anyDelivered,
        assistance_requested: incident.assistance_state !== 'NOT_REQUESTED',
        assistance_accepted: ['ACCEPTED', 'ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
        assistance_arrived: ['ARRIVED', 'COMPLETED'].includes(incident.assistance_state),
      },
    };
  }

  private buildLocationSnapshot(
    userId: string,
    incidentId: string,
    input: InitiateSosInput,
    preferences: HumanSafetyPreferences,
    now: string
  ): SosLocationSnapshot | null {
    if (!preferences?.allow_location_sharing || !input.location) return null;

    const { latitude, longitude, accuracy_meters } = input.location;
    // Location problems must not block SOS activation. Invalid points are ignored.
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      (accuracy_meters !== undefined && (!Number.isFinite(accuracy_meters) || accuracy_meters < 0))
    ) {
      return null;
    }

    let capturedAt = now;
    if (input.location.captured_at) {
      const parsed = new Date(input.location.captured_at);
      if (!Number.isNaN(parsed.getTime())) capturedAt = parsed.toISOString();
    }
    return {
      id: generateCanonicalId('sol'),
      incident_id: incidentId,
      user_id: userId,
      latitude,
      longitude,
      accuracy_meters: accuracy_meters ?? null,
      captured_at: capturedAt,
      purpose: 'SOS_INITIAL_LOCATION',
      source_type: 'DEVICE_GPS',
      sharing_authorized: true,
      expires_at: new Date(new Date(now).getTime() + SOS_LOCATION_RETENTION_HOURS * 3600_000).toISOString(),
      access_revoked_at: null,
      created_at: now,
    };
  }

  private createContactNotificationAttempts(
    incident: SosIncident,
    preferences: HumanSafetyPreferences,
    now: string
  ): number {
    if (!preferences?.emergency_circle_enabled) return 0;

    const contacts = safetyRepository.listContacts(incident.user_id);
    let queued = 0;
    for (const contact of contacts) {
      const scope = contact.scopes.find((item) => item.incident_level === incident.incident_level);
      if (!scope?.notify_contact) continue;
      const channel = mapContactChannel(contact);
      if (!channel) continue;

      const attempt: SosNotificationAttempt = {
        id: generateCanonicalId('sna'),
        incident_id: incident.id,
        contact_id: contact.id,
        priority: contact.priority,
        channel,
        status: SosNotificationStatus.QUEUED,
        share_incident_type: scope.share_incident_type,
        share_vehicle_summary: scope.share_vehicle_summary,
        share_live_location: scope.share_live_location && Boolean(preferences.allow_location_sharing),
        share_assistance_status: scope.share_assistance_status,
        share_callback_number: scope.share_callback_number,
        provider_name: null,
        provider_message_id: null,
        queued_at: now,
        attempted_at: null,
        provider_accepted_at: null,
        delivered_at: null,
        failed_at: null,
        failure_code: null,
        failure_message: null,
        created_at: now,
        updated_at: now,
      };
      sosRepository.createNotificationAttempt(attempt);
      jobEngine.enqueue(
        SOS_NOTIFICATION_ATTEMPT_JOB,
        { attempt_id: attempt.id },
        { correlationId: incident.id, maxRetries: 3 }
      );
      queued++;
    }
    return queued;
  }

  private buildNotificationMessage(
    incident: SosIncident,
    attempt: SosNotificationAttempt,
    contact: EmergencyContact
  ): string {
    const parts = ['Garage OS safety alert.'];
    if (attempt.share_incident_type) {
      parts.push(`Incident: ${incident.incident_type.replaceAll('_', ' ')}.`);
    }
    if (attempt.share_vehicle_summary && incident.vehicle_id) {
      const row = getDatabase().prepare(
        'SELECT make, model, registration_number FROM vehicles WHERE id = ? LIMIT 1'
      ).get(incident.vehicle_id) as any | undefined;
      if (row) {
        const vehicle = [row.make, row.model, row.registration_number].filter(Boolean).join(' ');
        if (vehicle) parts.push(`Vehicle: ${vehicle}.`);
      }
    }
    if (attempt.share_live_location) {
      const location = sosRepository.getActiveLocation(incident.id, getCurrentUtcIsoString());
      if (location) parts.push(`Location: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}.`);
    }
    if (attempt.share_assistance_status) {
      parts.push('Garage OS has acknowledged the SOS. External assistance has not been confirmed.');
    }
    if (attempt.share_callback_number) {
      const user = getDatabase().prepare('SELECT phone FROM users WHERE id = ? LIMIT 1').get(incident.user_id) as any | undefined;
      if (user?.phone) parts.push(`Callback: ${user.phone}.`);
    }
    parts.push('If you believe there is immediate danger, contact the appropriate local emergency service directly.');
    return parts.join(' ');
  }

  private refreshNotificationState(incidentId: string, now: string): void {
    const attempts = sosRepository.listNotificationAttempts(incidentId);
    let state = 'NO_ELIGIBLE_CONTACTS';
    if (attempts.length > 0) {
      const delivered = attempts.filter((a) => a.status === SosNotificationStatus.DELIVERED).length;
      const accepted = attempts.filter((a) => a.status === SosNotificationStatus.PROVIDER_ACCEPTED).length;
      const queued = attempts.filter((a) => a.status === SosNotificationStatus.QUEUED).length;
      const attempted = attempts.filter((a) => a.status === SosNotificationStatus.ATTEMPTED).length;

      if (delivered === attempts.length) state = 'DELIVERY_CONFIRMED_ALL';
      else if (delivered > 0) state = 'DELIVERY_CONFIRMED_PARTIAL';
      else if (accepted > 0) state = 'PROVIDER_ACCEPTED_UNDELIVERED';
      else if (queued > 0) state = 'QUEUED';
      else if (attempted > 0) state = 'ATTEMPTED_UNCONFIRMED';
      else state = 'NO_CONFIRMED_DELIVERY';
    }
    sosRepository.updateIncidentStates(incidentId, { notification_state: state, now });
  }

  private getPreferences(userId: string): HumanSafetyPreferences {
    const existing = safetyRepository.getPreferences(userId);
    if (existing) return existing;

    const now = getCurrentUtcIsoString();
    const defaults: HumanSafetyPreferences = {
      user_id: userId,
      emergency_circle_enabled: true,
      allow_location_sharing: false,
      safety_check_enabled: true,
      safety_check_timeout_seconds: 120,
      sos_cancel_countdown_seconds: 5,
      escalation_sequence_enabled: true,
      created_at: now,
      updated_at: now,
    };
    safetyRepository.upsertPreferences(defaults);
    return defaults;
  }

  private requireOwnerIncident(actor: AuthenticatedActorContext, incidentId: string): SosIncident {
    const incident = sosRepository.getIncident(actor.user_id, incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'SOS incident not found', 404);
    }
    return incident;
  }
}

export const sosService = new SosService();
