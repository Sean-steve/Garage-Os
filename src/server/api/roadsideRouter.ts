/**
 * Canonical Roadside Assistance API Router (GAR-014, GAR-034)
 *
 * Implements endpoints for:
 * - Driver breakdown reporting & GPS localization
 * - Deterministic safety & drivability triage engine
 * - Dynamic provider search, request broadcasting & offer lifecycle
 * - Dispatching, technician assignments & real-time tracking
 * - On-site intervention recording, roadside repair & tow recovery handoff
 * - Incident cancellation, evidence logging & audit timeline
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { roadsideService } from '../roadside/roadsideService';
import { roadsideRepository } from '../roadside/roadsideRepository';
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
  RoadsideIncidentStatus,
  AssignmentStatus,
  ProviderOfferStatus,
} from '../roadside/types';

export const roadsideRouter = Router();

// Middleware: Authenticate actor context
roadsideRouter.use(authenticate());

function getActor(req: Request): AuthenticatedActorContext & { actor_id: string; roles: string[] } {
  const roles: string[] = [];
  if (req.actor!.active_membership?.role) roles.push(req.actor!.active_membership.role);
  if (req.actor!.platform_roles) roles.push(...req.actor!.platform_roles);
  return {
    ...req.actor!,
    actor_id: req.actor!.user_id || req.actor!.id,
    roles,
  };
}

// ===========================================================================
// 1. Incidents Lifecycle
// ===========================================================================

/**
 * Report a new roadside breakdown incident
 */
roadsideRouter.post('/incidents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { vehicle_id, incident_type, description, reported_by_phone, location, initial_answers } = req.body;

    if (!vehicle_id || !incident_type || !location?.latitude || !location?.longitude) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: vehicle_id, incident_type, location (latitude, longitude)'
      );
    }

    const result = await roadsideService.reportIncident(
      {
        vehicle_id,
        incident_type,
        description,
        reported_by_phone,
        location,
        initial_answers,
      },
      actor
    );

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * List incidents with optional filters
 */
roadsideRouter.get('/incidents', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      vehicle_id: req.query.vehicle_id as string | undefined,
      organization_id: req.query.organization_id as string | undefined,
      reported_by_user_id: req.query.reported_by_user_id as string | undefined,
      status: req.query.status as RoadsideIncidentStatus | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const incidents = roadsideService.listIncidents(filters);
    res.json({ success: true, count: incidents.length, data: incidents });
  } catch (err) {
    next(err);
  }
});

/**
 * Get incident full details aggregate
 */
roadsideRouter.get('/incidents/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const aggregate = roadsideService.getIncidentDetails(req.params.id);
    res.json({ success: true, data: aggregate });
  } catch (err) {
    next(err);
  }
});

/**
 * Conduct Triage for an incident
 */
roadsideRouter.post('/incidents/:id/triage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const answers = req.body.answers || req.body;
    const result = await roadsideService.conductTriage(req.params.id, answers, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Update incident location
 */
roadsideRouter.post('/incidents/:id/location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const locationData = req.body;
    const location = await roadsideService.updateLocation(req.params.id, locationData, actor);
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

/**
 * Request assistance / broadcast to provider network
 */
roadsideRouter.post('/incidents/:id/request-assistance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const result = await roadsideService.requestAssistance(req.params.id, req.body, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Get offers for an incident
 */
roadsideRouter.get('/incidents/:id/offers', (req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = roadsideRepository.getOffersByIncidentId(req.params.id);
    res.json({ success: true, count: offers.length, data: offers });
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel an incident
 */
roadsideRouter.post('/incidents/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { reason, notes } = req.body;
    if (!reason) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Cancellation reason is required');
    }
    const cancelledIncident = await roadsideService.cancelIncident(req.params.id, { reason, notes }, actor);
    res.json({ success: true, data: cancelledIncident });
  } catch (err) {
    next(err);
  }
});

/**
 * Add evidence photo/document
 */
roadsideRouter.post('/incidents/:id/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const evidence = await roadsideService.addEvidence(req.params.id, req.body, actor);
    res.status(201).json({ success: true, data: evidence });
  } catch (err) {
    next(err);
  }
});

/**
 * Get incident activity audit log
 */
roadsideRouter.get('/incidents/:id/activity', (req: Request, res: Response, next: NextFunction) => {
  try {
    const activity = roadsideRepository.getActivityLog(req.params.id);
    res.json({ success: true, count: activity.length, data: activity });
  } catch (err) {
    next(err);
  }
});

// ===========================================================================
// 2. Provider Offers & Assignments Lifecycle
// ===========================================================================

/**
 * Provider responds to offer (Accept / Decline)
 */
roadsideRouter.post('/offers/:id/respond', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { accept, decline_reason, eta_minutes, callout_charge_minor, assigned_technician_name, assigned_technician_phone, assigned_vehicle_reg } = req.body;

    if (accept === undefined) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Field "accept" (boolean) is required');
    }

    const result = await roadsideService.respondToOffer(
      req.params.id,
      Boolean(accept),
      {
        decline_reason,
        eta_minutes,
        callout_charge_minor,
        assigned_technician_name,
        assigned_technician_phone,
        assigned_vehicle_reg,
      },
      actor
    );

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Provider queries pending offers
 */
roadsideRouter.get('/providers/:providerId/offers', (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as ProviderOfferStatus | undefined;
    const offers = roadsideService.getProviderOffers(req.params.providerId, status);
    res.json({ success: true, count: offers.length, data: offers });
  } catch (err) {
    next(err);
  }
});

/**
 * Provider queries assignments
 */
roadsideRouter.get('/providers/:providerId/assignments', (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as AssignmentStatus | undefined;
    const assignments = roadsideService.getProviderAssignments(req.params.providerId, status);
    res.json({ success: true, count: assignments.length, data: assignments });
  } catch (err) {
    next(err);
  }
});

/**
 * Technician updates assignment status & real-time GPS coordinates
 */
roadsideRouter.patch('/assignments/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { status, latitude, longitude, eta_minutes, assigned_technician_name, assigned_technician_phone, assigned_vehicle_reg } = req.body;

    if (!status) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Field "status" is required');
    }

    const updated = await roadsideService.updateAssignmentStatus(
      req.params.id,
      status as AssignmentStatus,
      {
        latitude,
        longitude,
        eta_minutes,
        assigned_technician_name,
        assigned_technician_phone,
        assigned_vehicle_reg,
      },
      actor
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Record on-site intervention, repair actions, parts used & tow handoff
 */
roadsideRouter.post('/assignments/:id/interventions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const {
      result,
      summary_notes,
      labor_duration_minutes,
      final_drivability,
      odometer_reading_km,
      tow_required,
      fee_minor,
      currency,
      actions,
      tow_handoff,
    } = req.body;

    if (!result || !summary_notes || !final_drivability) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Missing required fields: result, summary_notes, final_drivability'
      );
    }

    const recorded = await roadsideService.recordIntervention(
      req.params.id,
      {
        result,
        summary_notes,
        labor_duration_minutes: labor_duration_minutes || 0,
        final_drivability,
        odometer_reading_km,
        tow_required,
        fee_minor,
        currency,
        actions,
        tow_handoff,
      },
      actor
    );

    res.status(201).json({ success: true, data: recorded });
  } catch (err) {
    next(err);
  }
});
