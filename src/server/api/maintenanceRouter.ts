/**
 * Canonical Vehicle Maintenance & Service Intelligence API Router (GAR-006, GAR-034)
 */

import { Router, Request, Response } from 'express';
import { authenticate } from './authMiddleware';
import { maintenanceService } from '../maintenance/maintenanceService';
import { maintenanceRepository } from '../maintenance/maintenanceRepository';
import { vehicleService } from '../vehicle/vehicleService';
import { MaintenanceCategory } from '../maintenance/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { logger } from '../observability/logger';

export const maintenanceRouter = Router();

// Middleware: Authenticate for all endpoints (optional for read, fallback actor in dev)
maintenanceRouter.use(authenticate());
maintenanceRouter.use('/vehicles/:id', (req, _res, next) => {
  try {
    vehicleService.getVehicleDetails(req.actor!, req.params.id);
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * 1. GET /api/v1/vehicles/:id/maintenance/status
 * Returns overall due-state summary, active cycles, and counts
 */
maintenanceRouter.get('/vehicles/:id/maintenance/status', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const summary = maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    logger.error(`Failed to get maintenance status: ${err instanceof Error ? err.message : String(err)}`);
    res.status(err instanceof CanonicalAppError ? err.statusCode : 400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve vehicle maintenance status',
    });
  }
});

/**
 * 2. GET /api/v1/vehicles/:id/maintenance/plan
 * Returns the active maintenance plan and plan entries
 */
maintenanceRouter.get('/vehicles/:id/maintenance/plan', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const plan = maintenanceRepository.getActivePlanForVehicle(vehicleId);
    if (!plan) {
      return res.json({
        success: true,
        data: null,
      });
    }

    const entries = maintenanceRepository.listPlanEntries(plan.id);
    const enrichedEntries = entries.map((entry) => {
      const requirement = maintenanceRepository.getRequirementById(entry.requirement_id);
      const rule = maintenanceRepository.getRuleById(entry.rule_id);
      return {
        ...entry,
        requirement,
        rule,
      };
    });

    res.json({
      success: true,
      data: {
        plan,
        entries: enrichedEntries,
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve vehicle maintenance plan',
    });
  }
});

/**
 * 3. POST /api/v1/vehicles/:id/maintenance/plan/entries
 * Adds a requirement to the vehicle's maintenance plan
 */
maintenanceRouter.post('/vehicles/:id/maintenance/plan/entries', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const actorId = req.actor!.user_id;
    const { requirement_id, custom_distance_interval, custom_time_interval_value, custom_time_interval_unit, priority_override, notes } = req.body;

    if (!requirement_id) {
      return res.status(400).json({ success: false, error: 'requirement_id is required' });
    }

    maintenanceService.addPlanEntry(
      vehicleId,
      {
        requirement_id,
        custom_distance_interval: custom_distance_interval ? Number(custom_distance_interval) : null,
        custom_time_interval_value: custom_time_interval_value ? Number(custom_time_interval_value) : null,
        custom_time_interval_unit,
        priority_override: priority_override ? Number(priority_override) : null,
        notes,
      },
      actorId
    );

    const summary = maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    res.status(201).json({
      success: true,
      message: 'Maintenance requirement added to vehicle plan',
      data: summary,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to add requirement to plan',
    });
  }
});

/**
 * 4. PATCH /api/v1/vehicles/:id/maintenance/plan/entries/:entryId
 * Updates custom intervals, enabled flag, or priority of a plan entry
 */
maintenanceRouter.patch('/vehicles/:id/maintenance/plan/entries/:entryId', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const entryId = req.params.entryId;
    const actorId = req.actor!.user_id;
    const { enabled, custom_distance_interval, custom_time_interval_value, custom_time_interval_unit, priority_override, notes } = req.body;

    maintenanceService.updatePlanEntry(
      vehicleId,
      entryId,
      {
        enabled: enabled !== undefined ? Boolean(enabled) : undefined,
        custom_distance_interval: custom_distance_interval !== undefined ? (custom_distance_interval ? Number(custom_distance_interval) : null) : undefined,
        custom_time_interval_value: custom_time_interval_value !== undefined ? (custom_time_interval_value ? Number(custom_time_interval_value) : null) : undefined,
        custom_time_interval_unit,
        priority_override: priority_override !== undefined ? (priority_override ? Number(priority_override) : null) : undefined,
        notes,
      },
      actorId
    );

    const summary = maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    res.json({
      success: true,
      message: 'Plan entry updated',
      data: summary,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update plan entry',
    });
  }
});

/**
 * 5. POST /api/v1/vehicles/:id/maintenance/complete
 * Records completion of maintenance (with timeline projection & passport refresh)
 */
maintenanceRouter.post('/vehicles/:id/maintenance/complete', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const actorId = req.actor!.user_id;
    const {
      requirement_id,
      cycle_id,
      plan_entry_id,
      completed_at,
      odometer_value,
      odometer_unit,
      service_provider_id,
      service_provider_name,
      performed_actions,
      replaced_parts,
      cost_total,
      currency,
      notes,
      verification_status,
      document_id,
    } = req.body;

    if (!requirement_id) {
      return res.status(400).json({ success: false, error: 'requirement_id is required' });
    }
    if (odometer_value === undefined || odometer_value === null) {
      return res.status(400).json({ success: false, error: 'odometer_value is required' });
    }

    const completion = maintenanceService.recordCompletion(
      vehicleId,
      {
        requirement_id,
        cycle_id,
        plan_entry_id,
        completed_at: completed_at || new Date().toISOString(),
        odometer_value: Number(odometer_value),
        odometer_unit,
        service_provider_id,
        service_provider_name,
        performed_actions,
        replaced_parts,
        cost_total: cost_total ? Number(cost_total) : 0,
        currency,
        notes,
        verification_status,
        document_id,
      },
      actorId
    );

    const updatedSummary = maintenanceService.getVehicleMaintenanceStatus(vehicleId);

    res.status(201).json({
      success: true,
      message: 'Maintenance completion recorded and projected to vehicle timeline',
      data: {
        completion,
        status_summary: updatedSummary,
      },
    });
  } catch (err) {
    logger.error(`Error recording maintenance completion: ${err instanceof Error ? err.message : String(err)}`);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to record maintenance completion',
    });
  }
});

/**
 * 6. POST /api/v1/vehicles/:id/maintenance/defer
 * Records deferral for an active cycle
 */
maintenanceRouter.post('/vehicles/:id/maintenance/defer', (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const actorId = req.actor!.user_id;
    const { cycle_id, reason, deferred_until_date, deferred_until_distance_km } = req.body;

    if (!cycle_id) {
      return res.status(400).json({ success: false, error: 'cycle_id is required' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason is required' });
    }

    maintenanceService.recordDeferral(
      vehicleId,
      {
        cycle_id,
        reason,
        deferred_until_date,
        deferred_until_distance_km: deferred_until_distance_km ? Number(deferred_until_distance_km) : null,
      },
      actorId
    );

    const summary = maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    res.json({
      success: true,
      message: 'Maintenance cycle successfully deferred',
      data: summary,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to defer maintenance',
    });
  }
});

/**
 * 7. GET /api/v1/vehicles/:id/maintenance/history & /vehicles/:id/maintenance/completions
 * Lists historical maintenance completions
 */
const handleGetMaintenanceHistory = (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.id;
    const history = maintenanceService.getMaintenanceHistory(vehicleId);
    res.json({
      success: true,
      data: history,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve maintenance history',
    });
  }
};

maintenanceRouter.get('/vehicles/:id/maintenance/history', handleGetMaintenanceHistory);
maintenanceRouter.get('/vehicles/:id/maintenance/completions', handleGetMaintenanceHistory);

/**
 * 8. GET /api/v1/maintenance/catalog
 * Lists available catalog requirements and default rules
 */
maintenanceRouter.get('/maintenance/catalog', (req: Request, res: Response) => {
  try {
    const category = req.query.category as MaintenanceCategory | undefined;
    const requirements = maintenanceRepository.listRequirements(category);
    const catalog = requirements.map((reqItem) => {
      const rules = maintenanceRepository.listRulesForRequirement(reqItem.id);
      return {
        requirement: reqItem,
        rules,
      };
    });

    res.json({
      success: true,
      data: {
        requirements,
        catalog,
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve catalog',
    });
  }
});
