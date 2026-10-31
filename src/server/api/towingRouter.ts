/**
 * Canonical Towing & Recovery API Router (GAR-015, GAR-034)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { towingService, TowActorContext } from '../towing/towingService';
import { towingRepository } from '../towing/towingRepository';
import { TowingCompatibilityEngine } from '../towing/compatibilityEngine';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  AccountStatus,
  AuthenticatedActorContext,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
} from '../identity/types';
import {
  TowRequestStatus,
  TowOfferStatus,
  TowAssignmentStatus,
  RecoveryUnitStatus,
  TowReason,
  RecoveryType,
  VehicleMobilityState,
  VehicleConditionState,
  TowDestinationType,
  RecoveryUnitType,
  EquipmentType,
  TowVehicleClass,
  TowPickupEvidenceType,
  TowDeliveryRecipientType,
  TowDeliveryAcknowledgementMethod,
  TowDeliveryEvidenceType,
  TowFailureType,
} from '../towing/types';

export const towingRouter = Router();

// Middleware: Authenticate actor context (with optional mode for local dev flexibility)
// Towing operations are safety-sensitive and always require a canonical session.
towingRouter.use(authenticate());

function getActor(req: Request): TowActorContext & { actor_id: string; roles: string[] } {
  const roles: string[] = [];
  if (req.actor!.active_membership?.role) roles.push(req.actor!.active_membership.role);
  if (req.actor!.platform_roles) roles.push(...req.actor!.platform_roles);
  return {
    id: req.actor!.user_id || req.actor!.id,
    actor_id: req.actor!.user_id || req.actor!.id,
    name: req.actor!.profile.display_name || req.actor!.email,
    roles,
    provider_id: req.headers['x-provider-id'] as string | undefined,
  };
}

// -----------------------------------------------------------------------------
// 1. Tow Requests
// -----------------------------------------------------------------------------

/**
 * Create a new standalone tow request
 * POST /api/v1/towing/requests
 */
towingRouter.post('/towing/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const {
      vehicle_id,
      tow_reason,
      recovery_type,
      vehicle_mobility_state,
      vehicle_condition_state,
      pickup_location,
      destination,
      preferred_provider_id,
      related_issue_id,
      special_instructions,
    } = req.body;

    if (!vehicle_id || !tow_reason || !pickup_location || !destination) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: vehicle_id, tow_reason, pickup_location, destination'
      );
    }

    const aggregate = await towingService.createTowRequest(
      {
        vehicle_id,
        requesting_user_id: actor.id,
        organization_id: (req.actor?.active_membership?.organization_id as string) || undefined,
        tow_reason,
        recovery_type,
        vehicle_mobility_state,
        vehicle_condition_state,
        preferred_provider_id,
        related_issue_id,
        special_instructions,
        pickup_location,
        destination,
      },
      actor
    );

    res.status(201).json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

/**
 * Create a tow request from a roadside assistance handoff
 * POST /api/v1/towing/requests/from-roadside
 */
towingRouter.post('/towing/requests/from-roadside', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { incident_id, tow_reason, destination } = req.body;

    if (!incident_id || !destination) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: incident_id, destination'
      );
    }

    const aggregate = await towingService.createFromRoadsideHandoff(
      {
        incident_id,
        requesting_user_id: actor.id,
        tow_reason,
        destination,
      },
      actor
    );

    res.status(201).json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

/**
 * List tow requests
 * GET /api/v1/towing/requests
 */
towingRouter.get('/towing/requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { vehicle_id, requesting_user_id, status, assigned_provider_id, organization_id } = req.query;

    const requests = towingRepository.listTowRequests({
      vehicle_id: vehicle_id as string | undefined,
      requesting_user_id: requesting_user_id as string | undefined,
      organization_id: organization_id as string | undefined,
      status: status as TowRequestStatus | undefined,
      assigned_provider_id: assigned_provider_id as string | undefined,
    });

    res.json({ success: true, data: requests });
  } catch (err) {
    next(err);
  }
});

/**
 * Get tow request details (with scoped location privacy)
 * GET /api/v1/towing/requests/:id
 */
towingRouter.get('/towing/requests/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const aggregate = towingService.getTowRequestById(req.params.id, actor);

    if (!aggregate) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Tow request ${req.params.id} not found`);
    }

    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

/**
 * Update tow destination (controlled revision)
 * PATCH /api/v1/towing/requests/:id/destination
 */
towingRouter.patch('/towing/requests/:id/destination', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const {
      destination_type,
      provider_id,
      branch_id,
      address_summary,
      latitude,
      longitude,
      contact_name,
      contact_phone,
      instructions,
      reason,
    } = req.body;

    if (!destination_type || !address_summary || !reason) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: destination_type, address_summary, reason'
      );
    }

    const updatedDest = await towingService.updateDestination(
      req.params.id,
      {
        destination_type,
        provider_id,
        branch_id,
        address_summary,
        latitude,
        longitude,
        contact_name,
        contact_phone,
        instructions,
        reason,
      },
      actor
    );

    res.json({ success: true, data: updatedDest });
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel tow request
 * POST /api/v1/towing/requests/:id/cancel
 */
towingRouter.post('/towing/requests/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { reason, notes } = req.body;

    if (!reason) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Reason is required for cancellation');
    }

    const cancelledReq = await towingService.cancelTowRequest(
      req.params.id,
      {
        cancelled_by_user_id: actor.id,
        cancelled_by_role: actor.roles?.[0] || 'OWNER',
        reason,
        notes,
      },
      actor
    );

    res.json({ success: true, data: cancelledReq });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 2. Provider Offers & Concurrency Guard
// -----------------------------------------------------------------------------

/**
 * Accept a tow offer
 * POST /api/v1/towing/offers/:id/accept
 */
towingRouter.post('/towing/offers/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { provider_id, operator_staff_id, operator_name, operator_phone } = req.body;

    const resolvedProviderId = provider_id || actor.provider_id;
    if (!resolvedProviderId) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'provider_id is required to accept offer');
    }

    const assignment = await towingService.acceptOffer(
      {
        offer_id: req.params.id,
        provider_id: resolvedProviderId,
        operator_staff_id,
        operator_name,
        operator_phone,
      },
      actor
    );

    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    next(err);
  }
});

/**
 * Decline a tow offer
 * POST /api/v1/towing/offers/:id/decline
 */
towingRouter.post('/towing/offers/:id/decline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { provider_id, reason } = req.body;

    const resolvedProviderId = provider_id || actor.provider_id;
    if (!resolvedProviderId) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'provider_id is required to decline offer');
    }

    await towingService.declineOffer(req.params.id, resolvedProviderId, reason);
    res.json({ success: true, message: 'Offer declined' });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 3. Assignment Lifecycle & Chain-of-Custody
// -----------------------------------------------------------------------------

/**
 * Mark recovery unit en-route to pickup
 * POST /api/v1/towing/assignments/:id/en-route
 */
towingRouter.post('/towing/assignments/:id/en-route', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.markEnRoute(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Mark arrival at pickup location
 * POST /api/v1/towing/assignments/:id/arrived-pickup
 */
towingRouter.post('/towing/assignments/:id/arrived-pickup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.arrivePickup(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Record pre-tow pickup inspection and evidence
 * POST /api/v1/towing/assignments/:id/inspections
 */
towingRouter.post('/towing/assignments/:id/inspections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const { vehicle_condition_summary, visible_damage, mobility_state_confirmed, odometer_reading_km, notes, evidence } =
      req.body;

    if (!vehicle_condition_summary || !mobility_state_confirmed) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: vehicle_condition_summary, mobility_state_confirmed'
      );
    }

    const inspection = await towingService.recordPickupInspection(
      {
        assignment_id: req.params.id,
        provider_id: assignment.provider_id,
        vehicle_condition_summary,
        visible_damage,
        mobility_state_confirmed,
        odometer_reading_km,
        notes,
        evidence,
      },
      actor
    );

    res.status(201).json({ success: true, data: inspection });
  } catch (err) {
    next(err);
  }
});

/**
 * Start loading vehicle onto recovery unit
 * POST /api/v1/towing/assignments/:id/start-loading
 */
towingRouter.post('/towing/assignments/:id/start-loading', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.startLoading(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirm vehicle loaded & initial custody transfer
 * POST /api/v1/towing/assignments/:id/confirm-loaded
 */
towingRouter.post('/towing/assignments/:id/confirm-loaded', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.confirmVehicleLoaded(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Record loading failure (structured failure recovery path)
 * POST /api/v1/towing/assignments/:id/loading-failure
 */
towingRouter.post('/towing/assignments/:id/loading-failure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const { failure_type, description, recoverable } = req.body;
    if (!failure_type || !description) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Missing required fields: failure_type, description');
    }

    const failure = await towingService.recordLoadingFailure(
      {
        assignment_id: req.params.id,
        provider_id: assignment.provider_id,
        failure_type,
        description,
        recoverable,
      },
      actor
    );

    res.status(201).json({ success: true, data: failure });
  } catch (err) {
    next(err);
  }
});

/**
 * Start transit to destination (Critical Truth Principle Enforced)
 * POST /api/v1/towing/assignments/:id/start-transit
 */
towingRouter.post('/towing/assignments/:id/start-transit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.startTransit(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Arrive at destination
 * POST /api/v1/towing/assignments/:id/arrived-destination
 */
towingRouter.post('/towing/assignments/:id/arrived-destination', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.arriveDestination(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Start unloading at destination
 * POST /api/v1/towing/assignments/:id/start-unloading
 */
towingRouter.post('/towing/assignments/:id/start-unloading', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const updated = await towingService.startUnloading(req.params.id, assignment.provider_id, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirm delivery, handover custody, and project to vehicle timeline
 * POST /api/v1/towing/assignments/:id/confirm-delivery
 */
towingRouter.post('/towing/assignments/:id/confirm-delivery', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const assignment = towingRepository.getAssignmentById(req.params.id);
    if (!assignment) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Assignment ${req.params.id} not found`);
    }

    const {
      recipient_type,
      recipient_name,
      recipient_id,
      recipient_signature_reference,
      destination_provider_id,
      destination_branch_id,
      condition_summary,
      acknowledgement_method,
      service_case_handoff_id,
      evidence,
    } = req.body;

    if (!recipient_type || !recipient_name || !condition_summary || !acknowledgement_method) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: recipient_type, recipient_name, condition_summary, acknowledgement_method'
      );
    }

    const aggregate = await towingService.confirmDelivery(
      {
        assignment_id: req.params.id,
        provider_id: assignment.provider_id,
        recipient_type,
        recipient_name,
        recipient_id,
        recipient_signature_reference,
        destination_provider_id,
        destination_branch_id,
        condition_summary,
        acknowledgement_method,
        service_case_handoff_id,
        evidence,
      },
      actor
    );

    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// 4. Recovery Units & Fleet Management
// -----------------------------------------------------------------------------

/**
 * Register a recovery unit for a provider
 * POST /api/v1/towing/recovery-units
 */
towingRouter.post('/towing/recovery-units', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const {
      provider_id,
      unit_type,
      registration_identifier,
      fleet_identifier,
      max_vehicle_weight_kg,
      max_vehicle_length_mm,
      max_vehicle_width_mm,
      equipment,
      supported_classes,
    } = req.body;

    const resolvedProviderId = provider_id || actor.provider_id;
    if (!resolvedProviderId || !unit_type || !registration_identifier) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: provider_id, unit_type, registration_identifier'
      );
    }

    const unit = towingService.registerRecoveryUnit(resolvedProviderId, {
      unit_type,
      registration_identifier,
      fleet_identifier,
      max_vehicle_weight_kg,
      max_vehicle_length_mm,
      max_vehicle_width_mm,
      equipment,
      supported_classes,
    });

    res.status(201).json({ success: true, data: unit });
  } catch (err) {
    next(err);
  }
});

/**
 * List recovery units for a provider
 * GET /api/v1/towing/providers/:providerId/recovery-units
 */
towingRouter.get('/towing/providers/:providerId/recovery-units', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const units = towingService.listProviderRecoveryUnits(req.params.providerId);
    res.json({ success: true, data: units });
  } catch (err) {
    next(err);
  }
});

/**
 * Direct truck-vehicle compatibility check endpoint
 * POST /api/v1/towing/compatibility-check
 */
towingRouter.post('/towing/compatibility-check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { vehicle, recovery_unit_id } = req.body;

    if (!vehicle || !recovery_unit_id) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Missing required fields: vehicle, recovery_unit_id');
    }

    const unit = towingRepository.getRecoveryUnitById(recovery_unit_id);
    if (!unit) {
      throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, `Recovery unit ${recovery_unit_id} not found`);
    }

    const equipment = towingRepository.listUnitEquipment(unit.id);
    const classes = towingRepository.listUnitSupportedClasses(unit.id);
    const evaluation = TowingCompatibilityEngine.evaluate(vehicle, unit, equipment, classes);

    res.json({ success: true, data: evaluation });
  } catch (err) {
    next(err);
  }
});
