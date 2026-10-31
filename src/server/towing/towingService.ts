/**
 * Canonical Towing & Recovery Domain Service Layer (GAR-015)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { eventBus } from '../events/eventBus';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { getDatabase } from '../database/connection';
import { isValidCoordinate } from '../providers/geoUtils';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { roadsideRepository } from '../roadside/roadsideRepository';
import { timelineRepository } from '../timeline/timelineRepository';
import { passportBuilder } from '../timeline/passportBuilder';
import { CanonicalActorType } from '../../shared/types';
import {
  TimelineEntryType,
  TimelineCategory,
  TimelineSourceType,
  TimelineVerificationStatus,
  TimelineVisibility,
  TimelineSensitivity,
  VehicleTimelineEntryEntity,
} from '../timeline/types';
import { OdometerUnit } from '../vehicle/types';
import {
  TowRequestEntity,
  TowPickupLocationEntity,
  TowDestinationEntity,
  TowDestinationRevisionEntity,
  RecoveryUnitEntity,
  RecoveryUnitEquipmentEntity,
  TowProviderOfferEntity,
  TowAssignmentEntity,
  TowPickupInspectionEntity,
  TowCustodyEventEntity,
  TowDeliveryConfirmationEntity,
  TowDeliveryEvidenceEntity,
  TowCancellationEntity,
  TowAssignmentFailureEntity,
  TowActivityEntity,
  FullTowAggregate,
  TowSourceType,
  TowRequestStatus,
  TowReason,
  RecoveryType,
  VehicleMobilityState,
  VehicleConditionState,
  TowDestinationType,
  RecoveryUnitType,
  RecoveryUnitStatus,
  EquipmentType,
  TowVehicleClass,
  TowCompatibilityStatus,
  TowOfferStatus,
  TowAssignmentStatus,
  TowPickupEvidenceType,
  TowCustodyEventType,
  TowPartyType,
  TowDeliveryRecipientType,
  TowDeliveryAcknowledgementMethod,
  TowDeliveryEvidenceType,
  TowFailureType,
} from './types';
import { towingRepository } from './towingRepository';
import { TowingMatchingEngine } from './matchingEngine';
import { TowingCompatibilityEngine } from './compatibilityEngine';

export interface TowActorContext {
  id: string;
  name?: string;
  roles?: string[];
  provider_id?: string;
}

export interface CreateTowRequestDTO {
  vehicle_id: string;
  requesting_user_id: string;
  organization_id?: string;
  source_type?: TowSourceType;
  source_reference_id?: string;
  tow_reason: TowReason;
  recovery_type?: RecoveryType;
  vehicle_mobility_state?: VehicleMobilityState;
  vehicle_condition_state?: VehicleConditionState;
  preferred_provider_id?: string;
  related_issue_id?: string;
  special_instructions?: string;
  pickup_location: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number;
    address_summary: string;
    road_name?: string;
    landmark?: string;
    access_notes?: string;
    access_instructions?: string;
    location_type?: string;
    source_type?: string;
  };
  destination: {
    destination_type: TowDestinationType;
    provider_id?: string;
    branch_id?: string;
    location_reference_id?: string;
    address_summary: string;
    latitude?: number;
    longitude?: number;
    contact_name?: string;
    contact_phone?: string;
    instructions?: string;
  };
}

export class TowingService {
  /**
   * 1. Create a Standalone Tow Request
   */
  async createTowRequest(
    dto: CreateTowRequestDTO,
    actor?: TowActorContext
  ): Promise<FullTowAggregate> {
    // Validate vehicle
    const vehicle = vehicleRepository.getVehicleById(dto.vehicle_id);
    if (!vehicle) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Vehicle ${dto.vehicle_id} not found`);
    }

    // Validate coordinates
    if (!isValidCoordinate(dto.pickup_location.latitude, dto.pickup_location.longitude)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid pickup coordinates provided');
    }

    const now = getCurrentUtcIsoString();
    const requestId = generateCanonicalId('tow');
    const requestNumber = towingRepository.getNextTowSequenceNumber();
    const pickupLocId = generateCanonicalId('tpl');
    const destId = generateCanonicalId('td');

    const mobility = dto.vehicle_mobility_state || VehicleMobilityState.UNKNOWN;
    const condition = dto.vehicle_condition_state || VehicleConditionState.NORMAL_BREAKDOWN;
    const recType = dto.recovery_type || RecoveryType.STANDARD_TOW;

    // Create Tow Request
    const towReq: TowRequestEntity = {
      id: requestId,
      request_number: requestNumber,
      vehicle_id: dto.vehicle_id,
      requesting_user_id: dto.requesting_user_id,
      organization_id: dto.organization_id || (vehicle as any).organization_id || null,
      source_type: dto.source_type || TowSourceType.OWNER_REQUEST,
      source_reference_id: dto.source_reference_id || null,
      status: TowRequestStatus.PENDING_DISPATCH,
      tow_reason: dto.tow_reason,
      recovery_type: recType,
      vehicle_mobility_state: mobility,
      vehicle_condition_state: condition,
      required_capability_profile_id: null,
      preferred_provider_id: dto.preferred_provider_id || null,
      assigned_provider_id: null,
      active_assignment_id: null,
      related_issue_id: dto.related_issue_id || null,
      special_instructions: dto.special_instructions || null,
      requested_at: now,
      created_at: now,
      updated_at: now,
    };
    towingRepository.createTowRequest(towReq);

    // Create Pickup Location
    towingRepository.createPickupLocation({
      id: pickupLocId,
      tow_request_id: requestId,
      latitude: dto.pickup_location.latitude,
      longitude: dto.pickup_location.longitude,
      accuracy_meters: dto.pickup_location.accuracy_meters || null,
      address_summary: dto.pickup_location.address_summary,
      road_name: dto.pickup_location.road_name || null,
      landmark: dto.pickup_location.landmark || null,
      access_notes: (dto.pickup_location as any).access_instructions || dto.pickup_location.access_notes || null,
      access_instructions: (dto.pickup_location as any).access_instructions || dto.pickup_location.access_notes || null,
      source_type: dto.pickup_location.source_type || 'MANUAL_ENTRY',
      captured_at: now,
      created_at: now,
    });

    // Create Destination
    towingRepository.createDestination({
      id: destId,
      tow_request_id: requestId,
      destination_type: dto.destination.destination_type,
      provider_id: dto.destination.provider_id || null,
      branch_id: dto.destination.branch_id || null,
      location_reference_id: dto.destination.location_reference_id || null,
      address_summary: dto.destination.address_summary,
      latitude: dto.destination.latitude || null,
      longitude: dto.destination.longitude || null,
      contact_name: dto.destination.contact_name || null,
      contact_phone: dto.destination.contact_phone || null,
      instructions: dto.destination.instructions || null,
      created_at: now,
      updated_at: now,
    });

    // Log Activity
    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: requestId,
      activity_type: 'TOW_REQUEST_CREATED',
      actor_id: actor?.id || dto.requesting_user_id,
      actor_type: 'USER',
      actor_name: actor?.name || 'Requestor',
      title: `Tow request ${requestNumber} created`,
      details: `Reason: ${dto.tow_reason} | Destination: ${dto.destination.address_summary}`,
      created_at: now,
    });

    // Broadcast Offers to Compatible Providers
    await this.broadcastOffers(requestId);

    // Emit event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.request.created',
        correlation_id: requestId,
        subject_ids: {
          vehicle: dto.vehicle_id,
          tow_request: requestId,
        },
        actor_id: actor?.id || dto.requesting_user_id,
        payload: {
          tow_request_id: requestId,
          request_number: requestNumber,
          vehicle_id: dto.vehicle_id,
          tow_reason: dto.tow_reason,
          destination_summary: dto.destination.address_summary,
        },
      })
    );

    return towingRepository.getFullTowAggregate(requestId)!;
  }

  /**
   * 2. Accept Handoff from Roadside Assistance
   */
  async createFromRoadsideHandoff(
    params: {
      incident_id: string;
      requesting_user_id: string;
      tow_reason?: TowReason;
      destination: {
        destination_type: TowDestinationType;
        provider_id?: string;
        destination_provider_id?: string;
        destination_name?: string;
        destination_address?: string;
        address_summary?: string;
        latitude?: number;
        longitude?: number;
        destination_latitude?: number;
        destination_longitude?: number;
        contact_name?: string;
        contact_phone?: string;
        special_instructions?: string;
        reason?: string;
      };
    },
    actor?: TowActorContext
  ): Promise<FullTowAggregate> {
    const incident = roadsideRepository.getIncidentById(params.incident_id);
    if (!incident) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Roadside incident ${params.incident_id} not found`);
    }

    const location = roadsideRepository.getLocationById(incident.current_location_id || '');
    if (!location) {
      throw new CanonicalAppError(ErrorCode.PRECONDITION_FAILED, 'Roadside incident has no valid location');
    }

    // Determine mobility state based on incident drivability & triage
    let mobility = VehicleMobilityState.ROLLING;
    const triage = roadsideRepository.getTriageRecordByIncidentId(params.incident_id);
    if (triage) {
      const answers = roadsideRepository.listTriageAnswers(triage.id);
      const wheelsRollAns = answers.find(a => a.question_key === 'wheels_roll');
      if (wheelsRollAns && ((wheelsRollAns as any).boolean_value === 0 || (wheelsRollAns as any).boolean_value === false || wheelsRollAns.answer_value === 'false' || wheelsRollAns.answer_value === 'no')) {
        mobility = VehicleMobilityState.IMMOBILE;
      }
    }

    const result = await this.createTowRequest(
      {
        vehicle_id: incident.vehicle_id,
        requesting_user_id: params.requesting_user_id,
        organization_id: incident.organization_id || undefined,
        source_type: TowSourceType.ROADSIDE_INCIDENT,
        source_reference_id: params.incident_id,
        tow_reason: params.tow_reason || TowReason.BREAKDOWN,
        recovery_type: RecoveryType.STANDARD_TOW,
        vehicle_mobility_state: mobility,
        vehicle_condition_state: VehicleConditionState.NORMAL_BREAKDOWN,
        special_instructions: params.destination.special_instructions,
        pickup_location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy_meters: location.accuracy_meters || undefined,
          address_summary: location.address_line || location.road_or_highway || 'Roadside incident location',
          road_name: location.road_or_highway || undefined,
          landmark: location.landmark_description || undefined,
          source_type: 'ROADSIDE_INCIDENT',
        },
        destination: {
          destination_type: params.destination.destination_type,
          provider_id: params.destination.provider_id || params.destination.destination_provider_id,
          address_summary: params.destination.address_summary || params.destination.destination_address || params.destination.destination_name || 'Designated Destination',
          latitude: params.destination.latitude || params.destination.destination_latitude,
          longitude: params.destination.longitude || params.destination.destination_longitude,
          contact_name: params.destination.contact_name,
          contact_phone: params.destination.contact_phone,
          instructions: params.destination.special_instructions,
        },
      },
      actor
    );

    // Update roadside tow handoff record if existing
    const db = getDatabase();
    db.prepare(`
      UPDATE roadside_tow_handoffs
      SET status = 'DISPATCHED'
      WHERE incident_id = ?
    `).run(params.incident_id);

    return result;
  }

  /**
   * 3. Broadcast Offers to Compatible Providers
   */
  async broadcastOffers(requestId: string): Promise<TowProviderOfferEntity[]> {
    const aggregate = towingRepository.getFullTowAggregate(requestId);
    if (!aggregate) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Tow request ${requestId} not found`);
    }

    const { request, pickup_location } = aggregate;
    if (!pickup_location) {
      return [];
    }

    const vehicle = vehicleRepository.getVehicleById(request.vehicle_id);

    const candidates = TowingMatchingEngine.findCandidates(
      {
        vehicle_id: request.vehicle_id,
        vehicle_type: vehicle?.vehicle_type,
        curb_weight_kg: (vehicle as any)?.curb_weight_kg,
        drive_type: vehicle?.drive_type,
        mobility_state: request.vehicle_mobility_state,
        condition_state: request.vehicle_condition_state,
      },
      {
        pickup_latitude: pickup_location.latitude,
        pickup_longitude: pickup_location.longitude,
        preferred_provider_id: request.preferred_provider_id,
      }
    );

    const now = getCurrentUtcIsoString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry
    const createdOffers: TowProviderOfferEntity[] = [];

    for (const candidate of candidates) {
      const offer: TowProviderOfferEntity = {
        id: generateCanonicalId('tpo'),
        tow_request_id: requestId,
        provider_id: candidate.provider_id,
        recovery_unit_id: candidate.recovery_unit_id,
        status: TowOfferStatus.OFFERED,
        offered_at: now,
        expires_at: expiresAt,
        distance_km: candidate.distance_km,
        compatibility_status: candidate.compatibility.status,
        estimated_price_minor: candidate.estimated_price_minor,
        currency: candidate.currency,
        created_at: now,
      };
      towingRepository.createOffer(offer);
      createdOffers.push(offer);

      // Emit offer event
      eventBus.publish(
        createCanonicalEventEnvelope({
          type: 'tow.offer.created',
          correlation_id: requestId,
          subject_ids: {
            vehicle: request.vehicle_id,
            tow_request: requestId,
            provider: candidate.provider_id,
          },
          actor_id: 'SYSTEM',
          payload: {
            offer_id: offer.id,
            tow_request_id: requestId,
            provider_id: candidate.provider_id,
            recovery_unit_id: candidate.recovery_unit_id,
            estimated_price_minor: candidate.estimated_price_minor,
          },
        })
      );
    }

    if (createdOffers.length > 0) {
      towingRepository.updateTowRequest(requestId, {
        status: TowRequestStatus.PENDING_DISPATCH,
        updated_at: now,
      });
    } else {
      towingRepository.updateTowRequest(requestId, {
        status: TowRequestStatus.SEARCHING_PROVIDER,
        updated_at: now,
      });
    }

    return createdOffers;
  }

  /**
   * 4. Accept Provider Offer (Transactional Concurrency Collision Guard)
   */
  async acceptOffer(
    params: {
      offer_id: string;
      provider_id: string;
      operator_staff_id?: string;
      operator_name?: string;
      operator_phone?: string;
    },
    actor?: TowActorContext
  ): Promise<TowAssignmentEntity> {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    let createdAssignment: TowAssignmentEntity;

    // Transactional acceptance to prevent race conditions
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const offer = towingRepository.getOfferById(params.offer_id);
      if (!offer) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Offer ${params.offer_id} not found`);
      }

      if (offer.provider_id !== params.provider_id) {
        throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Offer does not belong to this provider');
      }

      if (offer.status !== TowOfferStatus.OFFERED && offer.status !== TowOfferStatus.VIEWED) {
        if (offer.status === TowOfferStatus.CANCELLED) {
          throw new CanonicalAppError(
            ErrorCode.CONFLICT,
            'This tow request has already been assigned to another provider'
          );
        }
        if (offer.status === TowOfferStatus.EXPIRED) {
          throw new CanonicalAppError(ErrorCode.CONFLICT, 'This tow offer has expired');
        }
        throw new CanonicalAppError(ErrorCode.CONFLICT, `Offer has already been assigned or is in status ${offer.status}`);
      }

      if (new Date(offer.expires_at) < new Date(now)) {
        throw new CanonicalAppError(ErrorCode.CONFLICT, 'Offer has expired');
      }

      const towRequest = towingRepository.getTowRequestById(offer.tow_request_id);
      if (!towRequest) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Tow request not found');
      }

      if (towRequest.status === TowRequestStatus.CANCELLED || towRequest.status === TowRequestStatus.COMPLETED) {
        throw new CanonicalAppError(ErrorCode.CONFLICT, `Tow request is already ${towRequest.status}`);
      }

      // Check if another provider has already been accepted!
      const existingAssignment = towingRepository.getActiveAssignmentForRequest(offer.tow_request_id);
      if (existingAssignment) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          'Another towing provider has already accepted and been assigned to this request'
        );
      }

      // Validate recovery unit
      if (!offer.recovery_unit_id) {
        throw new CanonicalAppError(ErrorCode.PRECONDITION_FAILED, 'No recovery unit associated with this offer');
      }

      const unit = towingRepository.getRecoveryUnitById(offer.recovery_unit_id);
      if (!unit) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Recovery unit ${offer.recovery_unit_id} not found`);
      }

      if (unit.status !== RecoveryUnitStatus.AVAILABLE) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Recovery unit ${unit.registration_identifier} is currently ${unit.status} and cannot be assigned`
        );
      }

      // Check active assignment for this recovery unit
      const existingUnitAssignment = towingRepository.getActiveAssignmentForUnit(unit.id);
      if (existingUnitAssignment) {
        throw new CanonicalAppError(
          ErrorCode.CONFLICT,
          `Recovery unit ${unit.registration_identifier} already has an active assignment`
        );
      }

      // 1. Create Tow Assignment
      const assignmentId = generateCanonicalId('tas');
      createdAssignment = {
        id: assignmentId,
        tow_request_id: offer.tow_request_id,
        provider_id: offer.provider_id,
        recovery_unit_id: unit.id,
        operator_staff_id: params.operator_staff_id || null,
        operator_name: params.operator_name || 'Tow Operator',
        operator_phone: params.operator_phone || null,
        status: TowAssignmentStatus.ACCEPTED,
        assigned_at: now,
        accepted_at: now,
        created_at: now,
        updated_at: now,
      };
      towingRepository.createAssignment(createdAssignment);

      // 2. Mark this offer ACCEPTED
      towingRepository.updateOffer(offer.id, {
        status: TowOfferStatus.ACCEPTED,
        responded_at: now,
      });

      // 3. Mark competing offers CANCELLED
      towingRepository.cancelOtherPendingOffers(offer.tow_request_id, offer.id);

      // 4. Reserve Recovery Unit -> EN_ROUTE
      towingRepository.updateRecoveryUnit(unit.id, {
        status: RecoveryUnitStatus.EN_ROUTE,
        updated_at: now,
      });

      // 5. Update Tow Request -> ASSIGNED
      towingRepository.updateTowRequest(offer.tow_request_id, {
        status: TowRequestStatus.ASSIGNED,
        assigned_provider_id: offer.provider_id,
        active_assignment_id: assignmentId,
        assigned_at: now,
        updated_at: now,
      });

      // 6. Log Activity
      towingRepository.logActivity({
        id: generateCanonicalId('tact'),
        tow_request_id: offer.tow_request_id,
        tow_assignment_id: assignmentId,
        activity_type: 'OFFER_ACCEPTED',
        actor_id: actor?.id || params.provider_id,
        actor_type: 'PROVIDER',
        actor_name: actor?.name || 'Towing Provider',
        title: 'Offer accepted and recovery unit assigned',
        details: `Unit: ${unit.registration_identifier} (${unit.unit_type}) | Operator: ${params.operator_name || 'Assigned'}`,
        created_at: now,
      });

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    // Publish event outside transaction
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.offer.accepted',
        correlation_id: createdAssignment.tow_request_id,
        subject_ids: {
          tow_request: createdAssignment.tow_request_id,
          provider: createdAssignment.provider_id,
          assignment: createdAssignment.id,
        },
        actor_id: actor?.id || params.provider_id,
        payload: {
          assignment_id: createdAssignment.id,
          tow_request_id: createdAssignment.tow_request_id,
          provider_id: createdAssignment.provider_id,
          recovery_unit_id: createdAssignment.recovery_unit_id,
        },
      })
    );

    return createdAssignment;
  }

  /**
   * 5. Decline Offer
   */
  async declineOffer(offerId: string, providerId: string, reason?: string): Promise<void> {
    const offer = towingRepository.getOfferById(offerId);
    if (!offer) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Offer ${offerId} not found`);
    }

    if (offer.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Offer does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    towingRepository.updateOffer(offerId, {
      status: TowOfferStatus.DECLINED,
      decline_reason: reason || 'Declined by provider',
      responded_at: now,
    });
  }

  /**
   * 6. Mark En Route to Pickup
   */
  async markEnRoute(assignmentId: string, providerId: string, actor?: TowActorContext): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }
    if (
      assignment.status !== TowAssignmentStatus.ASSIGNED &&
      assignment.status !== TowAssignmentStatus.ACCEPTED &&
      assignment.status !== TowAssignmentStatus.ACKNOWLEDGED
    ) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, `Assignment in status ${assignment.status} cannot transition to en-route`);
    }

    const now = getCurrentUtcIsoString();
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.EN_ROUTE_TO_PICKUP,
      en_route_at: now,
      updated_at: now,
    });

    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.EN_ROUTE,
      updated_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'UNIT_EN_ROUTE',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Recovery unit en route to vehicle location',
      details: `Operator departed toward pickup location`,
      created_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.assignment.en_route',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: assignmentId,
          provider: providerId,
        },
        actor_id: actor?.id || providerId,
        payload: {
          assignment_id: assignmentId,
          tow_request_id: assignment.tow_request_id,
          en_route_at: now,
        },
      })
    );

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 7. Mark Arrival at Pickup
   */
  async arrivePickup(assignmentId: string, providerId: string, actor?: TowActorContext): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }
    if (assignment.status !== TowAssignmentStatus.EN_ROUTE_TO_PICKUP) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, `Assignment must be en-route before recording arrival`);
    }

    const now = getCurrentUtcIsoString();
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.ARRIVED_AT_PICKUP,
      arrived_pickup_at: now,
      updated_at: now,
    });

    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.AT_PICKUP,
      updated_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'UNIT_ARRIVED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Recovery unit arrived at pickup location',
      details: `On-site at vehicle location; commencing pre-tow inspection`,
      created_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.assignment.arrived_pickup',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: assignmentId,
          provider: providerId,
        },
        actor_id: actor?.id || providerId,
        payload: {
          assignment_id: assignmentId,
          tow_request_id: assignment.tow_request_id,
          arrived_at: now,
        },
      })
    );

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 8. Record Pre-Tow Pickup Inspection
   */
  async recordPickupInspection(
    params: {
      assignment_id: string;
      provider_id: string;
      vehicle_condition_summary: string;
      visible_damage?: string[];
      mobility_state_confirmed: VehicleMobilityState;
      odometer_reading_km?: number;
      notes?: string;
      evidence?: Array<{ evidence_type: TowPickupEvidenceType | string; file_url: string; caption?: string }>;
    },
    actor?: TowActorContext
  ): Promise<TowPickupInspectionEntity> {
    const assignment = towingRepository.getAssignmentById(params.assignment_id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${params.assignment_id} not found`);
    }
    if (assignment.provider_id !== params.provider_id) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    const inspectionId = generateCanonicalId('tpi');

    const inspection: TowPickupInspectionEntity = {
      id: inspectionId,
      tow_assignment_id: params.assignment_id,
      performed_at: now,
      performed_by_user_id: actor?.id || assignment.operator_staff_id || params.provider_id,
      vehicle_condition_summary: params.vehicle_condition_summary,
      visible_damage_json: params.visible_damage ? JSON.stringify(params.visible_damage) : null,
      mobility_state_confirmed: params.mobility_state_confirmed,
      odometer_reading_km: params.odometer_reading_km || null,
      notes: params.notes || null,
      created_at: now,
    };
    towingRepository.createInspection(inspection);

    // Record evidence
    if (params.evidence && params.evidence.length > 0) {
      for (const ev of params.evidence) {
        towingRepository.createPickupEvidence({
          id: generateCanonicalId('tpe'),
          inspection_id: inspectionId,
          evidence_type: ev.evidence_type,
          file_url: ev.file_url,
          caption: ev.caption || null,
          created_at: now,
        });
      }
    }

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignment.id,
      activity_type: 'PICKUP_INSPECTION_COMPLETED',
      actor_id: actor?.id || params.provider_id,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Pre-tow condition inspection recorded',
      details: `Condition: ${params.vehicle_condition_summary} | Mobility: ${params.mobility_state_confirmed}`,
      created_at: now,
    });

    return inspection;
  }

  /**
   * 9. Start Vehicle Loading
   */
  async startLoading(assignmentId: string, providerId: string, actor?: TowActorContext): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.LOADING,
      loading_started_at: now,
      updated_at: now,
    });

    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.LOADING,
      updated_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'LOADING_STARTED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Vehicle loading commenced',
      details: 'Winching / securing vehicle onto recovery unit bed',
      created_at: now,
    });

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 10. Confirm Vehicle Loaded & Chain of Custody Transfer
   */
  async confirmVehicleLoaded(
    assignmentId: string,
    providerId: string,
    actor?: TowActorContext
  ): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    // MANDATORY REQUIREMENT: Pickup inspection must be completed before confirming loaded!
    const inspection = towingRepository.getInspectionByAssignmentId(assignmentId);
    if (!inspection) {
      throw new CanonicalAppError(
        ErrorCode.PRECONDITION_FAILED,
        'Cannot confirm vehicle loading without a completed pre-tow pickup inspection'
      );
    }

    const now = getCurrentUtcIsoString();
    const pickupLoc = towingRepository.getPickupLocationByRequestId(assignment.tow_request_id);

    // 1. Update Assignment
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.VEHICLE_LOADED,
      loaded_at: now,
      updated_at: now,
    });

    // 2. Update Tow Request
    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.VEHICLE_LOADED,
      updated_at: now,
    });

    // 3. Create Chain of Custody Event (Transfer from Owner/Custodian to Tow Provider)
    towingRepository.createCustodyEvent({
      id: generateCanonicalId('tce'),
      tow_assignment_id: assignmentId,
      event_type: TowCustodyEventType.VEHICLE_LOADED,
      from_party_type: TowPartyType.OWNER,
      from_party_name: 'Vehicle Owner / Custodian',
      to_party_type: TowPartyType.TOW_PROVIDER,
      to_party_id: providerId,
      to_party_name: assignment.operator_name || 'Towing Provider',
      occurred_at: now,
      location_summary: pickupLoc?.address_summary || 'Pickup Location',
      acknowledgement_status: 'CONFIRMED',
      notes: 'Vehicle inspected, secured, and operational custody transferred to tow provider',
      created_at: now,
    });

    // 4. Log Activity
    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'VEHICLE_LOADED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Vehicle safely loaded onto recovery unit',
      details: 'Custody transferred to towing operator. Vehicle secured for transit.',
      created_at: now,
    });

    // 5. Emit Event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.vehicle.loaded',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: assignmentId,
          provider: providerId,
        },
        actor_id: actor?.id || providerId,
        payload: {
          assignment_id: assignmentId,
          tow_request_id: assignment.tow_request_id,
          loaded_at: now,
        },
      })
    );

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 11. Record Loading Failure (Structured Failure with Recovery Path)
   */
  async recordLoadingFailure(
    params: {
      assignment_id: string;
      provider_id: string;
      failure_type: TowFailureType;
      description: string;
      recoverable?: boolean;
    },
    actor?: TowActorContext
  ): Promise<TowAssignmentFailureEntity> {
    const assignment = towingRepository.getAssignmentById(params.assignment_id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${params.assignment_id} not found`);
    }
    if (assignment.provider_id !== params.provider_id) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    const isRecoverable = params.recoverable !== false;

    // 1. Record Failure
    const failure: TowAssignmentFailureEntity = {
      id: generateCanonicalId('taf'),
      assignment_id: params.assignment_id,
      failure_type: params.failure_type,
      description: params.description,
      occurred_at: now,
      reported_by_user_id: actor?.id || params.provider_id,
      recoverable: isRecoverable,
      created_at: now,
    };
    towingRepository.createAssignmentFailure(failure);

    // 2. Mark Assignment LOADING_FAILED
    towingRepository.updateAssignment(params.assignment_id, {
      status: TowAssignmentStatus.LOADING_FAILED,
      updated_at: now,
    });

    // 3. Release Recovery Unit -> AVAILABLE
    towingRepository.updateRecoveryUnit(assignment.recovery_unit_id, {
      status: RecoveryUnitStatus.AVAILABLE,
      updated_at: now,
    });

    // 4. Update Tow Request
    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.RECOVERY_FAILED,
      active_assignment_id: null,
      updated_at: now,
    });

    // 5. Log Activity
    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: params.assignment_id,
      activity_type: 'LOADING_FAILED',
      actor_id: actor?.id || params.provider_id,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: `Loading aborted: ${params.failure_type}`,
      details: `${params.description}${isRecoverable ? ' | Reverted request to search for appropriate recovery equipment' : ''}`,
      created_at: now,
    });

    // 6. Emit Event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.assignment.failed',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: params.assignment_id,
          provider: params.provider_id,
        },
        actor_id: actor?.id || params.provider_id,
        payload: {
          assignment_id: params.assignment_id,
          failure_type: params.failure_type,
          description: params.description,
          recoverable: isRecoverable,
        },
      })
    );

    return failure;
  }

  /**
   * 12. Start Transit (Critical Truth Principle Enforced)
   */
  async startTransit(assignmentId: string, providerId: string, actor?: TowActorContext): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    // CRITICAL TRUTH PRINCIPLE:
    // "Do not show 'Your vehicle is being towed' until the vehicle is actually loaded and transit has started."
    if (assignment.status !== TowAssignmentStatus.VEHICLE_LOADED) {
      throw new CanonicalAppError(
        ErrorCode.CONFLICT,
        `Cannot start transit: vehicle must be in VEHICLE_LOADED status, but is currently '${assignment.status}'`
      );
    }

    const now = getCurrentUtcIsoString();
    const dest = towingRepository.getDestinationByRequestId(assignment.tow_request_id);

    // 1. Update Assignment
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.IN_TRANSIT,
      transit_started_at: now,
      updated_at: now,
    });

    // 2. Update Tow Request
    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.IN_TRANSIT,
      updated_at: now,
    });

    // 3. Chain of Custody Event
    towingRepository.createCustodyEvent({
      id: generateCanonicalId('tce'),
      tow_assignment_id: assignmentId,
      event_type: TowCustodyEventType.VEHICLE_DEPARTED_PICKUP,
      from_party_type: TowPartyType.TOW_PROVIDER,
      from_party_id: providerId,
      to_party_type: TowPartyType.TOW_PROVIDER,
      to_party_id: providerId,
      occurred_at: now,
      location_summary: `En route to ${dest?.address_summary || 'Destination'}`,
      acknowledgement_status: 'CONFIRMED',
      notes: 'Recovery unit departed pickup location in active transit with loaded vehicle',
      created_at: now,
    });

    // 4. Log Activity
    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'TRANSIT_STARTED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Vehicle in transit to destination',
      details: `Departed pickup location en route to ${dest?.address_summary || 'destination'}`,
      created_at: now,
    });

    // 5. Emit Event
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.in_transit',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: assignmentId,
          provider: providerId,
        },
        actor_id: actor?.id || providerId,
        payload: {
          assignment_id: assignmentId,
          tow_request_id: assignment.tow_request_id,
          transit_started_at: now,
        },
      })
    );

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 13. Arrive at Destination
   */
  async arriveDestination(
    assignmentId: string,
    providerId: string,
    actor?: TowActorContext
  ): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }
    if (assignment.status !== TowAssignmentStatus.IN_TRANSIT) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, 'Assignment must be in transit to record arrival at destination');
    }

    const now = getCurrentUtcIsoString();
    const dest = towingRepository.getDestinationByRequestId(assignment.tow_request_id);

    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.ARRIVED_AT_DESTINATION,
      arrived_destination_at: now,
      updated_at: now,
    });

    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.AT_DESTINATION,
      updated_at: now,
    });

    towingRepository.createCustodyEvent({
      id: generateCanonicalId('tce'),
      tow_assignment_id: assignmentId,
      event_type: TowCustodyEventType.VEHICLE_ARRIVED_DESTINATION,
      from_party_type: TowPartyType.TOW_PROVIDER,
      from_party_id: providerId,
      to_party_type: TowPartyType.TOW_PROVIDER,
      to_party_id: providerId,
      occurred_at: now,
      location_summary: dest?.address_summary || 'Destination Facility',
      acknowledgement_status: 'CONFIRMED',
      notes: 'Recovery unit arrived at destination location with loaded vehicle',
      created_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'DESTINATION_ARRIVED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Arrived at delivery destination',
      details: `Arrived at ${dest?.address_summary || 'destination'}`,
      created_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.destination.arrived',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          tow_request: assignment.tow_request_id,
          assignment: assignmentId,
          provider: providerId,
        },
        actor_id: actor?.id || providerId,
        payload: {
          assignment_id: assignmentId,
          tow_request_id: assignment.tow_request_id,
          arrived_destination_at: now,
        },
      })
    );

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 14. Start Unloading
   */
  async startUnloading(assignmentId: string, providerId: string, actor?: TowActorContext): Promise<TowAssignmentEntity> {
    const assignment = towingRepository.getAssignmentById(assignmentId);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${assignmentId} not found`);
    }
    if (assignment.provider_id !== providerId) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    towingRepository.updateAssignment(assignmentId, {
      status: TowAssignmentStatus.UNLOADING,
      unloading_started_at: now,
      updated_at: now,
    });

    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.UNLOADING,
      updated_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: assignmentId,
      activity_type: 'UNLOADING_STARTED',
      actor_id: actor?.id || providerId,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Vehicle unloading in progress',
      details: 'Unloading vehicle from recovery unit bed',
      created_at: now,
    });

    return towingRepository.getAssignmentById(assignmentId)!;
  }

  /**
   * 15. Confirm Delivery & Handover (Custody Transfer & Timeline Projection)
   */
  async confirmDelivery(
    params: {
      assignment_id: string;
      provider_id: string;
      recipient_type: TowDeliveryRecipientType;
      recipient_name: string;
      recipient_id?: string;
      recipient_signature_reference?: string;
      destination_provider_id?: string;
      destination_branch_id?: string;
      condition_summary: string;
      acknowledgement_method: TowDeliveryAcknowledgementMethod;
      service_case_handoff_id?: string;
      evidence?: Array<{ evidence_type: TowDeliveryEvidenceType; file_url: string; caption?: string }>;
    },
    actor?: TowActorContext
  ): Promise<FullTowAggregate> {
    const assignment = towingRepository.getAssignmentById(params.assignment_id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${params.assignment_id} not found`);
    }
    if (assignment.provider_id !== params.provider_id) {
      throw new CanonicalAppError(ErrorCode.PERMISSION_DENIED, 'Assignment does not belong to this provider');
    }

    const now = getCurrentUtcIsoString();
    const dest = towingRepository.getDestinationByRequestId(assignment.tow_request_id);
    const towReq = towingRepository.getTowRequestById(assignment.tow_request_id)!;
    const confirmationId = generateCanonicalId('tdc');

    // 1. Create Delivery Confirmation
    towingRepository.createDeliveryConfirmation({
      id: confirmationId,
      tow_assignment_id: params.assignment_id,
      delivered_at: now,
      recipient_type: params.recipient_type,
      recipient_id: params.recipient_id || null,
      recipient_name: params.recipient_name,
      recipient_signature_reference: params.recipient_signature_reference || null,
      destination_provider_id: params.destination_provider_id || dest?.provider_id || null,
      destination_branch_id: params.destination_branch_id || dest?.branch_id || null,
      condition_summary: params.condition_summary,
      acknowledgement_method: params.acknowledgement_method,
      service_case_handoff_id: params.service_case_handoff_id || null,
      created_at: now,
    });

    // 2. Insert Delivery Evidence
    if (params.evidence && params.evidence.length > 0) {
      for (const ev of params.evidence) {
        towingRepository.createDeliveryEvidence({
          id: generateCanonicalId('tde'),
          delivery_confirmation_id: confirmationId,
          evidence_type: ev.evidence_type,
          file_url: ev.file_url,
          caption: ev.caption || null,
          created_at: now,
        });
      }
    }

    // 3. Final Chain of Custody Event (Transfer from Tow Provider to Recipient)
    let toPartyType = TowPartyType.DESTINATION_PROVIDER;
    if (params.recipient_type === TowDeliveryRecipientType.OWNER) {
      toPartyType = TowPartyType.OWNER;
    } else if (params.recipient_type === TowDeliveryRecipientType.GARAGE_STAFF) {
      toPartyType = TowPartyType.GARAGE_STAFF;
    } else if (params.recipient_type === TowDeliveryRecipientType.TOW_YARD_STAFF) {
      toPartyType = TowPartyType.TOW_YARD;
    }

    towingRepository.createCustodyEvent({
      id: generateCanonicalId('tce'),
      tow_assignment_id: params.assignment_id,
      event_type: TowCustodyEventType.VEHICLE_HANDOVER_CONFIRMED,
      from_party_type: TowPartyType.TOW_PROVIDER,
      from_party_id: params.provider_id,
      from_party_name: assignment.operator_name || 'Tow Operator',
      to_party_type: toPartyType,
      to_party_id: params.recipient_id || params.destination_provider_id || null,
      to_party_name: params.recipient_name,
      occurred_at: now,
      location_summary: dest?.address_summary || 'Delivery Destination',
      acknowledgement_status: 'CONFIRMED',
      notes: `Handover confirmed via ${params.acknowledgement_method} by ${params.recipient_name}`,
      created_at: now,
    });

    // 4. Update Assignment -> DELIVERED & COMPLETED
    towingRepository.updateAssignment(params.assignment_id, {
      status: TowAssignmentStatus.COMPLETED,
      delivery_confirmed_at: now,
      unloaded_at: now,
      completed_at: now,
      updated_at: now,
    });

    // 5. Release Recovery Unit -> AVAILABLE
    towingRepository.updateRecoveryUnit(assignment.recovery_unit_id, {
      status: RecoveryUnitStatus.AVAILABLE,
      updated_at: now,
    });

    // 6. Update Tow Request -> COMPLETED
    towingRepository.updateTowRequest(assignment.tow_request_id, {
      status: TowRequestStatus.COMPLETED,
      completed_at: now,
      updated_at: now,
    });

    // 7. Log Activity
    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: assignment.tow_request_id,
      tow_assignment_id: params.assignment_id,
      activity_type: 'DELIVERY_CONFIRMED',
      actor_id: actor?.id || params.provider_id,
      actor_type: 'OPERATOR',
      actor_name: actor?.name || assignment.operator_name || 'Tow Operator',
      title: 'Vehicle delivery confirmed & custody transferred',
      details: `Recipient: ${params.recipient_name} (${params.recipient_type}) | Destination: ${dest?.address_summary || 'Facility'}`,
      created_at: now,
    });

    // 8. Project onto Vehicle Timeline (Privacy-Safe fact)
    const insp = towingRepository.getInspectionByAssignmentId(params.assignment_id);
    const odoReading = insp?.odometer_reading_km;

    const timelineEntry: VehicleTimelineEntryEntity = {
      id: `vte_tow_${assignment.tow_request_id}`,
      vehicle_id: towReq.vehicle_id,
      entry_type: TimelineEntryType.TOW_COMPLETED,
      category: TimelineCategory.ROADSIDE,
      occurred_at: now,
      recorded_at: now,
      title: 'Vehicle Tow Completed',
      summary: `Vehicle recovered following ${towReq.tow_reason.toLowerCase().replace(/_/g, ' ')} and delivered to ${dest?.address_summary || 'designated repair facility'}.`,
      source_type: TimelineSourceType.PROVIDER_RECORDED,
      source_reference_type: 'TOW_ASSIGNMENT',
      source_reference_id: assignment.id,
      source_event_id: `tow_completed_${assignment.tow_request_id}`,
      actor_type: CanonicalActorType.MOBILE_MECHANIC_TOW_PROVIDER,
      actor_id: params.provider_id,
      organization_id: dest?.provider_id || null,
      verification_status: TimelineVerificationStatus.PROVIDER_RECORDED,
      confidence: 1.0,
      odometer_value: odoReading != null ? Math.round(odoReading) : null,
      odometer_unit: odoReading != null ? OdometerUnit.KM : null,
      location_reference: dest?.address_summary || null,
      visibility: TimelineVisibility.PUBLIC_SHAREABLE,
      sensitivity: TimelineSensitivity.NORMAL,
      supersedes_timeline_entry_id: null,
      corrected_by_timeline_entry_id: null,
      is_active: true,
      metadata: { tow_request_id: assignment.tow_request_id, destination: dest?.address_summary },
      created_at: now,
      updated_at: now,
    };
    timelineRepository.insertTimelineEntry(timelineEntry);
    try {
      passportBuilder.buildPassport(towReq.vehicle_id);
    } catch {
      // Best effort passport rebuild
    }

    // 9. Emit canonical events
    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.delivery.confirmed',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          vehicle: towReq.vehicle_id,
          tow_request: assignment.tow_request_id,
          assignment: params.assignment_id,
          provider: params.provider_id,
        },
        actor_id: actor?.id || params.provider_id,
        payload: {
          tow_request_id: assignment.tow_request_id,
          assignment_id: params.assignment_id,
          recipient_name: params.recipient_name,
          recipient_type: params.recipient_type,
          delivered_at: now,
          destination_summary: dest?.address_summary,
        },
      })
    );

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.completed',
        correlation_id: assignment.tow_request_id,
        subject_ids: {
          vehicle: towReq.vehicle_id,
          tow_request: assignment.tow_request_id,
          provider: params.provider_id,
        },
        actor_id: actor?.id || params.provider_id,
        payload: {
          tow_request_id: assignment.tow_request_id,
          vehicle_id: towReq.vehicle_id,
          completed_at: now,
          destination_summary: dest?.address_summary,
        },
      })
    );

    return towingRepository.getFullTowAggregate(assignment.tow_request_id)!;
  }

  /**
   * 16. Update Destination (Controlled Revision)
   */
  async updateDestination(
    requestId: string,
    params: {
      destination_type: TowDestinationType;
      provider_id?: string;
      branch_id?: string;
      address_summary: string;
      latitude?: number;
      longitude?: number;
      contact_name?: string;
      contact_phone?: string;
      instructions?: string;
      reason: string;
    },
    actor?: TowActorContext
  ): Promise<TowDestinationEntity> {
    const towReq = towingRepository.getTowRequestById(requestId);
    if (!towReq) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Tow request ${requestId} not found`);
    }

    if (towReq.status === TowRequestStatus.COMPLETED || towReq.status === TowRequestStatus.CANCELLED) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, `Cannot update destination for ${towReq.status} tow request`);
    }

    const currentDest = towingRepository.getDestinationByRequestId(requestId);
    const now = getCurrentUtcIsoString();
    const newDestId = generateCanonicalId('td');
    const nextRevision = (currentDest?.revision_number || 1) + 1;

    // Create New Destination
    const newDest = towingRepository.createDestination({
      id: newDestId,
      tow_request_id: requestId,
      destination_type: params.destination_type,
      provider_id: params.provider_id || null,
      branch_id: params.branch_id || null,
      location_reference_id: null,
      address_summary: params.address_summary,
      latitude: params.latitude || null,
      longitude: params.longitude || null,
      contact_name: params.contact_name || null,
      contact_phone: params.contact_phone || null,
      instructions: params.instructions || null,
      revision_number: nextRevision,
      created_at: now,
      updated_at: now,
    });

    // Record Revision
    if (currentDest) {
      towingRepository.createDestinationRevision({
        id: generateCanonicalId('tdr'),
        tow_request_id: requestId,
        previous_destination_id: currentDest.id,
        new_destination_id: newDestId,
        changed_by_user_id: actor?.id || 'USER',
        changed_by_role: actor?.roles?.[0] || 'OWNER',
        reason: params.reason,
        created_at: now,
      });
    }

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: requestId,
      activity_type: 'DESTINATION_CHANGED',
      actor_id: actor?.id || 'USER',
      actor_type: 'USER',
      actor_name: actor?.name || 'Authorized Actor',
      title: 'Tow destination updated',
      details: `New destination: ${params.address_summary} | Reason: ${params.reason}`,
      created_at: now,
    });

    return newDest;
  }

  /**
   * 17. Cancel Tow Request
   */
  async cancelTowRequest(
    requestId: string,
    params: {
      cancelled_by_user_id: string;
      cancelled_by_role: string;
      reason: string;
      notes?: string;
    },
    actor?: TowActorContext
  ): Promise<TowRequestEntity> {
    const towReq = towingRepository.getTowRequestById(requestId);
    if (!towReq) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Tow request ${requestId} not found`);
    }

    if (towReq.status === TowRequestStatus.COMPLETED || towReq.status === TowRequestStatus.CANCELLED) {
      throw new CanonicalAppError(ErrorCode.CONFLICT, `Tow request is already ${towReq.status}`);
    }

    const now = getCurrentUtcIsoString();
    // GAR-015/GAR-024 boundary: cancellation may have financial consequences,
    // but Towing must not invent a fee without an authoritative accepted policy/quote.
    const calloutFeeIncurredMinor = 0;
    const activeAssignment = towingRepository.getActiveAssignmentForRequest(requestId);

    if (activeAssignment) {
      // Mark assignment cancelled
      towingRepository.updateAssignment(activeAssignment.id, {
        status: TowAssignmentStatus.CANCELLED,
        updated_at: now,
      });

      // Release recovery unit -> AVAILABLE
      towingRepository.updateRecoveryUnit(activeAssignment.recovery_unit_id, {
        status: RecoveryUnitStatus.AVAILABLE,
        updated_at: now,
      });
    }

    // Cancel pending offers
    const offers = towingRepository.listOffersByRequestId(requestId);
    for (const offer of offers) {
      if (offer.status === TowOfferStatus.OFFERED || offer.status === TowOfferStatus.VIEWED) {
        towingRepository.updateOffer(offer.id, {
          status: TowOfferStatus.CANCELLED,
        });
      }
    }

    // Record Cancellation
    towingRepository.createCancellation({
      id: generateCanonicalId('tc'),
      tow_request_id: requestId,
      cancelled_by_user_id: params.cancelled_by_user_id,
      cancelled_by_role: params.cancelled_by_role,
      reason: params.reason,
      assignment_state_at_cancellation: activeAssignment?.status || null,
      callout_fee_incurred_minor: calloutFeeIncurredMinor,
      currency: 'KES',
      notes: params.notes || null,
      cancelled_at: now,
    });

    // Update Tow Request
    towingRepository.updateTowRequest(requestId, {
      status: TowRequestStatus.CANCELLED,
      cancelled_at: now,
      updated_at: now,
    });

    towingRepository.logActivity({
      id: generateCanonicalId('tact'),
      tow_request_id: requestId,
      activity_type: 'TOW_CANCELLED',
      actor_id: params.cancelled_by_user_id,
      actor_type: 'USER',
      actor_name: actor?.name || 'User',
      title: 'Tow request cancelled',
      details: `Reason: ${params.reason}; cancellation fee not assessed by Towing domain`,
      created_at: now,
    });

    eventBus.publish(
      createCanonicalEventEnvelope({
        type: 'tow.cancelled',
        correlation_id: requestId,
        subject_ids: {
          vehicle: towReq.vehicle_id,
          tow_request: requestId,
        },
        actor_id: params.cancelled_by_user_id,
        payload: {
          tow_request_id: requestId,
          reason: params.reason,
          callout_fee_incurred_minor: calloutFeeIncurredMinor,
          fee_status: 'NOT_ASSESSED',
        },
      })
    );

    return towingRepository.getTowRequestById(requestId)!;
  }

  /**
   * 18. Safe Scoped DTO Retrieval (Location Privacy Enforcement)
   */
  getTowRequestById(requestId: string, actor?: TowActorContext): FullTowAggregate | null {
    const aggregate = towingRepository.getFullTowAggregate(requestId);
    if (!aggregate) return null;

    // Location privacy rule:
    // If actor is not the owner/requester, admin, or the assigned provider/operator,
    // they receive obfuscated coordinates and contact info is masked.
    const isOwner =
      Boolean(actor?.id && actor.id === aggregate.request.requesting_user_id) ||
      Boolean((actor as any)?.user_id && (actor as any).user_id === aggregate.request.requesting_user_id);
    const isAdmin = Boolean(actor?.roles?.includes('ADMIN') || actor?.roles?.includes('GARAGE_STAFF'));
    const isAssigned =
      Boolean(
        actor?.provider_id &&
          (aggregate.request.assigned_provider_id === actor.provider_id ||
            aggregate.active_assignment?.provider_id === actor.provider_id)
      ) ||
      Boolean(
        actor?.id &&
          (aggregate.active_assignment?.operator_staff_id === actor.id ||
            (aggregate.active_assignment as any)?.assigned_operator_user_id === actor.id)
      );

    if (!isOwner && !isAdmin && !isAssigned && aggregate.pickup_location) {
      // Obfuscate location: round to 2 decimal places (~1.1 km accuracy), strip access instructions
      const obfuscatedPickup: any = {
        ...aggregate.pickup_location,
        latitude: Math.round(aggregate.pickup_location.latitude * 100) / 100,
        longitude: Math.round(aggregate.pickup_location.longitude * 100) / 100,
        access_notes: null,
        landmark: null,
      };
      delete obfuscatedPickup.access_instructions;

      return {
        ...aggregate,
        pickup_location: obfuscatedPickup,
        destination: aggregate.destination
          ? {
              ...aggregate.destination,
              contact_phone: null,
            }
          : null,
      };
    }

    return aggregate;
  }

  /**
   * 19. Recovery Unit Registration & Fleet Management
   */
  registerRecoveryUnit(
    providerId: string,
    params: {
      unit_type: RecoveryUnitType;
      registration_identifier: string;
      fleet_identifier?: string;
      max_vehicle_weight_kg?: number;
      max_vehicle_length_mm?: number;
      max_vehicle_width_mm?: number;
      equipment?: Array<{ equipment_type: EquipmentType; rating_capacity_kg?: number; is_operational?: boolean }>;
      supported_classes?: TowVehicleClass[];
    }
  ): RecoveryUnitEntity {
    const now = getCurrentUtcIsoString();
    const unitId = generateCanonicalId('ru');

    const unit: RecoveryUnitEntity = {
      id: unitId,
      provider_id: providerId,
      unit_type: params.unit_type,
      registration_identifier: params.registration_identifier,
      fleet_identifier: params.fleet_identifier || null,
      status: RecoveryUnitStatus.AVAILABLE,
      max_vehicle_weight_kg: params.max_vehicle_weight_kg || null,
      max_vehicle_length_mm: params.max_vehicle_length_mm || null,
      max_vehicle_width_mm: params.max_vehicle_width_mm || null,
      created_at: now,
      updated_at: now,
    };
    towingRepository.createRecoveryUnit(unit);

    if (params.equipment && params.equipment.length > 0) {
      for (const eq of params.equipment) {
        towingRepository.createUnitEquipment({
          id: generateCanonicalId('rue'),
          recovery_unit_id: unitId,
          equipment_type: eq.equipment_type,
          rating_capacity_kg: eq.rating_capacity_kg || null,
          is_operational: eq.is_operational !== false,
          created_at: now,
        });
      }
    }

    if (params.supported_classes && params.supported_classes.length > 0) {
      for (const cls of params.supported_classes) {
        towingRepository.createUnitClassSupport({
          id: generateCanonicalId('rucs'),
          recovery_unit_id: unitId,
          vehicle_class: cls,
        });
      }
    }

    return unit;
  }

  listProviderRecoveryUnits(providerId: string): Array<
    RecoveryUnitEntity & {
      equipment: RecoveryUnitEquipmentEntity[];
      supported_classes: TowVehicleClass[];
    }
  > {
    const units = towingRepository.listRecoveryUnitsByProvider(providerId);
    return units.map((u) => ({
      ...u,
      equipment: towingRepository.listUnitEquipment(u.id),
      supported_classes: towingRepository.listUnitSupportedClasses(u.id),
    }));
  }
}

export const towingService = new TowingService();
