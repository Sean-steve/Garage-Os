/**
 * GAR-014: Roadside Assistance Architecture
 * Domain Service Layer
 */

import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { eventBus } from '../events/eventBus';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { roadsideRepository } from './roadsideRepository';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { getDatabase } from '../database/connection';
import { haversineDistanceKm, isValidCoordinate } from '../providers/geoUtils';
import {
  RoadsideIncidentEntity,
  RoadsideLocationEntity,
  RoadsideTriageRecordEntity,
  RoadsideTriageAnswerEntity,
  RoadsideAssistanceRequestEntity,
  RoadsideProviderOfferEntity,
  RoadsideAssignmentEntity,
  RoadsideInterventionEntity,
  RoadsideInterventionActionEntity,
  RoadsideIncidentEvidenceEntity,
  RoadsideCancellationEntity,
  RoadsideTowHandoffEntity,
  RoadsideIncidentStatus,
  IncidentSeverity,
  IncidentType,
  DrivabilityState,
  OccupantSafetyState,
  AssistanceType,
  LocationSource,
  AssistanceRequestStatus,
  DispatchMode,
  ProviderOfferStatus,
  AssignmentStatus,
  InterventionResult,
  InterventionActionType,
  EvidenceType,
  TowDestinationType,
  FullRoadsideIncidentAggregate,
} from './types';
import { RoadsideTriageEngine, TriageInputAnswers } from './triageEngine';

export interface RoadsideActorContext {
  actor_id?: string;
  user_id?: string;
  id?: string;
  name?: string;
  phone?: string;
  roles?: string[];
  organization_id?: string;
  provider_id?: string;
  [key: string]: any;
}

export function getActorId(actor?: RoadsideActorContext): string {
  return actor?.actor_id || actor?.user_id || actor?.id || 'usr_system';
}

export function getActorName(actor?: RoadsideActorContext): string {
  return actor?.name || actor?.profile?.display_name || 'Driver / Operator';
}

export class RoadsideService {
  /**
   * Helper / alias for creating an incident (used across integration tests and caller contracts)
   */
  async createIncident(
    actorOrParams: any,
    maybeParams?: any
  ): Promise<any> {
    let actor: RoadsideActorContext;
    let params: any;

    if (maybeParams !== undefined) {
      actor = actorOrParams;
      params = maybeParams;
    } else {
      params = actorOrParams;
      actor = {
        id: params.reported_by_user_id || 'usr_driver',
        name: params.reported_by_name || 'Driver / Operator',
        roles: ['DRIVER'],
      };
    }

    const locationObj = params.location || params.current_location || {
      latitude: -1.2921,
      longitude: 36.8219,
      address_line: 'Nairobi',
    };

    const incidentType = params.incident_type || IncidentType.OTHER_BREAKDOWN;

    const aggregate = await this.reportIncident(
      {
        vehicle_id: params.vehicle_id,
        incident_type: incidentType,
        description: params.description,
        reported_by_phone: params.reported_by_phone,
        location: {
          latitude: locationObj.latitude ?? -1.2921,
          longitude: locationObj.longitude ?? 36.8219,
          accuracy_meters: locationObj.accuracy_meters,
          address_line: locationObj.address || locationObj.address_line || locationObj.address_summary || 'Unknown location',
          road_or_highway: locationObj.road_or_highway || locationObj.road_name,
          landmark_description: locationObj.landmark_description || locationObj.landmark,
          direction_of_travel: locationObj.direction_of_travel,
          is_dangerous_location: locationObj.is_dangerous_location,
          source: locationObj.source || locationObj.source_type || LocationSource.DEVICE_GPS,
        },
        initial_answers: params.triage,
      },
      actor
    );

    return Object.assign({}, aggregate.incident, aggregate);
  }

  /**
   * 1. Report a new roadside breakdown incident
   */
  async reportIncident(
    params: {
      vehicle_id: string;
      incident_type: IncidentType;
      description?: string;
      reported_by_phone?: string;
      location: {
        latitude: number;
        longitude: number;
        accuracy_meters?: number;
        address_line?: string;
        road_or_highway?: string;
        landmark_description?: string;
        direction_of_travel?: string;
        is_dangerous_location?: boolean;
        source?: LocationSource;
      };
      initial_answers?: TriageInputAnswers;
    },
    actor?: RoadsideActorContext
  ): Promise<FullRoadsideIncidentAggregate> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    // Validate vehicle exists
    const vehicle = vehicleRepository.getVehicleById(params.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Vehicle ${params.vehicle_id} not found`);
    }

    // Validate coordinates
    if (!isValidCoordinate(params.location.latitude, params.location.longitude)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid GPS coordinates provided');
    }

    const now = getCurrentUtcIsoString();
    const incidentId = generateCanonicalId('inc');
    const incidentNumber = roadsideRepository.getNextIncidentSequenceNumber();
    const locationId = generateCanonicalId('rsl');

    // 1. Initial Evaluation (if initial answers provided)
    let initialSeverity = IncidentSeverity.ROUTINE;
    let initialDrivability = DrivabilityState.UNKNOWN;
    let initialSafetyState = OccupantSafetyState.SAFE;
    let safetyEscalation = false;
    let safetyNotes: string | null = null;

    if (params.initial_answers) {
      const triageResult = RoadsideTriageEngine.evaluate(
        params.incident_type,
        {
          make: vehicle.make,
          model: vehicle.model,
          fuel_type: vehicle.fuel_type,
          drive_type: vehicle.drive_type,
          transmission: vehicle.transmission,
        },
        params.initial_answers
      );
      initialSeverity = triageResult.severity;
      initialDrivability = triageResult.initial_drivability;
      initialSafetyState = triageResult.occupant_safety_state;
      safetyEscalation = triageResult.safety_escalation_required;
      safetyNotes = triageResult.guidance_notes;
    }

    // 2. Create Incident record
    const incident: RoadsideIncidentEntity = {
      id: incidentId,
      incident_number: incidentNumber,
      vehicle_id: params.vehicle_id,
      organization_id: actor?.organization_id || null,
      reported_by_user_id: actorId,
      reported_by_name: actorName,
      reported_by_phone: params.reported_by_phone || actor?.phone || null,
      incident_type: params.incident_type,
      severity: initialSeverity,
      status: RoadsideIncidentStatus.DRAFT,
      initial_drivability: initialDrivability,
      occupant_safety_state: initialSafetyState,
      description: params.description || null,
      safety_escalation_required: safetyEscalation,
      safety_escalation_notes: safetyNotes,
      current_location_id: locationId,
      active_assistance_request_id: null,
      active_assignment_id: null,
      resolved_at: null,
      cancelled_at: null,
      closed_at: null,
      created_at: now,
      updated_at: now,
    };
    roadsideRepository.createIncident(incident);

    // 3. Create Location record
    const location: RoadsideLocationEntity = {
      id: locationId,
      incident_id: incidentId,
      source: params.location.source || LocationSource.DEVICE_GPS,
      latitude: params.location.latitude,
      longitude: params.location.longitude,
      accuracy_meters: params.location.accuracy_meters || null,
      address_line: params.location.address_line || null,
      road_or_highway: params.location.road_or_highway || null,
      landmark_description: params.location.landmark_description || null,
      direction_of_travel: params.location.direction_of_travel || null,
      is_dangerous_location: params.location.is_dangerous_location || false,
      is_active: true,
      recorded_at: now,
      created_at: now,
    };
    roadsideRepository.createLocation(location);

    // 4. Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: incidentId,
      activity_type: 'INCIDENT_REPORTED',
      actor_id: actorId,
      actor_type: 'USER',
      actor_name: actorName,
      title: `Roadside incident ${incidentNumber} reported`,
      details: `Type: ${params.incident_type}, Severity: ${initialSeverity}`,
      created_at: now,
    });

    // 5. Emit Domain Event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.incident.reported',
        correlation_id: incidentId,
        subject_ids: {
          vehicle: params.vehicle_id,
          incident: incidentId,
        },
        actor_id: actorId,
        payload: {
          incident_id: incidentId,
          incident_number: incidentNumber,
          vehicle_id: params.vehicle_id,
          incident_type: params.incident_type,
          severity: initialSeverity,
          latitude: params.location.latitude,
          longitude: params.location.longitude,
          reported_by_name: actorName,
        },
      })
    );

    return this.getIncidentDetails(incidentId);
  }

  /**
   * 2. Conduct Safety and Breakdown Triage
   */
  async conductTriage(
    incidentId: string,
    answers: TriageInputAnswers,
    actor?: RoadsideActorContext
  ): Promise<FullRoadsideIncidentAggregate> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    if (
      incident.status === RoadsideIncidentStatus.RESOLVED ||
      incident.status === RoadsideIncidentStatus.CANCELLED ||
      incident.status === RoadsideIncidentStatus.CLOSED
    ) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot triage incident in status ${incident.status}`
      );
    }

    const vehicle = vehicleRepository.getVehicleById(incident.vehicle_id);
    const vehicleContext = vehicle
      ? {
          make: vehicle.make,
          model: vehicle.model,
          fuel_type: vehicle.fuel_type,
          drive_type: vehicle.drive_type,
          transmission: vehicle.transmission,
        }
      : {};

    // Run deterministic triage evaluation
    const evaluation = RoadsideTriageEngine.evaluate(incident.incident_type, vehicleContext, answers);
    const now = getCurrentUtcIsoString();
    const triageRecordId = generateCanonicalId('rtr');

    // Save Triage Record
    const triageRecord: RoadsideTriageRecordEntity = {
      id: triageRecordId,
      incident_id: incidentId,
      engine_version: evaluation.engine_version,
      triage_result: evaluation.triage_result,
      recommended_assistance_type: evaluation.recommended_assistance_type,
      safety_escalation_required: evaluation.safety_escalation_required,
      tow_required: evaluation.tow_required,
      guidance_notes: evaluation.guidance_notes,
      conducted_by_user_id: actorId,
      conducted_at: now,
      metadata_json: JSON.stringify({
        safety_instructions: evaluation.safety_instructions,
        risk_factors: evaluation.risk_factors,
      }),
    };
    roadsideRepository.createTriageRecord(triageRecord);

    // Save Triage Answers
    for (const [key, val] of Object.entries(answers)) {
      if (val !== undefined && val !== null) {
        roadsideRepository.createTriageAnswer({
          id: generateCanonicalId('rta'),
          triage_record_id: triageRecordId,
          question_key: key,
          answer_value: String(val),
          risk_flag: val === true && (key.includes('unsafe') || key.includes('danger') || key.includes('injur') || key.includes('fire')),
          created_at: now,
        });
      }
    }

    // Update Incident
    const newStatus =
      incident.status === RoadsideIncidentStatus.DRAFT ? RoadsideIncidentStatus.TRIAGED : incident.status;

    roadsideRepository.updateIncident(incidentId, {
      severity: evaluation.severity,
      initial_drivability: evaluation.initial_drivability,
      occupant_safety_state: evaluation.occupant_safety_state,
      safety_escalation_required: evaluation.safety_escalation_required,
      safety_escalation_notes: evaluation.guidance_notes,
      status: newStatus,
      updated_at: now,
    });

    // Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: incidentId,
      activity_type: 'TRIAGE_CONDUCTED',
      actor_id: actorId,
      actor_type: 'USER',
      actor_name: actorName,
      title: 'Triage completed',
      details: evaluation.triage_result,
      created_at: now,
    });

    // Emit event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.incident.triaged',
        correlation_id: incidentId,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: incidentId,
        },
        actor_id: actorId,
        payload: {
          incident_id: incidentId,
          triage_record_id: triageRecordId,
          recommended_assistance: evaluation.recommended_assistance_type,
          tow_required: evaluation.tow_required,
          safety_escalation_required: evaluation.safety_escalation_required,
        },
      })
    );

    return this.getIncidentDetails(incidentId);
  }

  /**
   * 3. Update Incident Location
   */
  async updateLocation(
    incidentId: string,
    locationData: {
      latitude: number;
      longitude: number;
      accuracy_meters?: number;
      address_line?: string;
      road_or_highway?: string;
      landmark_description?: string;
      direction_of_travel?: string;
      is_dangerous_location?: boolean;
      source?: LocationSource;
    },
    actor?: RoadsideActorContext
  ): Promise<RoadsideLocationEntity> {
    const actorId = getActorId(actor);
    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    if (!isValidCoordinate(locationData.latitude, locationData.longitude)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid GPS coordinates');
    }

    const now = getCurrentUtcIsoString();
    const locationId = generateCanonicalId('rsl');

    const location: RoadsideLocationEntity = {
      id: locationId,
      incident_id: incidentId,
      source: locationData.source || LocationSource.DEVICE_GPS,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      accuracy_meters: locationData.accuracy_meters || null,
      address_line: locationData.address_line || null,
      road_or_highway: locationData.road_or_highway || null,
      landmark_description: locationData.landmark_description || null,
      direction_of_travel: locationData.direction_of_travel || null,
      is_dangerous_location: locationData.is_dangerous_location || false,
      is_active: true,
      recorded_at: now,
      created_at: now,
    };

    roadsideRepository.createLocation(location);
    roadsideRepository.updateIncident(incidentId, {
      current_location_id: locationId,
      updated_at: now,
    });

    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: incidentId,
      activity_type: 'LOCATION_UPDATED',
      actor_id: actorId,
      actor_type: 'USER',
      actor_name: getActorName(actor),
      title: 'Incident location updated',
      details: `${locationData.latitude.toFixed(5)}, ${locationData.longitude.toFixed(5)} ${locationData.address_line ? `(${locationData.address_line})` : ''}`,
      created_at: now,
    });

    return location;
  }

  /**
   * 4. Request Assistance / Broadcast to Service Provider Network
   */
  async requestAssistance(
    incidentId: string,
    params?: {
      requested_assistance_type?: AssistanceType;
      search_radius_km?: number;
      dispatch_mode?: DispatchMode;
      preferred_provider_id?: string;
    },
    actor?: RoadsideActorContext
  ): Promise<{ request: RoadsideAssistanceRequestEntity; offers: RoadsideProviderOfferEntity[] }> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    if (
      incident.status !== RoadsideIncidentStatus.DRAFT &&
      incident.status !== RoadsideIncidentStatus.TRIAGED &&
      incident.status !== RoadsideIncidentStatus.REQUESTED
    ) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot request assistance for incident in status ${incident.status}`
      );
    }

    const location = roadsideRepository.getActiveLocation(incidentId);
    if (!location) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_LOCATION_REQUIRED, 'Incident does not have an active location');
    }

    const triage = roadsideRepository.getLatestTriageRecord(incidentId);
    const assistanceType =
      params?.requested_assistance_type ||
      triage?.recommended_assistance_type ||
      AssistanceType.ROADSIDE_MOBILE_REPAIR;

    const radiusKm = params?.search_radius_km || 35.0;
    const now = getCurrentUtcIsoString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min expiry for response window

    // Create Assistance Request
    const requestId = generateCanonicalId('rsr');
    const assistanceRequest: RoadsideAssistanceRequestEntity = {
      id: requestId,
      incident_id: incidentId,
      requested_assistance_type: assistanceType,
      status: AssistanceRequestStatus.BROADCASTING,
      dispatch_mode: params?.dispatch_mode || DispatchMode.AUTOMATIC_BROADCAST,
      search_radius_km: radiusKm,
      created_at: now,
      expires_at: expiresAt,
      fulfilled_assignment_id: null,
      metadata_json: null,
    };
    roadsideRepository.createAssistanceRequest(assistanceRequest);

    // Find verified providers in database to broadcast offer
    const db = getDatabase();
    let eligibleProviders: any[] = [];

    if (params?.preferred_provider_id) {
      eligibleProviders = db
        .prepare(`
          SELECT sp.id, sp.name, sp.currency, sp.callout_fee, pl.latitude, pl.longitude
          FROM service_providers sp
          LEFT JOIN provider_locations pl ON pl.provider_id = sp.id
          WHERE sp.id = ?
        `)
        .all(params.preferred_provider_id) as any[];
    } else {
      // Find providers with roadside or repair capabilities
      eligibleProviders = db
        .prepare(`
          SELECT sp.id, sp.name, sp.currency, sp.callout_fee, pl.latitude, pl.longitude
          FROM service_providers sp
          LEFT JOIN provider_locations pl ON pl.provider_id = sp.id
          WHERE sp.verification_status = 'VERIFIED' OR sp.status = 'ACTIVE'
          LIMIT 20
        `)
        .all() as any[];

      // Fallback: any provider if none explicitly verified
      if (eligibleProviders.length === 0) {
        eligibleProviders = db
          .prepare(`
            SELECT sp.id, sp.name, sp.currency, sp.callout_fee, pl.latitude, pl.longitude
            FROM service_providers sp
            LEFT JOIN provider_locations pl ON pl.provider_id = sp.id
            LIMIT 10
          `)
          .all() as any[];
      }
    }

    const offers: RoadsideProviderOfferEntity[] = [];

    for (const provider of eligibleProviders) {
      let distanceKm = 10.0;
      if (provider.latitude && provider.longitude) {
        distanceKm = haversineDistanceKm(location.latitude, location.longitude, provider.latitude, provider.longitude);
      }

      // If within radius or fallback
      if (distanceKm <= radiusKm || eligibleProviders.length <= 2) {
        const etaMinutes = Math.max(15, Math.round(distanceKm * 2.5) + 10);
        const calloutFeeMinor = 350000; // 3,500 KES standard callout

        const offer: RoadsideProviderOfferEntity = {
          id: generateCanonicalId('rpo'),
          request_id: requestId,
          incident_id: incidentId,
          provider_id: provider.id,
          provider_branch_id: null,
          status: ProviderOfferStatus.OFFERED,
          offered_at: now,
          expires_at: expiresAt,
          responded_at: null,
          decline_reason: null,
          estimated_arrival_minutes: etaMinutes,
          callout_charge_minor: calloutFeeMinor,
          currency: 'KES',
          metadata_json: JSON.stringify({ distance_km: Number(distanceKm.toFixed(1)) }),
        };

        roadsideRepository.createProviderOffer(offer);
        offers.push(offer);
      }
    }

    // Update Incident Status
    roadsideRepository.updateIncident(incidentId, {
      status: RoadsideIncidentStatus.REQUESTED,
      active_assistance_request_id: requestId,
      updated_at: now,
    });

    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: incidentId,
      activity_type: 'ASSISTANCE_REQUESTED',
      actor_id: actorId,
      actor_type: 'USER',
      actor_name: actorName,
      title: 'Assistance requested and broadcast to network',
      details: `Type: ${assistanceType}, Radius: ${radiusKm}km, Broadcasted to ${offers.length} provider(s)`,
      created_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.assistance.requested',
        correlation_id: incidentId,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: incidentId,
        },
        actor_id: actorId,
        payload: {
          incident_id: incidentId,
          request_id: requestId,
          assistance_type: assistanceType,
          offers_count: offers.length,
        },
      })
    );

    return { request: assistanceRequest, offers };
  }

  /**
   * 5. Provider Responds to Offer (Accept or Decline)
   */
  async respondToOffer(
    offerId: string,
    accept: boolean,
    params?: {
      decline_reason?: string;
      eta_minutes?: number;
      callout_charge_minor?: number;
      assigned_technician_id?: string;
      assigned_technician_name?: string;
      assigned_technician_phone?: string;
      assigned_vehicle_reg?: string;
    },
    actor?: RoadsideActorContext
  ): Promise<{ offer: RoadsideProviderOfferEntity; assignment?: RoadsideAssignmentEntity }> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const offer = roadsideRepository.getProviderOfferById(offerId);
    if (!offer) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_PROVIDER_OFFER_NOT_FOUND, `Offer ${offerId} not found`);
    }

    if (offer.status !== ProviderOfferStatus.OFFERED) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Offer ${offerId} has already been ${offer.status.toLowerCase()}`
      );
    }

    const incident = roadsideRepository.getIncidentById(offer.incident_id);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${offer.incident_id} not found`);
    }

    const now = getCurrentUtcIsoString();

    // If declining offer
    if (!accept) {
      const updatedOffer = roadsideRepository.updateProviderOffer(offerId, {
        status: ProviderOfferStatus.DECLINED,
        decline_reason: params?.decline_reason || 'Provider unavailable',
        responded_at: now,
      })!;

      roadsideRepository.logActivity({
        id: generateCanonicalId('act'),
        incident_id: offer.incident_id,
        activity_type: 'OFFER_DECLINED',
        actor_id: actorId,
        actor_type: 'PROVIDER',
        actor_name: actorName,
        title: 'Provider declined dispatch offer',
        details: params?.decline_reason || 'Provider unavailable',
        created_at: now,
      });

      return { offer: updatedOffer };
    }

    // --- ACCEPTING OFFER ---
    // Check if incident already has an active assignment (Concurrency check)
    const existingActiveAssignment = roadsideRepository.getActiveAssignment(offer.incident_id);
    if (existingActiveAssignment) {
      // Someone else already accepted and dispatched
      roadsideRepository.updateProviderOffer(offerId, {
        status: ProviderOfferStatus.EXPIRED,
        responded_at: now,
        decline_reason: 'Incident already claimed by another provider',
      });
      throw new CanonicalAppError(
        ErrorCode.ROADSIDE_ASSIGNMENT_EXISTS,
        'Incident has already been claimed by another provider'
      );
    }

    // Update Offer
    const updatedOffer = roadsideRepository.updateProviderOffer(offerId, {
      status: ProviderOfferStatus.ACCEPTED,
      responded_at: now,
      estimated_arrival_minutes: params?.eta_minutes || offer.estimated_arrival_minutes || 25,
      callout_charge_minor: params?.callout_charge_minor || offer.callout_charge_minor,
    })!;

    // Create Assignment
    const assignmentId = generateCanonicalId('rsa');
    const assignment: RoadsideAssignmentEntity = {
      id: assignmentId,
      incident_id: offer.incident_id,
      request_id: offer.request_id,
      offer_id: offerId,
      provider_id: offer.provider_id,
      provider_branch_id: offer.provider_branch_id,
      assigned_technician_id: params?.assigned_technician_id || null,
      assigned_technician_name: params?.assigned_technician_name || 'Mobile Response Specialist',
      assigned_technician_phone: params?.assigned_technician_phone || null,
      assigned_vehicle_reg: params?.assigned_vehicle_reg || null,
      status: AssignmentStatus.ASSIGNED,
      eta_minutes: params?.eta_minutes || offer.estimated_arrival_minutes || 25,
      en_route_at: null,
      arrived_at: null,
      in_progress_at: null,
      completed_at: null,
      cancelled_at: null,
      last_known_latitude: null,
      last_known_longitude: null,
      last_location_updated_at: null,
      created_at: now,
      updated_at: now,
    };
    roadsideRepository.createAssignment(assignment);

    // Update Assistance Request
    roadsideRepository.updateAssistanceRequest(offer.request_id, {
      status: AssistanceRequestStatus.MATCHED,
      fulfilled_assignment_id: assignmentId,
    });

    // Withdraw all other competing offers
    roadsideRepository.withdrawPendingOffers(offer.request_id, offerId);

    // Update Incident Status to DISPATCHED
    roadsideRepository.updateIncident(offer.incident_id, {
      status: RoadsideIncidentStatus.DISPATCHED,
      active_assignment_id: assignmentId,
      updated_at: now,
    });

    // Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: offer.incident_id,
      activity_type: 'PROVIDER_ASSIGNED',
      actor_id: actorId,
      actor_type: 'PROVIDER',
      actor_name: actorName,
      title: 'Roadside provider dispatched',
      details: `Provider ID: ${offer.provider_id}, ETA: ${assignment.eta_minutes} mins`,
      created_at: now,
    });

    // Emit event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.assigned',
        correlation_id: offer.incident_id,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: offer.incident_id,
          provider: offer.provider_id,
        },
        actor_id: actorId,
        payload: {
          incident_id: offer.incident_id,
          assignment_id: assignmentId,
          provider_id: offer.provider_id,
          eta_minutes: assignment.eta_minutes,
        },
      })
    );

    return { offer: updatedOffer, assignment };
  }

  /**
   * 6. Update Assignment Status & Real-time Location Tracking
   */
  async updateAssignmentStatus(
    assignmentId: string,
    newStatus: AssignmentStatus,
    data?: {
      latitude?: number;
      longitude?: number;
      eta_minutes?: number;
      assigned_technician_name?: string;
      assigned_technician_phone?: string;
      assigned_vehicle_reg?: string;
    },
    actor?: RoadsideActorContext
  ): Promise<RoadsideAssignmentEntity> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const assignment = roadsideRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_ASSIGNMENT_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }

    const incident = roadsideRepository.getIncidentById(assignment.incident_id);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${assignment.incident_id} not found`);
    }

    // Validate monotonic transition
    const validTransitions: Record<AssignmentStatus, AssignmentStatus[]> = {
      [AssignmentStatus.ASSIGNED]: [AssignmentStatus.ACKNOWLEDGED, AssignmentStatus.EN_ROUTE, AssignmentStatus.CANCELLED],
      [AssignmentStatus.ACKNOWLEDGED]: [AssignmentStatus.EN_ROUTE, AssignmentStatus.CANCELLED],
      [AssignmentStatus.EN_ROUTE]: [AssignmentStatus.ARRIVED, AssignmentStatus.ON_SITE, AssignmentStatus.CANCELLED],
      [AssignmentStatus.ARRIVED]: [AssignmentStatus.ON_SITE, AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED],
      [AssignmentStatus.ON_SITE]: [AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED],
      [AssignmentStatus.IN_PROGRESS]: [AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED],
      [AssignmentStatus.COMPLETED]: [],
      [AssignmentStatus.CANCELLED]: [],
    };

    if (assignment.status !== newStatus && !validTransitions[assignment.status]?.includes(newStatus)) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot transition assignment from ${assignment.status} to ${newStatus}`
      );
    }

    const now = getCurrentUtcIsoString();
    const updates: Partial<RoadsideAssignmentEntity> = {
      status: newStatus,
      updated_at: now,
    };

    if (data?.eta_minutes !== undefined) updates.eta_minutes = data.eta_minutes;
    if (data?.assigned_technician_name) updates.assigned_technician_name = data.assigned_technician_name;
    if (data?.assigned_technician_phone) updates.assigned_technician_phone = data.assigned_technician_phone;
    if (data?.assigned_vehicle_reg) updates.assigned_vehicle_reg = data.assigned_vehicle_reg;

    if (data?.latitude !== undefined && data?.longitude !== undefined) {
      if (isValidCoordinate(data.latitude, data.longitude)) {
        updates.last_known_latitude = data.latitude;
        updates.last_known_longitude = data.longitude;
        updates.last_location_updated_at = now;
      }
    }

    // Timestamp milestones
    if (newStatus === AssignmentStatus.EN_ROUTE && !assignment.en_route_at) {
      updates.en_route_at = now;
    } else if (newStatus === AssignmentStatus.ARRIVED && !assignment.arrived_at) {
      updates.arrived_at = now;
    } else if (newStatus === AssignmentStatus.IN_PROGRESS && !assignment.in_progress_at) {
      updates.in_progress_at = now;
    } else if (newStatus === AssignmentStatus.COMPLETED && !assignment.completed_at) {
      updates.completed_at = now;
    }

    const updatedAssignment = roadsideRepository.updateAssignment(assignmentId, updates)!;

    // Sync incident status
    let incidentStatusUpdate: RoadsideIncidentStatus | null = null;
    if (newStatus === AssignmentStatus.EN_ROUTE) {
      incidentStatusUpdate = RoadsideIncidentStatus.EN_ROUTE;
    } else if (newStatus === AssignmentStatus.ARRIVED) {
      incidentStatusUpdate = RoadsideIncidentStatus.ARRIVED;
    } else if (newStatus === AssignmentStatus.IN_PROGRESS) {
      incidentStatusUpdate = RoadsideIncidentStatus.IN_PROGRESS;
    }

    if (incidentStatusUpdate && incident.status !== incidentStatusUpdate) {
      roadsideRepository.updateIncident(incident.id, {
        status: incidentStatusUpdate,
        updated_at: now,
      });
    }

    // Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: assignment.incident_id,
      activity_type: `ASSIGNMENT_${newStatus}`,
      actor_id: actorId,
      actor_type: 'PROVIDER',
      actor_name: actorName,
      title: `Technician status: ${newStatus}`,
      details: data?.eta_minutes ? `ETA: ${data.eta_minutes} mins` : undefined,
      created_at: now,
    });

    // Emit event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: `roadside.assignment.${newStatus.toLowerCase()}`,
        correlation_id: assignment.incident_id,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: assignment.incident_id,
          provider: assignment.provider_id,
        },
        actor_id: actorId,
        payload: {
          incident_id: assignment.incident_id,
          assignment_id: assignmentId,
          status: newStatus,
          latitude: updates.last_known_latitude,
          longitude: updates.last_known_longitude,
          eta_minutes: updates.eta_minutes,
        },
      })
    );

    return updatedAssignment;
  }

  /**
   * 7. Record Roadside Intervention & On-site Repair / Diagnosis / Tow Handoff
   */
  async recordIntervention(
    assignmentId: string,
    params: {
      result: InterventionResult;
      summary_notes: string;
      labor_duration_minutes?: number;
      final_drivability: DrivabilityState;
      odometer_reading_km?: number;
      tow_required?: boolean;
      fee_minor?: number;
      currency?: string;
      actions?: Array<{
        action_type: InterventionActionType;
        description: string;
        part_name?: string;
        part_number?: string;
        quantity?: number;
        cost_minor?: number;
      }>;
      tow_handoff?: {
        reason?: string;
        recommended_vehicle_condition?: string;
        destination_type?: TowDestinationType | string;
        destination_name?: string;
        destination_address?: string;
        destination_provider_id?: string;
        destination_latitude?: number;
        destination_longitude?: number;
        special_instructions?: string;
        preferred_destination?: {
          destination_type?: TowDestinationType | string;
          address?: string;
          latitude?: number;
          longitude?: number;
        };
      };
    },
    actor?: RoadsideActorContext
  ): Promise<{ intervention: RoadsideInterventionEntity; tow_handoff?: RoadsideTowHandoffEntity }> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const assignment = roadsideRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_ASSIGNMENT_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }

    const incident = roadsideRepository.getIncidentById(assignment.incident_id);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${assignment.incident_id} not found`);
    }

    const now = getCurrentUtcIsoString();
    const interventionId = generateCanonicalId('rsi');
    const isTow =
      params.tow_required ||
      params.result === InterventionResult.CANNOT_REPAIR_TOW_REQUIRED ||
      Boolean(params.tow_handoff);

    // 1. Create Intervention Record
    const intervention: RoadsideInterventionEntity = {
      id: interventionId,
      incident_id: assignment.incident_id,
      assignment_id: assignmentId,
      provider_id: assignment.provider_id,
      technician_id: assignment.assigned_technician_id,
      technician_name: assignment.assigned_technician_name || actorName,
      result: params.result,
      summary_notes: params.summary_notes,
      labor_duration_minutes: params.labor_duration_minutes || 0,
      final_drivability: params.final_drivability,
      odometer_reading_km: params.odometer_reading_km || null,
      tow_required: isTow,
      tow_destination: params.tow_handoff?.destination_name || null,
      related_issue_id: null,
      related_component_id: null,
      related_tyre_id: null,
      fee_minor: params.fee_minor || 0,
      currency: params.currency || 'KES',
      recorded_at: now,
      created_at: now,
    };
    roadsideRepository.createIntervention(intervention);

    // 2. Create Actions / Parts used
    if (params.actions && params.actions.length > 0) {
      for (const action of params.actions) {
        roadsideRepository.createInterventionAction({
          id: generateCanonicalId('act'),
          intervention_id: interventionId,
          action_type: action.action_type,
          description: action.description,
          part_name: action.part_name || null,
          part_number: action.part_number || null,
          quantity: action.quantity || 1,
          cost_minor: action.cost_minor || 0,
          created_at: now,
        });
      }
    }

    // 3. Handle Tow Handoff if required
    let towHandoffRecord: RoadsideTowHandoffEntity | undefined = undefined;
    if (isTow && params.tow_handoff) {
      const th = params.tow_handoff as any;
      const destType =
        th.destination_type || th.preferred_destination?.destination_type || TowDestinationType.GARAGE;
      const destName =
        th.destination_name || th.preferred_destination?.address || 'Designated Destination';
      const destAddress = th.destination_address || th.preferred_destination?.address || null;
      const destLat = th.destination_latitude ?? th.preferred_destination?.latitude ?? null;
      const destLng = th.destination_longitude ?? th.preferred_destination?.longitude ?? null;
      const specInst = th.special_instructions || th.reason || null;

      towHandoffRecord = roadsideRepository.createTowHandoff({
        id: generateCanonicalId('tow'),
        incident_id: assignment.incident_id,
        intervention_id: interventionId,
        destination_type: destType,
        destination_provider_id: th.destination_provider_id || null,
        destination_name: destName,
        destination_address: destAddress,
        destination_latitude: destLat,
        destination_longitude: destLng,
        special_instructions: specInst,
        status: 'PENDING_DISPATCH',
        created_at: now,
      });
    }

    // 4. Mark Assignment COMPLETED
    roadsideRepository.updateAssignment(assignmentId, {
      status: AssignmentStatus.COMPLETED,
      completed_at: now,
      updated_at: now,
    });

    // 5. Update Incident Status
    const finalIncidentStatus = isTow ? RoadsideIncidentStatus.TOW_REQUIRED : RoadsideIncidentStatus.RESOLVED;

    roadsideRepository.updateIncident(assignment.incident_id, {
      status: finalIncidentStatus,
      resolved_at: isTow ? null : now,
      updated_at: now,
    });

    // 6. Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: assignment.incident_id,
      activity_type: 'INTERVENTION_COMPLETED',
      actor_id: actorId,
      actor_type: 'PROVIDER',
      actor_name: actorName,
      title: isTow ? 'Intervention ended: Tow recovery required' : 'Intervention completed: Vehicle drivable',
      details: params.summary_notes,
      created_at: now,
    });

    // 7. Emit Domain Event (Integrates with Vehicle Timeline)
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.intervention.completed',
        correlation_id: assignment.incident_id,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: assignment.incident_id,
          provider: assignment.provider_id,
        },
        actor_id: actorId,
        payload: {
          incident_id: assignment.incident_id,
          vehicle_id: incident.vehicle_id,
          intervention_id: interventionId,
          result: params.result,
          final_drivability: params.final_drivability,
          odometer_reading_km: params.odometer_reading_km,
          tow_required: isTow,
          tow_destination: params.tow_handoff?.destination_name,
          summary_notes: params.summary_notes,
        },
      })
    );

    return { intervention, tow_handoff: towHandoffRecord };
  }

  /**
   * 8. Cancel Incident
   */
  async cancelIncident(
    incidentId: string,
    params: {
      reason: string;
      notes?: string;
    },
    actor?: RoadsideActorContext
  ): Promise<RoadsideIncidentEntity> {
    const actorId = getActorId(actor);
    const actorName = getActorName(actor);

    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    if (
      incident.status === RoadsideIncidentStatus.RESOLVED ||
      incident.status === RoadsideIncidentStatus.CANCELLED ||
      incident.status === RoadsideIncidentStatus.CLOSED
    ) {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot cancel incident already in status ${incident.status}`
      );
    }

    const now = getCurrentUtcIsoString();
    let feeIncurredMinor = 0;

    // Check active assignment
    const activeAssignment = roadsideRepository.getActiveAssignment(incidentId);
    if (activeAssignment) {
      // If already arrived or en route, callout fee applies
      if (
        activeAssignment.status === AssignmentStatus.EN_ROUTE ||
        activeAssignment.status === AssignmentStatus.ARRIVED ||
        activeAssignment.status === AssignmentStatus.IN_PROGRESS
      ) {
        feeIncurredMinor = 200000; // 2,000 KES cancellation fee
      }

      roadsideRepository.updateAssignment(activeAssignment.id, {
        status: AssignmentStatus.CANCELLED,
        cancelled_at: now,
        updated_at: now,
      });
    }

    // Cancel active assistance request
    const activeReq = roadsideRepository.getActiveAssistanceRequest(incidentId);
    if (activeReq) {
      roadsideRepository.updateAssistanceRequest(activeReq.id, {
        status: AssistanceRequestStatus.CANCELLED,
      });
      roadsideRepository.withdrawPendingOffers(activeReq.id);
    }

    // Record Cancellation
    roadsideRepository.createCancellation({
      id: generateCanonicalId('rsc'),
      incident_id: incidentId,
      cancelled_by_user_id: actorId,
      cancelled_by_role: actor?.roles?.[0] || 'DRIVER',
      reason: params.reason,
      notes: params.notes || null,
      fee_incurred_minor: feeIncurredMinor,
      cancelled_at: now,
    });

    // Update Incident
    const updatedIncident = roadsideRepository.updateIncident(incidentId, {
      status: RoadsideIncidentStatus.CANCELLED,
      cancelled_at: now,
      updated_at: now,
    })!;

    // Log Activity
    roadsideRepository.logActivity({
      id: generateCanonicalId('act'),
      incident_id: incidentId,
      activity_type: 'INCIDENT_CANCELLED',
      actor_id: actorId,
      actor_type: 'USER',
      actor_name: actorName,
      title: 'Roadside incident cancelled',
      details: `Reason: ${params.reason}${feeIncurredMinor > 0 ? ` (Cancellation fee: ${feeIncurredMinor / 100} KES)` : ''}`,
      created_at: now,
    });

    // Emit event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'roadside.incident.cancelled',
        correlation_id: incidentId,
        subject_ids: {
          vehicle: incident.vehicle_id,
          incident: incidentId,
        },
        actor_id: actorId,
        payload: {
          incident_id: incidentId,
          reason: params.reason,
          fee_incurred_minor: feeIncurredMinor,
        },
      })
    );

    return updatedIncident;
  }

  /**
   * 9. Add Incident Evidence (Photo/Audio/Document)
   */
  async addEvidence(
    incidentId: string,
    data: {
      evidence_type: EvidenceType;
      caption?: string;
      file_url?: string;
      storage_object_id?: string;
    },
    actor?: RoadsideActorContext
  ): Promise<RoadsideIncidentEvidenceEntity> {
    const actorId = getActorId(actor);
    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    const now = getCurrentUtcIsoString();
    const evidence: RoadsideIncidentEvidenceEntity = {
      id: generateCanonicalId('fil'),
      incident_id: incidentId,
      storage_object_id: data.storage_object_id || null,
      evidence_type: data.evidence_type,
      caption: data.caption || null,
      file_url: data.file_url || null,
      captured_by_role: actor?.roles?.[0] || 'DRIVER',
      uploaded_by_user_id: actorId,
      created_at: now,
    };

    return roadsideRepository.createEvidence(evidence);
  }

  /**
   * 10. Get Full Incident Details Aggregate
   */
  getIncidentDetails(incidentId: string): FullRoadsideIncidentAggregate {
    const incident = roadsideRepository.getIncidentById(incidentId);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.ROADSIDE_INCIDENT_NOT_FOUND, `Incident ${incidentId} not found`);
    }

    const location = roadsideRepository.getActiveLocation(incidentId);
    const triageRecord = roadsideRepository.getLatestTriageRecord(incidentId);
    const triageWithAnswers = triageRecord
      ? {
          ...triageRecord,
          answers: roadsideRepository.getTriageAnswers(triageRecord.id),
        }
      : null;

    const activeRequest = roadsideRepository.getActiveAssistanceRequest(incidentId);
    const offers = activeRequest ? roadsideRepository.getOffersByRequestId(activeRequest.id) : [];

    const activeAssignment = roadsideRepository.getActiveAssignment(incidentId);
    let activeAssignmentWithProvider: (RoadsideAssignmentEntity & { provider_name?: string }) | null = activeAssignment;
    if (activeAssignment) {
      const db = getDatabase();
      const p = db.prepare('SELECT name FROM service_providers WHERE id = ?').get(activeAssignment.provider_id) as any;
      activeAssignmentWithProvider = {
        ...activeAssignment,
        provider_name: p?.name,
      };
    }

    const intervention = roadsideRepository.getInterventionByIncidentId(incidentId);
    const interventionWithActions = intervention
      ? {
          ...intervention,
          actions: roadsideRepository.getInterventionActions(intervention.id),
        }
      : null;

    const towHandoff = roadsideRepository.getTowHandoff(incidentId);
    const evidence = roadsideRepository.getEvidenceByIncidentId(incidentId);
    const activityLog = roadsideRepository.getActivityLog(incidentId);

    return {
      incident,
      current_location: location,
      triage_record: triageWithAnswers,
      active_request: activeRequest,
      offers,
      active_assignment: activeAssignmentWithProvider,
      intervention: interventionWithActions,
      tow_handoff: towHandoff,
      evidence,
      activity_log: activityLog,
    };
  }

  /**
   * 11. List Incidents with filters
   */
  listIncidents(filters?: {
    vehicle_id?: string;
    organization_id?: string;
    reported_by_user_id?: string;
    status?: RoadsideIncidentStatus;
    statuses?: RoadsideIncidentStatus[];
    limit?: number;
    offset?: number;
  }): RoadsideIncidentEntity[] {
    return roadsideRepository.listIncidents(filters);
  }

  /**
   * 12. Provider Specific Queries
   */
  getProviderOffers(providerId: string, status?: ProviderOfferStatus): RoadsideProviderOfferEntity[] {
    return roadsideRepository.getOffersByProviderId(providerId, status);
  }

  getProviderAssignments(providerId: string, status?: AssignmentStatus): RoadsideAssignmentEntity[] {
    return roadsideRepository.getAssignmentsByProviderId(providerId, status);
  }
}

export const roadsideService = new RoadsideService();
