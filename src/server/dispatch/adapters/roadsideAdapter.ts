/**
 * Garage OS — Sprint 14: Roadside Domain Dispatch Adapter (GAR-016)
 * Bridges canonical Roadside domain models with the shared Dispatch Engine.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../../database/connection';
import { generateCanonicalId } from '../../domain/id';
import { getCurrentUtcIsoString } from '../../domain/time';
import { roadsideRepository } from '../../roadside/roadsideRepository';
import {
  RoadsideProviderOfferEntity,
  RoadsideAssignmentEntity,
  ProviderOfferStatus,
  AssignmentStatus,
  RoadsideIncidentStatus,
} from '../../roadside/types';
import {
  DispatchDomain,
  DispatchDomainAdapter,
  DispatchCandidateEntity,
  DispatchPriority,
} from '../types';

export class RoadsideDispatchAdapter implements DispatchDomainAdapter {
  readonly domain = DispatchDomain.ROADSIDE;

  async loadSourceRequest(sourceId: string, customDb?: DatabaseSync) {
    const db = customDb || getDatabase();
    // Check if sourceId is assistance request or incident
    let req = roadsideRepository.getAssistanceRequestById(sourceId);
    let incidentId = req ? req.incident_id : sourceId;
    let incident = roadsideRepository.getIncidentById(incidentId);

    if (!incident) {
      throw new Error(`Roadside incident or request not found: ${sourceId}`);
    }

    let loc = incident.current_location_id
      ? roadsideRepository.getLocationById(incident.current_location_id)
      : roadsideRepository.getActiveLocation(incident.id);

    const priorityMap: Record<string, DispatchPriority> = {
      CRITICAL_HIGHWAY: DispatchPriority.SAFETY_CRITICAL,
      URGENT_UNSAFE: DispatchPriority.SAFETY_CRITICAL,
      ELEVATED: DispatchPriority.PRIORITY,
      ROUTINE: DispatchPriority.NORMAL,
      SEVERE: DispatchPriority.SAFETY_CRITICAL,
    };

    return {
      id: req ? req.id : incident.id,
      pickupLatitude: loc ? loc.latitude : 0,
      pickupLongitude: loc ? loc.longitude : 0,
      destinationLatitude: null,
      destinationLongitude: null,
      vehicleId: incident.vehicle_id,
      requiredCapability: req ? req.requested_assistance_type : 'ROADSIDE_ASSISTANCE',
      priority: priorityMap[incident.severity] || DispatchPriority.NORMAL,
      requestingUserId: incident.reported_by_user_id || 'system',
      status: incident.status,
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
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min TTL
    const offerId = generateCanonicalId('rso');

    // Retrieve assistance request or incident to link
    let req = roadsideRepository.getAssistanceRequestById(params.sourceRequestId);
    const incidentId = req ? req.incident_id : params.sourceRequestId;
    if (!req) {
      const activeReq = roadsideRepository.getActiveAssistanceRequest(incidentId);
      if (activeReq) {
        req = activeReq;
      } else {
        req = roadsideRepository.createAssistanceRequest({
          id: generateCanonicalId('rsr'),
          incident_id: incidentId,
          requested_assistance_type: 'ROADSIDE_ASSISTANCE',
          dispatch_mode: 'AUTOMATIC_BROADCAST',
          search_radius_km: 35.0,
          created_at: now,
          status: 'BROADCASTING' as any,
        } as any);
      }
    }
    const requestId = req.id;

    const offer: RoadsideProviderOfferEntity = {
      id: offerId,
      request_id: requestId,
      incident_id: incidentId,
      provider_id: params.candidate.provider_id,
      status: ProviderOfferStatus.OFFERED,
      offered_at: now,
      expires_at: expiresAt,
      estimated_arrival_minutes: params.etaMinutes || (params.candidate.eta_seconds ? Math.round(params.candidate.eta_seconds / 60) : 25),
      callout_charge_minor: 350000, // 3500 KES default callout
      currency: 'KES',
      metadata_json: JSON.stringify({
        dispatch_request_id: params.dispatchRequestId,
        dispatch_attempt_id: params.attemptId,
        responder_reference_id: params.candidate.responder_reference_id,
        responder_type: params.candidate.responder_type,
        overall_score: params.candidate.overall_score,
      }),
    };

    roadsideRepository.createProviderOffer(offer);
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
    const req = roadsideRepository.getAssistanceRequestById(params.sourceRequestId);
    const incidentId = req ? req.incident_id : params.sourceRequestId;
    const requestId = req ? req.id : params.sourceRequestId;

    const assignmentId = generateCanonicalId('rsa');
    const etaMinutes = params.candidate.eta_seconds
      ? Math.round(params.candidate.eta_seconds / 60)
      : 25;

    const assignment: RoadsideAssignmentEntity = {
      id: assignmentId,
      incident_id: incidentId,
      request_id: requestId,
      offer_id: params.offerId,
      provider_id: params.candidate.provider_id,
      assigned_technician_id: params.candidate.responder_type === 'PROVIDER_STAFF' ? params.candidate.responder_reference_id : null,
      assigned_technician_name: params.actor.name || 'Assigned Technician',
      status: AssignmentStatus.ASSIGNED,
      eta_minutes: etaMinutes,
      created_at: now,
      updated_at: now,
    };

    roadsideRepository.createAssignment(assignment);

    // Update Offer to ACCEPTED
    roadsideRepository.updateProviderOffer(params.offerId, {
      status: ProviderOfferStatus.ACCEPTED,
      responded_at: now,
    });

    // Update Incident
    roadsideRepository.updateIncident(incidentId, {
      status: RoadsideIncidentStatus.DISPATCHED,
      active_assignment_id: assignmentId,
    });

    // Update Request
    if (req) {
      roadsideRepository.updateAssistanceRequest(req.id, {
        fulfilled_assignment_id: assignmentId,
      });
    }

    return { assignmentId, status: AssignmentStatus.ASSIGNED };
  }

  async cancelOffers(sourceRequestId: string): Promise<void> {
    const req = roadsideRepository.getAssistanceRequestById(sourceRequestId);
    if (req) {
      roadsideRepository.withdrawPendingOffers(req.id);
    }
  }

  async reassign(params: {
    dispatchRequestId: string;
    sourceRequestId: string;
    previousAssignmentId: string;
    reason: string;
    actor: { id: string; role: string; name?: string };
  }): Promise<void> {
    const now = getCurrentUtcIsoString();
    roadsideRepository.updateAssignment(params.previousAssignmentId, {
      status: AssignmentStatus.CANCELLED,
      cancelled_at: now,
    });

    const req = roadsideRepository.getAssistanceRequestById(params.sourceRequestId);
    const incidentId = req ? req.incident_id : params.sourceRequestId;

    roadsideRepository.updateIncident(incidentId, {
      status: RoadsideIncidentStatus.REQUESTED,
      active_assignment_id: null,
    });
  }
}

export const roadsideDispatchAdapter = new RoadsideDispatchAdapter();
