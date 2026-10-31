/**
 * Canonical Vehicle Issue, Fault & Persistent Problem API Router (GAR-008, GAR-034)
 */

import { Router, Request, Response } from 'express';
import { authenticate } from './authMiddleware';
import { issueService } from '../issues/issueService';
import { issueRepository } from '../issues/issueRepository';
import { vehicleService } from '../vehicle/vehicleService';
import {
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  IssuePersistenceState,
  SymptomCategory,
  IssueInterventionType,
  IssueResolutionType,
} from '../issues/types';
import { CanonicalActorType } from '../../shared/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { logger } from '../observability/logger';

export const issueRouter = Router();

// Middleware: Authenticate for all endpoints (optional in dev, extracts actor)
issueRouter.use(authenticate());
issueRouter.use('/vehicles/:id', (req, _res, next) => {
  try {
    vehicleService.getVehicleDetails(req.actor!, req.params.id);
    next();
  } catch (err) {
    next(err);
  }
});

function getActorInfo(req: Request): { actorId: string; actorType: CanonicalActorType } {
  const actorId = req.actor!.id || req.actor!.user_id;
  const actorType = (req.actor!.type as CanonicalActorType) || CanonicalActorType.VEHICLE_OWNER;
  return { actorId, actorType };
}

/**
 * 1. GET /api/v1/vehicles/:id/issues
 * Lists all issues for a vehicle with optional status, category, severity, persistence filters
 */
issueRouter.get('/vehicles/:id/issues', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const { status, category, severity, persistence_state } = req.query;

    const issues = issueRepository.listIssuesForVehicle(vehicleId, {
      status: typeof status === 'string' ? status : undefined,
      category: typeof category === 'string' ? category : undefined,
      severity: typeof severity === 'string' ? severity : undefined,
      persistence_state: typeof persistence_state === 'string' ? persistence_state : undefined,
    });

    res.json({
      success: true,
      data: issues,
      meta: {
        total: issues.length,
        active_count: issueRepository.countActiveIssuesForVehicle(vehicleId),
        persistent_count: issueRepository.countPersistentIssuesForVehicle(vehicleId),
      },
    });
  } catch (err) {
    logger.error(`Failed to list vehicle issues: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list vehicle issues',
    });
  }
});

/**
 * 2. POST /api/v1/vehicles/:id/issues
 * Reports a new issue with initial occurrence & safety screening
 */
issueRouter.post('/vehicles/:id/issues', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const body = req.body;

    if (!body.title || !body.category || !body.summary) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'title, summary, and category are required',
        400
      );
    }

    const { actorId, actorType } = getActorInfo(req);

    const issue = issueService.reportIssue(
      vehicleId,
      {
        title: body.title,
        summary: body.summary,
        category: body.category as IssueCategory,
        severity: body.severity as IssueSeverity,
        primary_component_category: body.primary_component_category,
        occurred_at: body.occurred_at,
        odometer_value: body.odometer_value !== undefined ? Number(body.odometer_value) : undefined,
        odometer_unit: body.odometer_unit,
        symptom_category: body.symptom_category as SymptomCategory,
        driving_condition: body.driving_condition,
        speed_range: body.speed_range,
        engine_temperature_state: body.engine_temperature_state,
        weather_context: body.weather_context,
        road_condition: body.road_condition,
        symptom_description: body.symptom_description,
      },
      actorId,
      actorType
    );

    res.status(201).json({
      success: true,
      data: issue,
    });
  } catch (err) {
    logger.error(`Failed to report vehicle issue: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to report vehicle issue',
    });
  }
});

/**
 * 3. GET /api/v1/vehicles/:id/issues/active
 * Returns all active issues (reported, acknowledged, diagnosed, in_repair, monitoring, recurred)
 */
issueRouter.get('/vehicles/:id/issues/active', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const activeIssues = issueRepository.listActiveIssuesForVehicle(vehicleId);

    res.json({
      success: true,
      data: activeIssues,
      count: activeIssues.length,
    });
  } catch (err) {
    logger.error(`Failed to list active issues: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list active issues',
    });
  }
});

/**
 * 4. GET /api/v1/vehicles/:id/issues/persistent
 * Returns issues that have persisted across repeat occurrences or recurrences
 */
issueRouter.get('/vehicles/:id/issues/persistent', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const persistentIssues = issueRepository.listPersistentIssuesForVehicle(vehicleId);

    res.json({
      success: true,
      data: persistentIssues,
      count: persistentIssues.length,
    });
  } catch (err) {
    logger.error(`Failed to list persistent issues: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list persistent issues',
    });
  }
});

/**
 * 5. GET /api/v1/vehicles/:id/issues/:issueId
 * Returns complete enriched issue with occurrences, diagnoses, interventions, follow-ups
 */
issueRouter.get('/vehicles/:id/issues/:issueId', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const issue = issueService.getEnrichedIssue(issueId);

    if (issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Issue does not belong to vehicle', 404);
    }

    res.json({
      success: true,
      data: issue,
    });
  } catch (err) {
    logger.error(`Failed to get vehicle issue: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve vehicle issue',
    });
  }
});

/**
 * 6. GET /api/v1/vehicles/:id/issues/:issueId/chronology
 * Returns chronological timeline history for a specific issue
 */
issueRouter.get('/vehicles/:id/issues/:issueId/chronology', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const issue = issueRepository.getIssueById(issueId);

    if (!issue || issue.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Issue not found on this vehicle', 404);
    }

    const chronology = issueService.getIssueChronology(issueId);

    res.json({
      success: true,
      data: chronology,
    });
  } catch (err) {
    logger.error(`Failed to get issue chronology: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve issue chronology',
    });
  }
});

/**
 * 7. POST /api/v1/vehicles/:id/issues/:issueId/occurrences
 * "It happened again" fast occurrence logger
 */
issueRouter.post('/vehicles/:id/issues/:issueId/occurrences', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const body = req.body;

    if (!body.description) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Symptom description is required', 400);
    }

    const { actorId, actorType } = getActorInfo(req);

    const enriched = issueService.recordOccurrence(
      vehicleId,
      issueId,
      {
        description: body.description,
        occurred_at: body.occurred_at,
        odometer_value: body.odometer_value !== undefined ? Number(body.odometer_value) : undefined,
        odometer_unit: body.odometer_unit,
        symptom_category: body.symptom_category as SymptomCategory,
        driving_condition: body.driving_condition,
        speed_range: body.speed_range,
        engine_temperature_state: body.engine_temperature_state,
        weather_context: body.weather_context,
        road_condition: body.road_condition,
      },
      actorId,
      actorType
    );

    res.status(201).json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to record occurrence: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record symptom occurrence',
    });
  }
});

/**
 * 8. POST /api/v1/vehicles/:id/issues/:issueId/diagnoses
 * Records a professional diagnostic conclusion by workshop
 */
issueRouter.post('/vehicles/:id/issues/:issueId/diagnoses', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const body = req.body;

    if (!body.provider_name || !body.diagnosis_summary || !body.diagnosis_details) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'provider_name, diagnosis_summary, and diagnosis_details are required',
        400
      );
    }

    const { actorId } = getActorInfo(req);
    const actorType = (req.actor?.type as CanonicalActorType) || CanonicalActorType.GARAGE_STAFF;

    const enriched = issueService.recordDiagnosis(
      vehicleId,
      issueId,
      {
        provider_id: body.provider_id,
        provider_name: body.provider_name,
        technician_id: body.technician_id,
        technician_name: body.technician_name,
        diagnosed_at: body.diagnosed_at,
        diagnosis_code: body.diagnosis_code,
        diagnosis_summary: body.diagnosis_summary,
        diagnosis_details: body.diagnosis_details,
        confirmed_component: body.confirmed_component,
        outcome: body.outcome,
        source_work_order_id: body.source_work_order_id,
      },
      actorId,
      actorType
    );

    res.status(201).json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to record diagnosis: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record diagnosis',
    });
  }
});

/**
 * 9. POST /api/v1/vehicles/:id/issues/:issueId/interventions
 * Records a repair/corrective intervention attempt.
 * Crucial: transitions issue to MONITORING (does not auto-resolve).
 */
issueRouter.post('/vehicles/:id/issues/:issueId/interventions', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const body = req.body;

    if (!body.intervention_type || !body.description) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'intervention_type and description are required',
        400
      );
    }

    const { actorId } = getActorInfo(req);
    const actorType = (req.actor?.type as CanonicalActorType) || CanonicalActorType.GARAGE_STAFF;

    const enriched = issueService.recordIntervention(
      vehicleId,
      issueId,
      {
        intervention_type: body.intervention_type as IssueInterventionType,
        description: body.description,
        performed_at: body.performed_at,
        odometer_value: body.odometer_value !== undefined ? Number(body.odometer_value) : undefined,
        odometer_unit: body.odometer_unit,
        provider_id: body.provider_id,
        provider_name: body.provider_name,
        work_order_id: body.work_order_id,
        replaced_part_names: Array.isArray(body.replaced_part_names) ? body.replaced_part_names : [],
        cost_total: body.cost_total !== undefined ? Number(body.cost_total) : undefined,
        currency: body.currency,
        result: body.result,
        notes: body.notes,
        schedule_followup_days: body.schedule_followup_days,
        schedule_followup_km: body.schedule_followup_km,
      },
      actorId,
      actorType
    );

    res.status(201).json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to record intervention: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record intervention',
    });
  }
});

/**
 * 10. POST /api/v1/vehicles/:id/issues/:issueId/resolve
 * Explicit issue resolution record after observation
 */
issueRouter.post('/vehicles/:id/issues/:issueId/resolve', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const body = req.body;

    if (!body.resolution_type || !body.resolution_summary) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'resolution_type and resolution_summary are required',
        400
      );
    }

    const { actorId, actorType } = getActorInfo(req);

    const enriched = issueService.resolveIssue(
      vehicleId,
      issueId,
      {
        resolution_type: body.resolution_type as IssueResolutionType,
        resolution_summary: body.resolution_summary,
        resolved_at: body.resolved_at,
        resolved_odometer_km: body.resolved_odometer_km !== undefined ? Number(body.resolved_odometer_km) : undefined,
        notes: body.notes,
      },
      actorId,
      actorType
    );

    res.json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to resolve issue: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to resolve issue',
    });
  }
});

/**
 * 11. POST /api/v1/vehicles/:id/issues/:issueId/recur
 * Reopens a resolved issue when symptom returns
 */
issueRouter.post('/vehicles/:id/issues/:issueId/recur', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId } = req.params;
    const body = req.body;

    if (!body.description) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Symptom description is required', 400);
    }

    const { actorId, actorType } = getActorInfo(req);

    const enriched = issueService.recurIssue(
      vehicleId,
      issueId,
      {
        description: body.description,
        recurred_at: body.recurred_at,
        odometer_value: body.odometer_value !== undefined ? Number(body.odometer_value) : undefined,
        odometer_unit: body.odometer_unit,
        driving_condition: body.driving_condition,
        speed_range: body.speed_range,
      },
      actorId,
      actorType
    );

    res.json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to recur issue: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to mark issue as recurred',
    });
  }
});

/**
 * 12. POST /api/v1/vehicles/:id/issues/:issueId/followups/:followupId/response
 * Responds to a post-repair follow-up check ("Still happening?")
 */
issueRouter.post('/vehicles/:id/issues/:issueId/followups/:followupId/response', (req: Request, res: Response) => {
  try {
    const { id: vehicleId, issueId, followupId } = req.params;
    const { response, notes } = req.body;

    if (!response) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'response (YES | NO | NOT_SURE) is required', 400);
    }

    const { actorId } = getActorInfo(req);

    const enriched = issueService.respondToFollowup(
      vehicleId,
      issueId,
      followupId,
      {
        response,
        notes,
      },
      actorId
    );

    res.json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    logger.error(`Failed to respond to follow-up: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record follow-up response',
    });
  }
});
