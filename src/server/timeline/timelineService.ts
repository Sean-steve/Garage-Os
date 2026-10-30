/**
 * Canonical Vehicle Timeline & Digital Vehicle Passport Domain Service (GAR-005, GAR-034)
 */

import crypto from 'node:crypto';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalPermission } from '../identity/rbac';
import { vehiclePolicy } from '../vehicle/vehiclePolicy';
import { timelineRepository } from './timelineRepository';
import { passportBuilder } from './passportBuilder';
import { recordAuditEvent } from '../security/audit';
import { enqueueOutboxEvent } from '../events/outbox';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { CanonicalActorType } from '../../shared/types';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  TimelineFilterQueryDTO,
  TimelineCursorPaginatedResultDTO,
  VehicleTimelineEntryEntity,
  TimelineCorrectionEntity,
  TimelineDisputeEntity,
  SubmitTimelineCorrectionDTO,
  SubmitTimelineDisputeDTO,
  VehiclePassportDTO,
  CreatePassportShareDTO,
  PassportShareResultDTO,
  PublicSharedPassportDTO,
  PassportShareScope,
  PassportShareGrantEntity,
  TimelineVerificationStatus,
} from './types';

export class TimelineService {
  /**
   * Retrieves paginated timeline entries for a vehicle.
   */
  getTimeline(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    filters: TimelineFilterQueryDTO = {}
  ): TimelineCursorPaginatedResultDTO {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TIMELINE_READ);

    const result = timelineRepository.getTimelineEntries(vehicleId, filters);

    return {
      entries: result.entries,
      next_cursor: result.nextCursor,
      has_more: Boolean(result.nextCursor),
      total_count: result.totalCount,
    };
  }

  /**
   * Retrieves details for a specific timeline entry including its correction/dispute history.
   */
  getTimelineEntry(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    entryId: string
  ): {
    entry: VehicleTimelineEntryEntity;
    corrections: TimelineCorrectionEntity[];
    disputes: TimelineDisputeEntity[];
  } {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TIMELINE_READ);

    const entry = timelineRepository.getTimelineEntryById(entryId);
    if (!entry || entry.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TIMELINE_ENTRY_NOT_FOUND,
        `Timeline entry ${entryId} not found for vehicle ${vehicleId}`,
        404
      );
    }

    const corrections = timelineRepository.getCorrectionsForEntry(entryId);
    const disputes = timelineRepository.getDisputesForEntry(entryId);

    return {
      entry,
      corrections,
      disputes,
    };
  }

  /**
   * Submits a non-destructive correction for an existing timeline entry.
   */
  submitCorrection(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    entryId: string,
    dto: SubmitTimelineCorrectionDTO
  ): {
    original: VehicleTimelineEntryEntity;
    corrected: VehicleTimelineEntryEntity;
    correction: TimelineCorrectionEntity;
  } {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TIMELINE_CORRECT);

    if (!dto.reason || !dto.explanation || !dto.explanation.trim()) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Correction reason and explanation are required',
        400
      );
    }

    const original = timelineRepository.getTimelineEntryById(entryId);
    if (!original || original.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TIMELINE_ENTRY_NOT_FOUND,
        `Timeline entry ${entryId} not found for vehicle ${vehicleId}`,
        404
      );
    }

    if (!original.is_active || original.verification_status === TimelineVerificationStatus.SUPERSEDED) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TIMELINE_ENTRY_SUPERSEDED,
        `Timeline entry ${entryId} has already been superseded by a prior correction`,
        409
      );
    }

    const now = getCurrentUtcIsoString();
    const correctedEntryId = `vte_corr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const correctedEntry: VehicleTimelineEntryEntity = {
      id: correctedEntryId,
      vehicle_id: vehicleId,
      entry_type: original.entry_type,
      category: original.category,
      occurred_at: dto.updated_occurred_at || original.occurred_at,
      recorded_at: now,
      title: dto.updated_title || original.title,
      summary: dto.updated_summary || original.summary,
      source_type: original.source_type,
      source_reference_type: original.source_reference_type,
      source_reference_id: original.source_reference_id,
      source_event_id: null,
      actor_type: actor.type || CanonicalActorType.VEHICLE_OWNER,
      actor_id: actor.user_id,
      organization_id: actor.active_organization_id || null,
      verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
      confidence: original.confidence,
      odometer_value: dto.updated_odometer_value !== undefined ? dto.updated_odometer_value : original.odometer_value,
      odometer_unit: dto.updated_odometer_unit || original.odometer_unit,
      location_reference: original.location_reference,
      visibility: original.visibility,
      sensitivity: original.sensitivity,
      supersedes_timeline_entry_id: original.id,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: {
        ...original.metadata,
        ...(dto.metadata || {}),
        correction_reason: dto.reason,
        correction_explanation: dto.explanation,
      },
      created_at: now,
      updated_at: now,
    };

    const result = timelineRepository.recordCorrection({
      originalEntryId: original.id,
      vehicleId,
      correctionReason: dto.reason,
      explanation: dto.explanation.trim(),
      actorId: actor.user_id,
      actorType: actor.type || 'USER',
      correctedEntry,
    });

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_TIMELINE_ENTRY_CORRECTED',
      resource_type: 'vehicle_timeline_entry',
      resource_id: result.corrected.id,
      correlation_id: `vte_corr_${result.correction.id}`,
      source: 'timeline-domain',
      metadata: {
        vehicle_id: vehicleId,
        original_entry_id: original.id,
        reason: dto.reason,
      },
    });

    // Rebuild passport projection
    passportBuilder.buildPassport(vehicleId);

    // Enqueue outbox event
    const eventEnvelope = createCanonicalEventEnvelope({
      type: 'vehicle.timeline.corrected',
      producer: 'timeline-domain',
      actor_id: actor.user_id,
      actor_type: actor.type || CanonicalActorType.VEHICLE_OWNER,
      subject_ids: { vehicle: vehicleId, original_entry: original.id, corrected_entry: result.corrected.id },
      correlation_id: `vte_corr_${result.correction.id}`,
      payload: {
        vehicle_id: vehicleId,
        original_entry_id: original.id,
        corrected_entry_id: result.corrected.id,
        reason: dto.reason,
      },
    });
    enqueueOutboxEvent(eventEnvelope);

    return result;
  }

  /**
   * Submits a dispute against an entry.
   */
  submitDispute(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    entryId: string,
    dto: SubmitTimelineDisputeDTO
  ): TimelineDisputeEntity {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_TIMELINE_DISPUTE);

    if (!dto.reason || !dto.reason.trim()) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Dispute reason is required', 400);
    }

    const entry = timelineRepository.getTimelineEntryById(entryId);
    if (!entry || entry.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(
        ErrorCode.VEHICLE_TIMELINE_ENTRY_NOT_FOUND,
        `Timeline entry ${entryId} not found for vehicle ${vehicleId}`,
        404
      );
    }

    const dispute = timelineRepository.recordDispute({
      entryId,
      vehicleId,
      disputeReason: dto.reason.trim(),
      actorId: actor.user_id,
    });

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_TIMELINE_ENTRY_DISPUTED',
      resource_type: 'vehicle_timeline_entry',
      resource_id: entryId,
      correlation_id: `vte_disp_${dispute.id}`,
      source: 'timeline-domain',
      metadata: { vehicle_id: vehicleId, entry_id: entryId, reason: dto.reason },
    });

    passportBuilder.buildPassport(vehicleId);

    return dispute;
  }

  /**
   * Retrieves full Digital Vehicle Passport for an authorized actor.
   */
  getPassport(actor: AuthenticatedActorContext, vehicleId: string): VehiclePassportDTO {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_PASSPORT_READ);
    return passportBuilder.getOrBuildPassport(vehicleId);
  }

  /**
   * Rebuilds the Digital Vehicle Passport projection from scratch.
   */
  rebuildPassport(actor: AuthenticatedActorContext, vehicleId: string): VehiclePassportDTO {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_PASSPORT_REBUILD);
    return passportBuilder.buildPassport(vehicleId);
  }

  /**
   * Creates a secure, time-bounded passport share grant.
   */
  createPassportShare(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    dto: CreatePassportShareDTO
  ): PassportShareResultDTO {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_PASSPORT_SHARE);

    const scopes = dto.scopes && dto.scopes.length > 0 ? dto.scopes : [PassportShareScope.FULL_STANDARD_PASSPORT];
    const expiresInHours = Math.min(Math.max(Number(dto.expires_in_hours) || 72, 1), 720); // 1 hr to 30 days

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 3600 * 1000).toISOString();
    const shareId = `vpsg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const grant: PassportShareGrantEntity = {
      id: shareId,
      vehicle_id: vehicleId,
      created_by: actor.user_id,
      token_hash: tokenHash,
      scope: JSON.stringify(scopes),
      recipient_label: dto.recipient_label ? dto.recipient_label.trim() : null,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: now.toISOString(),
    };

    timelineRepository.createPassportShareGrant(grant);

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_PASSPORT_SHARE_CREATED',
      resource_type: 'passport_share_grant',
      resource_id: shareId,
      correlation_id: `vpsg_cre_${shareId}`,
      source: 'timeline-domain',
      metadata: { vehicle_id: vehicleId, scopes, expires_at: expiresAt },
    });

    return {
      share_id: shareId,
      token: rawToken,
      share_url: `/api/v1/passport-shares/${rawToken}`,
      expires_at: expiresAt,
      scopes,
      recipient_label: grant.recipient_label,
    };
  }

  /**
   * Retrieves public/shared passport view via token.
   * Filters sections based on granted scopes.
   */
  getPublicSharedPassport(
    rawToken: string,
    clientIp?: string,
    userAgent?: string
  ): PublicSharedPassportDTO {
    if (!rawToken || !rawToken.trim()) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_PASSPORT_SHARE_INVALID, 'Valid passport share token is required', 400);
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const grant = timelineRepository.getPassportShareGrantByTokenHash(tokenHash);

    if (!grant) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_PASSPORT_SHARE_INVALID, 'Passport share link is invalid or does not exist', 400);
    }

    if (grant.revoked_at) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_PASSPORT_SHARE_REVOKED, 'This passport share link has been revoked by the vehicle owner', 410);
    }

    const now = new Date();
    if (new Date(grant.expires_at) < now) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_PASSPORT_SHARE_EXPIRED, 'This passport share link has expired', 410);
    }

    // Log access
    timelineRepository.logPassportShareAccess({
      id: `psal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      share_grant_id: grant.id,
      ip_address: clientIp || null,
      user_agent: userAgent || null,
      accessed_at: now.toISOString(),
    });

    // Build or fetch projection
    const fullPassport = passportBuilder.getOrBuildPassport(grant.vehicle_id);

    let scopes: PassportShareScope[] = [PassportShareScope.FULL_STANDARD_PASSPORT];
    try {
      scopes = JSON.parse(grant.scope);
    } catch {
      scopes = [PassportShareScope.FULL_STANDARD_PASSPORT];
    }

    // Filter passport based on scopes
    const isFull = scopes.includes(PassportShareScope.FULL_STANDARD_PASSPORT);

    const filtered: Partial<VehiclePassportDTO> = {
      metadata: fullPassport.metadata,
      vehicle_identity: fullPassport.vehicle_identity,
      verification_summary: fullPassport.verification_summary,
    };

    if (isFull || scopes.includes(PassportShareScope.MILEAGE_HISTORY)) {
      filtered.mileage_history = fullPassport.mileage_history;
    }
    if (isFull || scopes.includes(PassportShareScope.SERVICE_HISTORY)) {
      filtered.maintenance_history = fullPassport.maintenance_history;
    }
    if (isFull || scopes.includes(PassportShareScope.REPAIR_HISTORY)) {
      filtered.repair_history = fullPassport.repair_history;
    }
    if (isFull || scopes.includes(PassportShareScope.ACCIDENT_HISTORY)) {
      filtered.accident_history = fullPassport.accident_history;
    }
    if (isFull || scopes.includes(PassportShareScope.PART_HISTORY)) {
      filtered.installed_parts = fullPassport.installed_parts;
    }
    if (isFull || scopes.includes(PassportShareScope.MODIFICATION_HISTORY)) {
      filtered.modifications = fullPassport.modifications;
    }
    if (isFull) {
      filtered.ownership_summary = fullPassport.ownership_summary;
      filtered.known_issues_history = fullPassport.known_issues_history;
      filtered.tyres = fullPassport.tyres;
      filtered.roadside_towing_history = fullPassport.roadside_towing_history;
      filtered.inspections = fullPassport.inspections;
    }

    return {
      passport: filtered,
      share_info: {
        recipient_label: grant.recipient_label,
        expires_at: grant.expires_at,
        granted_scopes: scopes,
      },
    };
  }

  /**
   * Revokes a passport share grant.
   */
  revokePassportShare(actor: AuthenticatedActorContext, vehicleId: string, shareId: string): void {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_PASSPORT_SHARE_REVOKE);

    const revoked = timelineRepository.revokePassportShareGrant(shareId, vehicleId);
    if (!revoked) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Share grant ${shareId} not found or already revoked`, 404);
    }

    recordAuditEvent({
      actor_id: actor.user_id,
      actor_type: 'USER',
      action: 'VEHICLE_PASSPORT_SHARE_REVOKED',
      resource_type: 'passport_share_grant',
      resource_id: shareId,
      correlation_id: `vpsg_rev_${shareId}`,
      source: 'timeline-domain',
      metadata: { vehicle_id: vehicleId, share_id: shareId },
    });
  }

  /**
   * Retrieves active share grants for a vehicle.
   */
  getVehicleShareGrants(actor: AuthenticatedActorContext, vehicleId: string): PassportShareGrantEntity[] {
    vehiclePolicy.assertVehicleAccess(actor, vehicleId, CanonicalPermission.VEHICLE_PASSPORT_SHARE);
    return timelineRepository.getPassportShareGrantsForVehicle(vehicleId);
  }
}

export const timelineService = new TimelineService();
