/**
 * Garage OS — Sprint 14: Shared Dispatch Engine (GAR-016)
 * Orchestrates candidate discovery, multi-strategy offering, atomic transactional acceptance,
 * privacy-guarded live tracking projections, and reassignment.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { dispatchRepository } from './dispatchRepository';
import { matchingEngine } from './matchingEngine';
import { locationService } from './locationService';
import { routingService } from './routingService';
import { realtimeBus } from './realtimeBus';
import { roadsideDispatchAdapter } from './adapters/roadsideAdapter';
import { towingDispatchAdapter } from './adapters/towingAdapter';
import {
  DispatchDomain,
  DispatchPriority,
  DispatchRequestStatus,
  DispatchStrategy,
  DispatchAttemptStatus,
  ResponderAvailabilityStatus,
  TrackingAccessStatus,
  LocationFreshness,
  DispatchRequestEntity,
  DispatchAttemptEntity,
  DispatchCandidateEntity,
  DispatchTrackingProjectionEntity,
  DispatchDomainAdapter,
} from './types';

export interface CreateDispatchRequestInput {
  dispatch_domain: DispatchDomain;
  source_reference_type: string;
  source_reference_id: string;
  required_capability?: string;
  pickup_latitude?: number;
  pickup_longitude?: number;
  pickup_address?: string | null;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  destination_address?: string | null;
  vehicle_id?: string | null;
  priority?: DispatchPriority;
  strategy?: DispatchStrategy;
}

export class DispatchService {
  private getAdapter(domain: DispatchDomain): DispatchDomainAdapter {
    switch (domain) {
      case DispatchDomain.ROADSIDE:
        return roadsideDispatchAdapter;
      case DispatchDomain.TOWING:
        return towingDispatchAdapter;
      default:
        // Default to roadside adapter for mobile mechanics / SOS
        return roadsideDispatchAdapter;
    }
  }

  /**
   * Creates a new dispatch request, discovers candidates, and initiates the initial dispatch attempt.
   */
  async createRequest(input: CreateDispatchRequestInput, customDb?: DatabaseSync): Promise<{
    request: DispatchRequestEntity;
    attempt: DispatchAttemptEntity;
    candidates: DispatchCandidateEntity[];
  }> {
    const db = customDb || getDatabase();
    const now = getCurrentUtcIsoString();
    const adapter = this.getAdapter(input.dispatch_domain);

    // 1. Fetch details from source request if not explicitly provided
    let pickupLat = input.pickup_latitude;
    let pickupLon = input.pickup_longitude;
    let destLat = input.destination_latitude ?? null;
    let destLon = input.destination_longitude ?? null;
    let vehicleId = input.vehicle_id ?? null;
    let capability = input.required_capability;
    let priority = input.priority || DispatchPriority.NORMAL;

    if (!pickupLat || !pickupLon || !capability) {
      const source = await adapter.loadSourceRequest(input.source_reference_id);
      pickupLat = pickupLat ?? source.pickupLatitude;
      pickupLon = pickupLon ?? source.pickupLongitude;
      destLat = destLat ?? source.destinationLatitude;
      destLon = destLon ?? source.destinationLongitude;
      vehicleId = vehicleId ?? source.vehicleId;
      capability = capability ?? source.requiredCapability;
      priority = input.priority || source.priority || DispatchPriority.NORMAL;
    }

    if (pickupLat === undefined || pickupLon === undefined) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Pickup latitude and longitude are required for dispatch'
      );
    }

    const requestId = generateCanonicalId('dr');
    const strategy = input.strategy || DispatchStrategy.BATCH;

    const request: DispatchRequestEntity = {
      id: requestId,
      dispatch_domain: input.dispatch_domain,
      source_reference_type: input.source_reference_type,
      source_reference_id: input.source_reference_id,
      required_capability: capability,
      pickup_latitude: pickupLat,
      pickup_longitude: pickupLon,
      pickup_address: input.pickup_address || null,
      destination_latitude: destLat,
      destination_longitude: destLon,
      destination_address: input.destination_address || null,
      vehicle_id: vehicleId,
      priority,
      status: DispatchRequestStatus.CREATED,
      strategy,
      strategy_version: matchingEngine.STRATEGY_VERSION,
      current_attempt_number: 1,
      active_attempt_id: null,
      assigned_provider_id: null,
      assigned_responder_type: null,
      assigned_responder_id: null,
      lock_version: 1,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    dispatchRepository.createRequest(request, db);

    // 2. Launch initial dispatch attempt (Attempt 1: 5km radius)
    const { attempt, candidates } = await this.executeDispatchAttempt(
      request,
      1,
      5.0, // 5 km initial search radius
      db
    );

    const updatedRequest = dispatchRepository.getRequestById(requestId, db) || request;
    return { request: updatedRequest, attempt, candidates };
  }

  /**
   * Executes a dispatch attempt with matching, candidate scoring, and strategy dispatch.
   */
  async executeDispatchAttempt(
    request: DispatchRequestEntity,
    attemptNumber: number,
    searchRadiusKm: number,
    customDb?: DatabaseSync
  ): Promise<{
    attempt: DispatchAttemptEntity;
    candidates: DispatchCandidateEntity[];
  }> {
    const db = customDb || getDatabase();
    const now = getCurrentUtcIsoString();
    const attemptId = generateCanonicalId('da');

    // 1. Evaluate candidates using matching engine
    const candidates = await matchingEngine.evaluateCandidates(
      {
        dispatchRequestId: request.id,
        dispatchAttemptId: attemptId,
        domain: request.dispatch_domain,
        requiredCapability: request.required_capability,
        pickupLatitude: request.pickup_latitude,
        pickupLongitude: request.pickup_longitude,
        vehicleId: request.vehicle_id,
        searchRadiusKm,
        maxCandidates: 10,
      },
      db
    );

    const eligibleCandidates = candidates.filter((c) => c.eligibility_status === 'ELIGIBLE');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const attempt: DispatchAttemptEntity = {
      id: attemptId,
      dispatch_request_id: request.id,
      attempt_number: attemptNumber,
      strategy: request.strategy,
      search_radius_km: searchRadiusKm,
      candidate_ids_json: JSON.stringify(candidates.map((c) => c.id)),
      status: eligibleCandidates.length > 0 ? DispatchAttemptStatus.OFFERS_SENT : DispatchAttemptStatus.EXHAUSTED,
      started_at: now,
      expires_at: expiresAt,
      completed_at: null,
      created_at: now,
    };

    dispatchRepository.createAttempt(attempt, db);
    dispatchRepository.saveCandidates(candidates, db);

    const adapter = this.getAdapter(request.dispatch_domain);

    if (eligibleCandidates.length === 0) {
      logger.warn(`No eligible candidates found for dispatch request ${request.id} at radius ${searchRadiusKm}km`);

      // If attempt < 3, automatically expand radius
      if (attemptNumber === 1 && searchRadiusKm < 15.0) {
        return this.executeDispatchAttempt(request, 2, 15.0, db);
      } else if (attemptNumber === 2 && searchRadiusKm < 30.0) {
        return this.executeDispatchAttempt(request, 3, 30.0, db);
      }

      // Mark request as EXHAUSTED
      dispatchRepository.updateRequest(
        request.id,
        {
          status: DispatchRequestStatus.EXHAUSTED,
          active_attempt_id: attemptId,
          updated_at: now,
        },
        db
      );

      realtimeBus.publish(`dispatch.request.${request.id}`, 'DISPATCH_EXHAUSTED', {
        dispatch_request_id: request.id,
        attempt_id: attemptId,
        message: 'No eligible service providers currently available in the area',
      });

      realtimeBus.publish('operations.dispatch', 'DISPATCH_EXHAUSTED', {
        dispatch_request_id: request.id,
        priority: request.priority,
        pickup: { latitude: request.pickup_latitude, longitude: request.pickup_longitude },
      });

      return { attempt, candidates };
    }

    // 2. Dispatch offers based on strategy
    const candidatesToOffer =
      request.strategy === DispatchStrategy.SEQUENTIAL
        ? [eligibleCandidates[0]] // Sequential: top rank first
        : eligibleCandidates.slice(0, 5); // Batch: top 5 simultaneously

    for (const candidate of candidatesToOffer) {
      try {
        const { offerId } = await adapter.createOffer({
          dispatchRequestId: request.id,
          sourceRequestId: request.source_reference_id,
          candidate,
          attemptId,
          etaMinutes: candidate.eta_seconds ? Math.round(candidate.eta_seconds / 60) : 25,
          distanceKm: candidate.distance_meters ? Math.round((candidate.distance_meters / 1000) * 10) / 10 : 5.0,
        });

        // Notify specific provider/responder
        realtimeBus.publish(`responder.${candidate.responder_reference_id}`, 'NEW_DISPATCH_OFFER', {
          dispatch_request_id: request.id,
          offer_id: offerId,
          domain: request.dispatch_domain,
          capability: request.required_capability,
          distance_meters: candidate.distance_meters,
          eta_seconds: candidate.eta_seconds,
          score: candidate.overall_score,
        });
      } catch (err) {
        logger.error(`Failed to create offer for candidate ${candidate.id}: ${err}`);
      }
    }

    // Update Request status
    dispatchRepository.updateRequest(
      request.id,
      {
        status: DispatchRequestStatus.OFFERING,
        active_attempt_id: attemptId,
        updated_at: now,
      },
      db
    );

    realtimeBus.publish(`dispatch.request.${request.id}`, 'DISPATCH_OFFERING', {
      dispatch_request_id: request.id,
      attempt_id: attemptId,
      candidates_count: candidatesToOffer.length,
    });

    realtimeBus.publish('operations.dispatch', 'DISPATCH_OFFERING', {
      dispatch_request_id: request.id,
      attempt_number: attemptNumber,
      search_radius_km: searchRadiusKm,
    });

    return { attempt, candidates };
  }

  /**
   * Transactional atomic acceptance of an offer (GAR-016 Concurrency Guard)
   */
  async acceptOffer(params: {
    dispatchRequestId: string;
    offerId: string;
    responderReferenceId: string;
    actor: { id: string; role: string; name?: string };
    customDb?: DatabaseSync;
  }): Promise<{
    request: DispatchRequestEntity;
    assignmentId: string;
  }> {
    const db = params.customDb || getDatabase();
    const now = getCurrentUtcIsoString();

    // Execute atomic acceptance inside SQLite transaction
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const request = dispatchRepository.getRequestById(params.dispatchRequestId, db);
      if (!request) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Dispatch request ${params.dispatchRequestId} not found`);
      }

      // Check request state: must be OFFERING or AWAITING_ACCEPTANCE
      if (
        request.status !== DispatchRequestStatus.OFFERING &&
        request.status !== DispatchRequestStatus.AWAITING_ACCEPTANCE &&
        request.status !== DispatchRequestStatus.CREATED
      ) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Cannot accept offer: Dispatch request is already in status ${request.status}`
        );
      }

      // Find the candidate record
      const candidates = dispatchRepository.getCandidatesByRequest(request.id, db);
      const winningCandidate = candidates.find(
        (c) => c.responder_reference_id === params.responderReferenceId
      );

      if (!winningCandidate) {
        throw new CanonicalAppError(
          ErrorCode.RESOURCE_NOT_FOUND,
          `Candidate ${params.responderReferenceId} not found for dispatch request ${request.id}`
        );
      }

      // Verify responder presence
      const presence = locationService.getPresence(params.responderReferenceId, db);
      if (presence && (presence.status === ResponderAvailabilityStatus.ON_JOB || presence.status === ResponderAvailabilityStatus.BUSY)) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Responder ${params.responderReferenceId} is already on another active assignment`
        );
      }

      // Commit assignment to source domain (Roadside/Towing)
      const adapter = this.getAdapter(request.dispatch_domain);
      const { assignmentId } = await adapter.commitAssignment({
        dispatchRequestId: request.id,
        sourceRequestId: request.source_reference_id,
        offerId: params.offerId,
        candidate: winningCandidate,
        actor: params.actor,
      });

      // Update Dispatch Request
      dispatchRepository.updateRequest(
        request.id,
        {
          status: DispatchRequestStatus.ASSIGNED,
          assigned_responder_type: winningCandidate.responder_type,
          assigned_responder_id: winningCandidate.responder_reference_id,
          updated_at: now,
        },
        db
      );

      // Update Active Attempt
      if (request.active_attempt_id) {
        dispatchRepository.updateAttempt(
          request.active_attempt_id,
          {
            status: DispatchAttemptStatus.ACCEPTED,
            completed_at: now,
          },
          db
        );
      }

      // Transition responder presence to ON_JOB
      locationService.updatePresence(
        {
          provider_id: winningCandidate.provider_id,
          responder_type: winningCandidate.responder_type,
          responder_reference_id: winningCandidate.responder_reference_id,
          status: ResponderAvailabilityStatus.ON_JOB,
          current_job_reference: assignmentId,
        },
        db
      );

      // Create initial Customer Tracking Projection
      const currentLocation = locationService.getCurrentLocation(winningCandidate.responder_reference_id, db);
      const trackingProjectionId = generateCanonicalId('dtp');

      const etaSeconds = winningCandidate.eta_seconds ?? 1500;
      const etaArrivalAt = new Date(Date.now() + etaSeconds * 1000).toISOString();

      const trackingProjection: DispatchTrackingProjectionEntity = {
        id: trackingProjectionId,
        dispatch_request_id: request.id,
        assignment_id: assignmentId,
        assignment_domain: request.dispatch_domain,
        assignment_status: 'ASSIGNED',
        responder_display_name: params.actor.name || 'Assigned Responder',
        responder_unit_summary: `${winningCandidate.responder_type}: ${winningCandidate.responder_reference_id}`,
        latitude: currentLocation?.latitude ?? null,
        longitude: currentLocation?.longitude ?? null,
        accuracy_meters: currentLocation?.accuracy_meters ?? null,
        location_freshness: currentLocation?.freshness_state ?? LocationFreshness.UNKNOWN,
        location_captured_at: currentLocation?.captured_at ?? null,
        eta_arrival_at: etaArrivalAt,
        eta_duration_seconds: etaSeconds,
        eta_source: winningCandidate.eta_source,
        eta_calculated_at: now,
        eta_freshness: LocationFreshness.FRESH,
        tracking_access_status: TrackingAccessStatus.ACTIVE,
        is_tracking_active: 1,
        last_updated_at: now,
      };

      dispatchRepository.saveTrackingProjection(trackingProjection, db);

      db.exec('COMMIT;');

      // Publish Real-time events after commit
      realtimeBus.publish(`dispatch.request.${request.id}`, 'DISPATCH_ASSIGNED', {
        dispatch_request_id: request.id,
        assignment_id: assignmentId,
        responder_id: winningCandidate.responder_reference_id,
      });

      realtimeBus.publish(`assignment.${assignmentId}`, 'ASSIGNMENT_CREATED', trackingProjection);

      realtimeBus.publish('operations.dispatch', 'DISPATCH_ASSIGNED', {
        dispatch_request_id: request.id,
        assignment_id: assignmentId,
        provider_id: winningCandidate.provider_id,
        responder_id: winningCandidate.responder_reference_id,
      });

      return {
        request: {
          ...request,
          status: DispatchRequestStatus.ASSIGNED,
          assigned_responder_type: winningCandidate.responder_type,
          assigned_responder_id: winningCandidate.responder_reference_id,
          updated_at: now,
        },
        assignmentId,
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error(`Atomic acceptance failed for request ${params.dispatchRequestId}: ${err}`);
      throw err;
    }
  }

  /**
   * Manual dispatch with override audit logging
   */
  async manualAssign(params: {
    dispatchRequestId: string;
    candidateId: string;
    overrideReason?: string;
    actor: { id: string; role: string; name?: string };
    customDb?: DatabaseSync;
  }): Promise<{ request: DispatchRequestEntity; assignmentId: string }> {
    const db = params.customDb || getDatabase();
    const request = dispatchRepository.getRequestById(params.dispatchRequestId, db);
    if (!request) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Dispatch request not found');
    }

    const candidates = dispatchRepository.getCandidatesByRequest(request.id, db);
    const candidate = candidates.find((c) => c.id === params.candidateId);
    if (!candidate) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Candidate not found');
    }

    // If candidate was excluded or not rank 1, audit reason is required
    if (candidate.eligibility_status === 'EXCLUDED' && !params.overrideReason) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Override reason is required when manually assigning an excluded candidate'
      );
    }

    if (params.overrideReason || candidate.eligibility_status === 'EXCLUDED') {
      dispatchRepository.createManualOverride({
        id: generateCanonicalId('dmo'),
        dispatch_request_id: request.id,
        actor_id: params.actor.id,
        actor_role: params.actor.role,
        provider_id: candidate.provider_id,
        responder_reference_id: candidate.responder_reference_id,
        reason: params.overrideReason || 'Manual dispatcher override',
        override_flags_json: JSON.stringify({ original_rank: candidate.rank }),
        eligibility_snapshot_json: JSON.stringify({
          status: candidate.eligibility_status,
          reasons: candidate.exclusion_reason,
        }),
        created_at: getCurrentUtcIsoString(),
      }, db);
    }

    const adapter = this.getAdapter(request.dispatch_domain);
    const { offerId } = await adapter.createOffer({
      dispatchRequestId: request.id,
      sourceRequestId: request.source_reference_id,
      candidate,
      attemptId: request.active_attempt_id || 'manual',
    });

    return this.acceptOffer({
      dispatchRequestId: request.id,
      offerId,
      responderReferenceId: candidate.responder_reference_id,
      actor: params.actor,
      customDb: db,
    });
  }

  /**
   * Triggers reassignment when a responder fails or becomes unreachable.
   */
  async reassign(params: {
    dispatchRequestId: string;
    reason: string;
    actor: { id: string; role: string; name?: string };
    customDb?: DatabaseSync;
  }): Promise<{ request: DispatchRequestEntity; attempt: DispatchAttemptEntity }> {
    const db = params.customDb || getDatabase();
    const now = getCurrentUtcIsoString();
    const request = dispatchRepository.getRequestById(params.dispatchRequestId, db);
    if (!request) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Dispatch request not found');
    }

    // Release old responder if present
    if (request.assigned_responder_id) {
      const presence = locationService.getPresence(request.assigned_responder_id, db);
      if (presence) {
        locationService.updatePresence(
          {
            provider_id: presence.provider_id,
            responder_type: presence.responder_type,
            responder_reference_id: presence.responder_reference_id,
            status: ResponderAvailabilityStatus.AVAILABLE,
            current_job_reference: null,
          },
          db
        );
      }
    }

    // Expire old tracking projection
    const existingTracking = db.prepare(`
      SELECT * FROM dispatch_tracking_projections WHERE dispatch_request_id = ?;
    `).get(request.id) as any;

    if (existingTracking) {
      db.prepare(`
        UPDATE dispatch_tracking_projections
        SET tracking_access_status = 'REVOKED', last_updated_at = ?
        WHERE id = ?;
      `).run(now, existingTracking.id);
    }

    // Call domain adapter reassign
    const adapter = this.getAdapter(request.dispatch_domain);
    await adapter.reassign({
      dispatchRequestId: request.id,
      sourceRequestId: request.source_reference_id,
      previousAssignmentId: existingTracking?.assignment_id || 'unknown',
      reason: params.reason,
      actor: params.actor,
    });

    // Reset request and launch next attempt
    dispatchRepository.updateRequest(
      request.id,
      {
        status: DispatchRequestStatus.OFFERING,
        assigned_responder_type: null,
        assigned_responder_id: null,
        updated_at: now,
      },
      db
    );

    const prevAttempt = request.active_attempt_id
      ? dispatchRepository.getAttemptById(request.active_attempt_id, db)
      : null;
    const nextAttemptNumber = prevAttempt ? prevAttempt.attempt_number + 1 : 2;
    const nextRadiusKm = prevAttempt ? prevAttempt.search_radius_km * 1.5 : 10.0;

    const { attempt } = await this.executeDispatchAttempt(
      request,
      nextAttemptNumber,
      nextRadiusKm,
      db
    );

    realtimeBus.publish(`dispatch.request.${request.id}`, 'DISPATCH_REASSIGNED', {
      dispatch_request_id: request.id,
      reason: params.reason,
      new_attempt_id: attempt.id,
    });

    return { request, attempt };
  }

  /**
   * Customer tracking view with privacy safeguards (GAR-016 Privacy Architecture)
   */
  getTrackingView(params: {
    assignmentId: string;
    requesterUserId: string;
    requesterRole?: string;
    customDb?: DatabaseSync;
  }): DispatchTrackingProjectionEntity & { is_stale_warning?: boolean; warning_message?: string } {
    const db = params.customDb || getDatabase();
    const tracking = dispatchRepository.getTrackingProjectionByAssignment(params.assignmentId, db);
    if (!tracking) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Tracking record for assignment ${params.assignmentId} not found`);
    }

    const elevatedRoles = new Set(['PLATFORM_ADMIN', 'OPERATIONS', 'TRUST_AND_SAFETY']);
    const isElevated = Boolean(params.requesterRole && elevatedRoles.has(params.requesterRole));
    if (tracking.customer_user_id && tracking.customer_user_id !== params.requesterUserId && !isElevated) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Tracking access denied', 403);
    }

    // Check freshness: recalculate based on current wall clock
    const request = dispatchRepository.getRequestById(tracking.dispatch_request_id, db);
    if (request?.assigned_responder_id) {
      const currentLoc = locationService.getCurrentLocation(request.assigned_responder_id, db);
      if (currentLoc) {
        tracking.latitude = currentLoc.latitude;
        tracking.longitude = currentLoc.longitude;
        tracking.accuracy_meters = currentLoc.accuracy_meters;
        tracking.location_freshness = currentLoc.freshness_state;
        tracking.location_captured_at = currentLoc.captured_at;
      }
    }

    let isStaleWarning = false;
    let warningMessage: string | undefined;

    if (tracking.location_freshness === LocationFreshness.STALE) {
      isStaleWarning = true;
      warningMessage = 'Live location temporarily unavailable. The responder is still en route.';
    }

    // Privacy Guard: If tracking is REVOKED or EXPIRED, redact live coordinates
    if (tracking.tracking_access_status !== TrackingAccessStatus.ACTIVE) {
      return {
        ...tracking,
        latitude: null,
        longitude: null,
        accuracy_meters: null,
        is_stale_warning: true,
        warning_message: 'Tracking session has ended.',
      };
    }

    return {
      ...tracking,
      is_stale_warning: isStaleWarning,
      warning_message: warningMessage,
    };
  }
}

export const dispatchService = new DispatchService();
