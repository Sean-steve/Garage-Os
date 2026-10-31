/**
 * Garage OS — Sprint 14: Towing Domain Dispatch Adapter (GAR-016)
 * Bridges canonical Towing domain models with the shared Dispatch Engine.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../../database/connection';
import { generateCanonicalId } from '../../domain/id';
import { getCurrentUtcIsoString } from '../../domain/time';
import { towingRepository } from '../../towing/towingRepository';
import {
  TowOfferStatus,
  TowAssignmentStatus,
  TowRequestStatus,
  TowCompatibilityStatus,
  TowProviderOfferEntity,
  TowAssignmentEntity,
} from '../../towing/types';
import {
  DispatchDomain,
  DispatchDomainAdapter,
  DispatchCandidateEntity,
  DispatchPriority,
} from '../types';

export class TowingDispatchAdapter implements DispatchDomainAdapter {
  readonly domain = DispatchDomain.TOWING;

  async loadSourceRequest(sourceId: string, customDb?: DatabaseSync) {
    const req = towingRepository.getTowRequestById(sourceId);
    if (!req) {
      throw new Error(`Tow request not found: ${sourceId}`);
    }

    const pickup = towingRepository.getPickupLocationByRequestId(sourceId);
    if (!pickup) {
      throw new Error(`Tow pickup location not found for request: ${sourceId}`);
    }

    const destination = towingRepository.getDestinationByRequestId(sourceId);

    const priorityMap: Record<string, DispatchPriority> = {
      SAFETY_CRITICAL: DispatchPriority.SAFETY_CRITICAL,
      URGENT: DispatchPriority.PRIORITY,
      NORMAL: DispatchPriority.NORMAL,
      SCHEDULED: DispatchPriority.NORMAL,
    };

    return {
      id: req.id,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      destinationLatitude: destination?.latitude || null,
      destinationLongitude: destination?.longitude || null,
      vehicleId: req.vehicle_id,
      requiredCapability: req.required_capability_profile_id || 'FLATBED_TOW',
      priority: DispatchPriority.NORMAL,
      requestingUserId: req.requesting_user_id,
      status: req.status,
    };
  }

  async createOffer(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    candidate: DispatchCandidateEntity;
    attemptId: string;
    etaMinutes?: number;
    distanceKm?: number;
  }): Promise<{ offerId: string }> {
    const now = getCurrentUtcIsoString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const offerId = generateCanonicalId('tpo');

    if (params.candidate.responder_type !== 'RECOVERY_UNIT') {
      throw new Error(
        `Towing dispatch candidate ${params.candidate.id} is not a recovery unit`
      );
    }

    const db = getDatabase();
    const provider = db
      .prepare('SELECT currency FROM service_providers WHERE id = ? LIMIT 1')
      .get(params.candidate.provider_id) as { currency?: string | null } | undefined;

    const offer: TowProviderOfferEntity = {
      id: offerId,
      tow_request_id: params.sourceRequestId,
      provider_id: params.candidate.provider_id,
      recovery_unit_id: params.candidate.responder_reference_id,
      status: TowOfferStatus.OFFERED,
      offered_at: now,
      expires_at: expiresAt,
      distance_km:
        params.distanceKm ??
        (params.candidate.distance_meters != null
          ? Math.round((params.candidate.distance_meters / 1000) * 10) / 10
          : null),
      compatibility_status: TowCompatibilityStatus.CONFIRMED,
      // Sprint 14 dispatch/routing never manufactures a tow price. A quote/rate policy
      // must provide an authoritative estimate before a monetary value is exposed.
      estimated_price_minor: null,
      currency: provider?.currency || 'KES',
      created_at: now,
    };

    towingRepository.createOffer(offer);
    return { offerId };
  }

  async commitAssignment(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    offerId: string;
    candidate: DispatchCandidateEntity;
    actor: { id: string; role: string; name?: string };
  }): Promise<{ assignmentId: string; status: string }> {
    const now = getCurrentUtcIsoString();
    const assignmentId = generateCanonicalId('ta');

    if (params.candidate.responder_type !== 'RECOVERY_UNIT') {
      throw new Error(
        `Cannot commit towing assignment for non-recovery responder ${params.candidate.responder_reference_id}`
      );
    }

    const assignment: TowAssignmentEntity = {
      id: assignmentId,
      tow_request_id: params.sourceRequestId,
      provider_id: params.candidate.provider_id,
      recovery_unit_id: params.candidate.responder_reference_id,
      operator_staff_id: params.actor.id,
      operator_name: params.actor.name || 'Tow Operator',
      status: TowAssignmentStatus.ASSIGNED,
      assigned_at: now,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    };

    towingRepository.createAssignment(assignment);

    // Update Offer
    towingRepository.updateOffer(params.offerId, {
      status: TowOfferStatus.ACCEPTED,
      responded_at: now,
    });

    // Withdraw other offers
    towingRepository.cancelOtherPendingOffers(params.sourceRequestId, params.offerId);

    // Update Tow Request
    towingRepository.updateTowRequest(params.sourceRequestId, {
      status: TowRequestStatus.ASSIGNED,
      assigned_provider_id: params.candidate.provider_id,
      active_assignment_id: assignmentId,
      assigned_at: now,
      updated_at: now,
    });

    return { assignmentId, status: TowAssignmentStatus.ASSIGNED };
  }

  async cancelOffers(sourceRequestId: string): Promise<void> {
    towingRepository.cancelOtherPendingOffers(sourceRequestId, undefined);
  }

  async reassign(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    previousAssignmentId: string;
    reason: string;
    actor: { id: string; role: string; name?: string };
  }): Promise<void> {
    const now = getCurrentUtcIsoString();
    towingRepository.updateAssignment(params.previousAssignmentId, {
      status: TowAssignmentStatus.CANCELLED,
      updated_at: now,
    });

    towingRepository.updateTowRequest(params.sourceRequestId, {
      status: TowRequestStatus.PENDING_DISPATCH,
      active_assignment_id: null,
      updated_at: now,
    });
  }
}

export const towingDispatchAdapter = new TowingDispatchAdapter();
