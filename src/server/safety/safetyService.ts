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
import { safetyRepository } from './safetyRepository';
import { trustedContactService } from './trustedContactService';
import {
  AddEmergencyContactInput,
  EmergencyContact,
  EmergencyContactStatus,
  EmergencyContactVerificationStatus,
  HumanSafetyPreferences,
  SafetyIncidentLevel,
  SafetyReadiness,
  UpdateContactScopeInput,
  UpdateEmergencyContactInput,
  UpdateHumanSafetyPreferencesInput,
} from './types';

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function actorType(actor: AuthenticatedActorContext): CanonicalActorType {
  return actor.type || CanonicalActorType.VEHICLE_OWNER;
}

function requireNonEmpty(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `${field} is required`, 400);
  }
  if (normalized.length > maxLength) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `${field} is too long`, 400);
  }
  return normalized;
}

function normalizePhone(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const phone = value.trim();
  if (!E164.test(phone)) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      'phone_e164 must use international E.164 format, for example +254700000000',
      400
    );
  }
  return phone;
}

function normalizeEmail(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const email = value.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'email is invalid', 400);
  }
  return email;
}

function validatePriority(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'priority must be an integer between 1 and 99', 400);
  }
  return value;
}

function defaultScope(contactId: string, level: SafetyIncidentLevel, now: string) {
  return {
    id: generateCanonicalId('ecs'),
    contact_id: contactId,
    incident_level: level,
    notify_contact: true,
    share_incident_type: true,
    share_vehicle_summary: true,
    // Privacy-safe default: location sharing is opt-in and also subject to the
    // user's global allow_location_sharing preference.
    share_live_location: false,
    share_assistance_status: true,
    share_callback_number: true,
    created_at: now,
    updated_at: now,
  };
}

export class SafetyService {
  getEmergencyCircle(actor: AuthenticatedActorContext) {
    const contacts = safetyRepository.listContacts(actor.user_id);
    const preferences = this.getPreferences(actor);
    return {
      contacts,
      preferences,
      readiness: this.getReadiness(actor),
      execution_capabilities: {
        sos_activation: true,
        trusted_contact_notification_orchestration: true,
        notification_delivery_provider_configured: false,
        trusted_contact_portal: false,
        live_location_streaming: false,
        automatic_escalation: false,
      },
    };
  }

  addContact(actor: AuthenticatedActorContext, input: AddEmergencyContactInput): EmergencyContact {
    const displayName = requireNonEmpty(input.display_name, 'display_name', 120);
    const relationship = input.relationship_label
      ? requireNonEmpty(input.relationship_label, 'relationship_label', 80)
      : null;
    const phone = normalizePhone(input.phone_e164);
    const email = normalizeEmail(input.email);
    const priority = validatePriority(input.priority ?? 1);

    if (!phone && !email) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one contact channel (phone_e164 or email) is required',
        400
      );
    }

    if (safetyRepository.getContactByPhoneOrEmail(actor.user_id, phone, email)) {
      throw new CanonicalAppError(
        ErrorCode.CONFLICT,
        'An active Emergency Circle contact already uses this phone number or email',
        409
      );
    }

    const activeContacts = safetyRepository.listContacts(actor.user_id);
    if (activeContacts.length >= 10) {
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Emergency Circle supports up to 10 active contacts',
        409
      );
    }

    const now = getCurrentUtcIsoString();
    const contactId = generateCanonicalId('emc');
    const contact: Omit<EmergencyContact, 'scopes'> = {
      id: contactId,
      user_id: actor.user_id,
      display_name: displayName,
      relationship_label: relationship,
      phone_e164: phone,
      email,
      priority,
      status: EmergencyContactStatus.ACTIVE,
      verification_status: EmergencyContactVerificationStatus.UNVERIFIED,
      created_at: now,
      updated_at: now,
      revoked_at: null,
    };

    withTransaction(({ db }) => {
      safetyRepository.insertContact(contact);
      for (const level of Object.values(SafetyIncidentLevel)) {
        safetyRepository.upsertScope(defaultScope(contactId, level, now));
      }
      safetyRepository.recordHistory({
        id: generateCanonicalId('sch'),
        user_id: actor.user_id,
        change_type: 'EMERGENCY_CONTACT_ADDED',
        subject_id: contactId,
        summary: { priority, channels: { phone: Boolean(phone), email: Boolean(email) } },
        actor_id: actor.user_id,
        created_at: now,
      });

      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.emergency_contact.added',
          producer: 'garage-os-safety',
          correlation_id: contactId,
          subject_ids: { user: actor.user_id, emergency_contact: contactId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: { contact_id: contactId, priority, verification_status: 'UNVERIFIED' },
        }),
        db
      );

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'EMERGENCY_CONTACT_ADDED',
          resource_type: 'emergency_contact',
          resource_id: contactId,
          correlation_id: contactId,
          source: 'SAFETY_API',
          metadata: { priority, has_phone: Boolean(phone), has_email: Boolean(email) },
        },
        db
      );
    });

    return safetyRepository.getContact(actor.user_id, contactId)!;
  }

  updateContact(
    actor: AuthenticatedActorContext,
    contactId: string,
    input: UpdateEmergencyContactInput
  ): EmergencyContact {
    const current = this.requireContact(actor, contactId);
    if (current.status !== EmergencyContactStatus.ACTIVE) {
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION, 'Revoked contacts cannot be edited', 409);
    }

    const displayName =
      input.display_name !== undefined
        ? requireNonEmpty(input.display_name, 'display_name', 120)
        : current.display_name;
    const relationship =
      input.relationship_label !== undefined
        ? input.relationship_label
          ? requireNonEmpty(input.relationship_label, 'relationship_label', 80)
          : null
        : current.relationship_label;
    const phone = input.phone_e164 !== undefined ? normalizePhone(input.phone_e164) : current.phone_e164 || null;
    const email = input.email !== undefined ? normalizeEmail(input.email) : current.email || null;
    const priority = input.priority !== undefined ? validatePriority(input.priority) : current.priority;

    if (!phone && !email) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'At least one contact channel (phone_e164 or email) is required',
        400
      );
    }

    const duplicate = safetyRepository.getContactByPhoneOrEmail(actor.user_id, phone, email);
    if (duplicate && duplicate.id !== contactId) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, 'Another active Emergency Circle contact uses this channel', 409);
    }

    const now = getCurrentUtcIsoString();
    withTransaction(({ db }) => {
      safetyRepository.updateContact(actor.user_id, contactId, {
        display_name: displayName,
        relationship_label: relationship,
        phone_e164: phone,
        email,
        priority,
        updated_at: now,
      });
      safetyRepository.recordHistory({
        id: generateCanonicalId('sch'),
        user_id: actor.user_id,
        change_type: 'EMERGENCY_CONTACT_UPDATED',
        subject_id: contactId,
        summary: { priority, channels: { phone: Boolean(phone), email: Boolean(email) } },
        actor_id: actor.user_id,
        created_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.emergency_contact.updated',
          producer: 'garage-os-safety',
          correlation_id: contactId,
          subject_ids: { user: actor.user_id, emergency_contact: contactId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: { contact_id: contactId, priority },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'EMERGENCY_CONTACT_UPDATED',
          resource_type: 'emergency_contact',
          resource_id: contactId,
          correlation_id: contactId,
          source: 'SAFETY_API',
          metadata: { priority },
        },
        db
      );
    });

    return safetyRepository.getContact(actor.user_id, contactId)!;
  }

  revokeContact(actor: AuthenticatedActorContext, contactId: string): void {
    const current = this.requireContact(actor, contactId);
    if (current.status === EmergencyContactStatus.REVOKED) return;

    const now = getCurrentUtcIsoString();
    withTransaction(({ db }) => {
      safetyRepository.revokeContact(actor.user_id, contactId, now);
      safetyRepository.recordHistory({
        id: generateCanonicalId('sch'),
        user_id: actor.user_id,
        change_type: 'EMERGENCY_CONTACT_REVOKED',
        subject_id: contactId,
        summary: { previous_priority: current.priority },
        actor_id: actor.user_id,
        created_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.emergency_contact.revoked',
          producer: 'garage-os-safety',
          correlation_id: contactId,
          subject_ids: { user: actor.user_id, emergency_contact: contactId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: { contact_id: contactId },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'EMERGENCY_CONTACT_REVOKED',
          resource_type: 'emergency_contact',
          resource_id: contactId,
          correlation_id: contactId,
          source: 'SAFETY_API',
        },
        db
      );
    trustedContactService.revokeContactGrants(contactId);
    });
  }

  updateContactScope(
    actor: AuthenticatedActorContext,
    contactId: string,
    input: UpdateContactScopeInput
  ): EmergencyContact {
    const contact = this.requireContact(actor, contactId);
    if (contact.status !== EmergencyContactStatus.ACTIVE) {
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION, 'Revoked contacts cannot receive new sharing scopes', 409);
    }
    if (!Object.values(SafetyIncidentLevel).includes(input.incident_level)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid incident_level', 400);
    }

    const now = getCurrentUtcIsoString();
    withTransaction(({ db }) => {
      safetyRepository.upsertScope({
        id: generateCanonicalId('ecs'),
        contact_id: contactId,
        incident_level: input.incident_level,
        notify_contact: Boolean(input.notify_contact),
        share_incident_type: Boolean(input.share_incident_type),
        share_vehicle_summary: Boolean(input.share_vehicle_summary),
        share_live_location: Boolean(input.share_live_location),
        share_assistance_status: Boolean(input.share_assistance_status),
        share_callback_number: Boolean(input.share_callback_number),
        created_at: now,
        updated_at: now,
      });
      safetyRepository.recordHistory({
        id: generateCanonicalId('sch'),
        user_id: actor.user_id,
        change_type: 'EMERGENCY_CONTACT_SCOPE_UPDATED',
        subject_id: contactId,
        summary: {
          incident_level: input.incident_level,
          notify_contact: Boolean(input.notify_contact),
          share_live_location: Boolean(input.share_live_location),
        },
        actor_id: actor.user_id,
        created_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.emergency_contact.scope_updated',
          producer: 'garage-os-safety',
          correlation_id: contactId,
          subject_ids: { user: actor.user_id, emergency_contact: contactId },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: {
            contact_id: contactId,
            incident_level: input.incident_level,
            notify_contact: Boolean(input.notify_contact),
            share_live_location: Boolean(input.share_live_location),
          },
        }),
        db
      );
    });

    return safetyRepository.getContact(actor.user_id, contactId)!;
  }

  getPreferences(actor: AuthenticatedActorContext): HumanSafetyPreferences {
    const existing = safetyRepository.getPreferences(actor.user_id);
    if (existing) return existing;

    const now = getCurrentUtcIsoString();
    const defaults: HumanSafetyPreferences = {
      user_id: actor.user_id,
      emergency_circle_enabled: true,
      allow_location_sharing: false,
      safety_check_enabled: true,
      safety_check_timeout_seconds: 120,
      sos_cancel_countdown_seconds: 5,
      escalation_sequence_enabled: true,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      safetyRepository.upsertPreferences(defaults);
    });
    return defaults;
  }

  updatePreferences(
    actor: AuthenticatedActorContext,
    input: UpdateHumanSafetyPreferencesInput
  ): HumanSafetyPreferences {
    const current = this.getPreferences(actor);
    const timeout =
      input.safety_check_timeout_seconds ?? current.safety_check_timeout_seconds;
    const countdown =
      input.sos_cancel_countdown_seconds ?? current.sos_cancel_countdown_seconds;

    if (!Number.isInteger(timeout) || timeout < 30 || timeout > 3600) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'safety_check_timeout_seconds must be between 30 and 3600',
        400
      );
    }
    if (!Number.isInteger(countdown) || countdown < 3 || countdown > 15) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'sos_cancel_countdown_seconds must be between 3 and 15',
        400
      );
    }

    const now = getCurrentUtcIsoString();
    const updated: HumanSafetyPreferences = {
      ...current,
      emergency_circle_enabled:
        input.emergency_circle_enabled ?? current.emergency_circle_enabled,
      allow_location_sharing:
        input.allow_location_sharing ?? current.allow_location_sharing,
      safety_check_enabled:
        input.safety_check_enabled ?? current.safety_check_enabled,
      safety_check_timeout_seconds: timeout,
      sos_cancel_countdown_seconds: countdown,
      escalation_sequence_enabled:
        input.escalation_sequence_enabled ?? current.escalation_sequence_enabled,
      updated_at: now,
    };

    withTransaction(({ db }) => {
      safetyRepository.upsertPreferences(updated);
      safetyRepository.recordHistory({
        id: generateCanonicalId('sch'),
        user_id: actor.user_id,
        change_type: 'HUMAN_SAFETY_PREFERENCES_UPDATED',
        summary: {
          emergency_circle_enabled: updated.emergency_circle_enabled,
          allow_location_sharing: updated.allow_location_sharing,
          safety_check_enabled: updated.safety_check_enabled,
          safety_check_timeout_seconds: updated.safety_check_timeout_seconds,
          sos_cancel_countdown_seconds: updated.sos_cancel_countdown_seconds,
          escalation_sequence_enabled: updated.escalation_sequence_enabled,
        },
        actor_id: actor.user_id,
        created_at: now,
      });
      enqueueOutboxEvent(
        createCanonicalEventEnvelope({
          type: 'safety.preferences.updated',
          producer: 'garage-os-safety',
          correlation_id: actor.user_id,
          subject_ids: { user: actor.user_id },
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          provenance_class: DataProvenanceClass.OWNER_ASSERTED,
          payload: {
            emergency_circle_enabled: updated.emergency_circle_enabled,
            allow_location_sharing: updated.allow_location_sharing,
            safety_check_enabled: updated.safety_check_enabled,
          },
        }),
        db
      );
      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: actorType(actor),
          action: 'HUMAN_SAFETY_PREFERENCES_UPDATED',
          resource_type: 'human_safety_preferences',
          resource_id: actor.user_id,
          correlation_id: actor.user_id,
          source: 'SAFETY_API',
          metadata: {
            emergency_circle_enabled: updated.emergency_circle_enabled,
            allow_location_sharing: updated.allow_location_sharing,
          },
        },
        db
      );
    });

    return updated;
  }

  getReadiness(actor: AuthenticatedActorContext): SafetyReadiness {
    const contacts = safetyRepository.listContacts(actor.user_id);
    const preferences = this.getPreferences(actor);
    const phoneContacts = contacts.filter((contact) => Boolean(contact.phone_e164));
    const blockers: string[] = [];

    if (!preferences.emergency_circle_enabled) {
      return {
        state: 'DISABLED',
        active_contact_count: contacts.length,
        contacts_with_phone_count: phoneContacts.length,
        location_sharing_enabled: preferences.allow_location_sharing,
        safety_check_enabled: preferences.safety_check_enabled,
        sos_engine_active: true,
        notification_engine_active: true,
        trusted_contact_portal_active: false,
        blockers: ['Emergency Circle is disabled by the user.'],
        notes: ['The SOS engine is operational, but Emergency Circle contact notification is disabled by the user. External assistance is never implied.'],
      };
    }

    if (contacts.length === 0) blockers.push('Add at least one Emergency Circle contact.');
    if (phoneContacts.length === 0) blockers.push('Add at least one contact with an E.164 phone number.');

    return {
      state: blockers.length === 0 ? 'CONFIGURED' : 'INCOMPLETE',
      active_contact_count: contacts.length,
      contacts_with_phone_count: phoneContacts.length,
      location_sharing_enabled: preferences.allow_location_sharing,
      safety_check_enabled: preferences.safety_check_enabled,
      sos_engine_active: true,
      notification_engine_active: true,
      trusted_contact_portal_active: false,
      blockers,
      notes: [
        'Sprint 16 provides durable SOS activation and notification-attempt orchestration.',
        'Notification delivery is only confirmed when a configured provider returns authoritative delivery evidence.',
        'Trusted-contact web access and automatic escalation remain unavailable until later safety sprints.',
        'Failure to respond must never be treated as proof of injury.',
      ],
    };
  }

  private requireContact(actor: AuthenticatedActorContext, contactId: string): EmergencyContact {
    const contact = safetyRepository.getContact(actor.user_id, contactId);
    if (!contact) {
      // Deliberately do not disclose whether another user owns the identifier.
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Emergency contact not found', 404);
    }
    return contact;
  }
}

export const safetyService = new SafetyService();
