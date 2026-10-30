/**
 * Canonical Vehicle Domain API Router (GAR-004, GAR-034 §1-§8)
 *
 * Implements REST endpoints for:
 * - Vehicle aggregate lifecycle (create, get, list, update, archive)
 * - Structured vehicle identifiers & lookup
 * - Ownership & custody relationship delegation
 * - Append-only odometer observations with regression anomaly detection
 * - Vehicle documentation foundation
 * - Vehicle make & model catalog
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { vehicleService } from '../vehicle/vehicleService';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { VehicleStatus } from '../vehicle/types';

export const vehicleRouter = Router();

// ==========================================
// 1. Vehicle Catalog (Public/Authenticated)
// ==========================================

vehicleRouter.get('/vehicles/catalog/makes', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const makes = vehicleRepository.getCatalogMakes();
    res.json({
      success: true,
      count: makes.length,
      data: makes,
    });
  } catch (err) {
    next(err);
  }
});

vehicleRouter.get('/vehicles/catalog/models', (req: Request, res: Response, next: NextFunction) => {
  try {
    const makeId = String(req.query.make_id || '');
    if (!makeId) {
      res.json({ success: true, count: 0, data: [] });
      return;
    }
    const models = vehicleRepository.getCatalogModels(makeId);
    res.json({
      success: true,
      count: models.length,
      data: models,
    });
  } catch (err) {
    next(err);
  }
});

// All subsequent vehicle routes require authentication
vehicleRouter.use('/vehicles', authenticate());

// ==========================================
// 2. Vehicle Aggregate Lifecycle
// ==========================================

/**
 * POST /api/v1/vehicles
 * Creates a new vehicle aggregate root
 */
vehicleRouter.post('/vehicles', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const result = vehicleService.createVehicle(actor, req.body);
    res.status(201).json({
      success: true,
      message: 'Vehicle aggregate successfully created',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles
 * Lists authorized vehicles for current actor ("My Garage")
 */
vehicleRouter.get('/vehicles', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const status = req.query.status as VehicleStatus | undefined;
    const vehicles = vehicleService.listMyVehicles(actor, status);
    res.json({
      success: true,
      count: vehicles.length,
      data: vehicles,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:vehicleId
 * Retrieves full vehicle details and associated entities
 */
vehicleRouter.get('/vehicles/:vehicleId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const detail = vehicleService.getVehicleDetails(actor, vehicleId);
    res.json({
      success: true,
      data: detail,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/vehicles/:vehicleId
 * Updates mutable vehicle specifications
 */
vehicleRouter.patch('/vehicles/:vehicleId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const updated = vehicleService.updateVehicle(actor, vehicleId, req.body);
    res.json({
      success: true,
      message: 'Vehicle specifications updated',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/archive
 * Safely archives a vehicle aggregate preserving historical data
 */
vehicleRouter.post('/vehicles/:vehicleId/archive', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const archived = vehicleService.archiveVehicle(actor, vehicleId, req.body.reason);
    res.json({
      success: true,
      message: 'Vehicle aggregate archived',
      data: archived,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. Odometer Observations
// ==========================================

/**
 * GET /api/v1/vehicles/:vehicleId/odometer
 * Retrieves historical odometer observations
 */
vehicleRouter.get('/vehicles/:vehicleId/odometer', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    // Verify access first
    vehicleService.getVehicleDetails(actor, vehicleId);

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const observations = vehicleRepository.listOdometerObservations(vehicleId, limit, offset);

    res.json({
      success: true,
      count: observations.length,
      data: observations,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/odometer
 * Records a new odometer reading with regression detection
 */
vehicleRouter.post('/vehicles/:vehicleId/odometer', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const observation = vehicleService.recordOdometer(actor, vehicleId, req.body);

    res.status(201).json({
      success: true,
      message:
        observation.status === 'FLAGGED'
          ? 'Odometer observation flagged due to regression anomaly'
          : 'Odometer observation recorded successfully',
      data: observation,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/odometer/correct
 * Corrects a previous faulty observation
 */
vehicleRouter.post('/vehicles/:vehicleId/odometer/correct', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const corrected = vehicleService.correctOdometer(actor, vehicleId, req.body);

    res.json({
      success: true,
      message: 'Odometer observation corrected and previous reading superseded',
      data: corrected,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. Vehicle Relationships & Delegation
// ==========================================

/**
 * GET /api/v1/vehicles/:vehicleId/relationships
 * Lists active relationships on a vehicle
 */
vehicleRouter.get('/vehicles/:vehicleId/relationships', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    // Verify access first
    vehicleService.getVehicleDetails(actor, vehicleId);

    const relationships = vehicleRepository.getVehicleRelationships(vehicleId);
    res.json({
      success: true,
      count: relationships.length,
      data: relationships,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/relationships
 * Grants relationship (Driver, Co-Owner, Custodian)
 */
vehicleRouter.post('/vehicles/:vehicleId/relationships', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const created = vehicleService.addRelationship(actor, vehicleId, req.body);

    res.status(201).json({
      success: true,
      message: 'Vehicle relationship added',
      data: created,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/vehicles/:vehicleId/relationships/:relationshipId
 * Revokes an existing vehicle relationship
 */
vehicleRouter.delete(
  '/vehicles/:vehicleId/relationships/:relationshipId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor!;
      const vehicleId = req.params.vehicleId;
      const relationshipId = req.params.relationshipId;
      vehicleService.revokeRelationship(actor, vehicleId, relationshipId);

      res.json({
        success: true,
        message: 'Vehicle relationship revoked',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ==========================================
// 5. Vehicle Documents Foundation
// ==========================================

/**
 * GET /api/v1/vehicles/:vehicleId/documents
 * Lists documents for a vehicle
 */
vehicleRouter.get('/vehicles/:vehicleId/documents', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    // Verify access first
    vehicleService.getVehicleDetails(actor, vehicleId);

    const documents = vehicleRepository.listVehicleDocuments(vehicleId);
    res.json({
      success: true,
      count: documents.length,
      data: documents,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/documents
 * Records a vehicle document association
 */
vehicleRouter.post('/vehicles/:vehicleId/documents', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const document = vehicleService.addDocument(actor, vehicleId, req.body);

    res.status(201).json({
      success: true,
      message: 'Vehicle document recorded',
      data: document,
    });
  } catch (err) {
    next(err);
  }
});
