/**
 * Canonical Vehicle Timeline & Digital Vehicle Passport API Router (GAR-005, GAR-034)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { timelineService } from '../timeline/timelineService';
import { timelineBackfillService } from '../timeline/timelineBackfill';
import { TimelineCategory, TimelineEntryType } from '../timeline/types';

export const timelineRouter = Router();

// ==========================================
// 1. Vehicle Timeline Endpoints
// ==========================================

/**
 * GET /api/v1/vehicles/:vehicleId/timeline
 * Retrieves cursor-paginated timeline entries for a vehicle
 */
timelineRouter.get('/vehicles/:vehicleId/timeline', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const { category, entry_type, from_date, to_date, limit, cursor, include_superseded } = req.query;

    const result = timelineService.getTimeline(actor, vehicleId, {
      category: category as TimelineCategory,
      entry_type: entry_type as TimelineEntryType,
      from_date: from_date as string,
      to_date: to_date as string,
      limit: limit ? Number(limit) : undefined,
      cursor: cursor as string,
      include_superseded: include_superseded === 'true',
    });

    res.json({
      success: true,
      data: result.entries,
      pagination: {
        next_cursor: result.next_cursor,
        has_more: result.has_more,
        total_count: result.total_count,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:vehicleId/timeline/:entryId
 * Retrieves entry details, non-destructive correction history, and disputes
 */
timelineRouter.get('/vehicles/:vehicleId/timeline/:entryId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const { vehicleId, entryId } = req.params;
    const details = timelineService.getTimelineEntry(actor, vehicleId, entryId);

    res.json({
      success: true,
      data: details,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/timeline/:entryId/correct
 * Submits a non-destructive correction for a timeline entry
 */
timelineRouter.post('/vehicles/:vehicleId/timeline/:entryId/correct', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const { vehicleId, entryId } = req.params;
    const result = timelineService.submitCorrection(actor, vehicleId, entryId, req.body);

    res.status(201).json({
      success: true,
      message: 'Timeline entry corrected non-destructively',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/timeline/:entryId/dispute
 * Submits a dispute against a timeline entry
 */
timelineRouter.post('/vehicles/:vehicleId/timeline/:entryId/dispute', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const { vehicleId, entryId } = req.params;
    const dispute = timelineService.submitDispute(actor, vehicleId, entryId, req.body);

    res.status(201).json({
      success: true,
      message: 'Dispute recorded for timeline entry',
      data: dispute,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. Digital Vehicle Passport Endpoints
// ==========================================

/**
 * GET /api/v1/vehicles/:vehicleId/passport
 * Retrieves canonical Digital Vehicle Passport view
 */
timelineRouter.get('/vehicles/:vehicleId/passport', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const passport = timelineService.getPassport(actor, vehicleId);

    res.json({
      success: true,
      data: passport,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:vehicleId/passport/rebuild
 * Manually forces a rebuild of the materialized Digital Vehicle Passport projection
 */
timelineRouter.post('/vehicles/:vehicleId/passport/rebuild', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const passport = timelineService.rebuildPassport(actor, vehicleId);

    res.json({
      success: true,
      message: 'Passport projection regenerated and verified',
      data: passport,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. Passport Secure Sharing Endpoints
// ==========================================

/**
 * POST /api/v1/vehicles/:vehicleId/passport/shares
 * Creates a secure, time-bounded passport share link
 */
timelineRouter.post('/vehicles/:vehicleId/passport/shares', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const result = timelineService.createPassportShare(actor, vehicleId, req.body);

    res.status(201).json({
      success: true,
      message: 'Secure passport share grant created',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:vehicleId/passport/shares
 * Lists active and revoked share grants for a vehicle
 */
timelineRouter.get('/vehicles/:vehicleId/passport/shares', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const vehicleId = req.params.vehicleId;
    const grants = timelineService.getVehicleShareGrants(actor, vehicleId);

    res.json({
      success: true,
      count: grants.length,
      data: grants,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/vehicles/:vehicleId/passport/shares/:shareId
 * Revokes a passport share grant immediately
 */
timelineRouter.delete('/vehicles/:vehicleId/passport/shares/:shareId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.actor!;
    const { vehicleId, shareId } = req.params;
    timelineService.revokePassportShare(actor, vehicleId, shareId);

    res.json({
      success: true,
      message: 'Passport share grant revoked',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/passport-shares/:token
 * Public unauthenticated endpoint to view shared passport
 */
timelineRouter.get('/passport-shares/:token', (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = timelineService.getPublicSharedPassport(token, clientIp, userAgent);

    res.json({
      success: true,
      data: result.passport,
      share_info: result.share_info,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. Admin / Backfill Operations
// ==========================================

/**
 * POST /api/v1/admin/timeline/backfill
 * Idempotently executes timeline and passport projection backfill
 */
timelineRouter.post('/admin/timeline/backfill', (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = timelineBackfillService.backfillAll();
    res.json({
      success: true,
      message: 'Timeline and passport backfill completed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});
