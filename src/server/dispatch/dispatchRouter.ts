/**
 * Garage OS — Sprint 14: Dispatch HTTP & SSE API Router (GAR-016)
 * REST endpoints and Server-Sent Events for real-time dispatch, location, and operations.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { dispatchService } from './dispatchService';
import { locationService } from './locationService';
import { dispatchRepository } from './dispatchRepository';
import { realtimeBus } from './realtimeBus';
import { authenticate } from '../api/authMiddleware';
import { getDatabase } from '../database/connection';
import { PlatformRole } from '../identity/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  DispatchDomain,
  DispatchPriority,
  DispatchStrategy,
  ResponderType,
  ResponderAvailabilityStatus,
  LocationSourceType,
} from './types';

export const dispatchRouter = Router();

dispatchRouter.use(authenticate());

function isOperationsActor(req: Request): boolean {
  return Boolean(req.actor?.platform_roles?.some((role) =>
    [PlatformRole.PLATFORM_ADMIN, PlatformRole.OPERATIONS, PlatformRole.TRUST_AND_SAFETY].includes(role)
  ));
}

function requireOperations(req: Request, _res: Response, next: NextFunction): void {
  if (!isOperationsActor(req)) {
    return next(new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Dispatch operations access required', 403));
  }
  next();
}

function canManageProvider(req: Request, providerId: string): boolean {
  if (isOperationsActor(req)) return true;
  const db = getDatabase();
  const provider = db.prepare('SELECT organization_id FROM service_providers WHERE id = ? LIMIT 1;')
    .get(providerId) as { organization_id?: string } | undefined;
  if (!provider?.organization_id || !req.actor) return false;
  return req.actor.memberships.some((m) =>
    m.organization_id === provider.organization_id && m.status === 'ACTIVE'
  );
}

function assertResponderAccess(req: Request, responderId: string, providerId?: string): void {
  if (req.actor?.user_id === responderId || req.actor?.id === responderId || isOperationsActor(req)) return;
  if (providerId && canManageProvider(req, providerId)) return;

  const db = getDatabase();
  const presence = db.prepare('SELECT provider_id FROM responder_presence WHERE responder_reference_id = ? LIMIT 1;')
    .get(responderId) as { provider_id?: string } | undefined;
  if (presence?.provider_id && canManageProvider(req, presence.provider_id)) return;

  throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Responder access denied', 403);
}

/**
 * 1. Update responder presence and heartbeat
 */
dispatchRouter.post('/responders/:responderId/presence', async (req: Request, res: Response) => {
  try {
    const { responderId } = req.params;
    const { provider_id, responder_type, status, current_job_reference } = req.body;
    assertResponderAccess(req, responderId, provider_id);

    const presence = locationService.updatePresence({
      provider_id: provider_id || 'unknown_provider',
      responder_type: responder_type || ResponderType.PROVIDER,
      responder_reference_id: responderId,
      status: status || ResponderAvailabilityStatus.AVAILABLE,
      current_job_reference,
    });

    realtimeBus.publish(`responder.${responderId}`, 'PRESENCE_UPDATED', presence);
    realtimeBus.publish('operations.dispatch', 'RESPONDER_PRESENCE_UPDATED', presence);

    res.json({ success: true, data: presence });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 2. Ingest raw location telemetry
 */
dispatchRouter.post('/responders/:responderId/location', async (req: Request, res: Response) => {
  try {
    const { responderId } = req.params;
    assertResponderAccess(req, responderId);
    const {
      responder_type,
      latitude,
      longitude,
      accuracy_meters,
      heading_degrees,
      speed_meters_per_second,
      captured_at,
      source_type,
    } = req.body;

    const result = locationService.ingestObservation({
      responder_type: responder_type || ResponderType.PROVIDER,
      responder_reference_id: responderId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy_meters: accuracy_meters !== undefined ? Number(accuracy_meters) : null,
      heading_degrees: heading_degrees !== undefined ? Number(heading_degrees) : null,
      speed_meters_per_second: speed_meters_per_second !== undefined ? Number(speed_meters_per_second) : null,
      captured_at: captured_at || new Date().toISOString(),
      source_type: source_type || LocationSourceType.DEVICE_GPS,
    });

    if (result.currentProjectionUpdated && result.projection) {
      realtimeBus.publish(`responder.${responderId}`, 'LOCATION_UPDATED', result.projection);
      realtimeBus.publish('operations.dispatch', 'RESPONDER_LOCATION_UPDATED', result.projection);
    }

    res.json({
      success: true,
      data: {
        observation_id: result.observation.id,
        is_outlier: result.observation.is_outlier === 1,
        outlier_reason: result.observation.outlier_reason,
        current_projection_updated: result.currentProjectionUpdated,
      },
    });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 3. Get current location projection for responder
 */
dispatchRouter.get('/responders/:responderId/location', async (req: Request, res: Response) => {
  try {
    const { responderId } = req.params;
    assertResponderAccess(req, responderId);
    const location = locationService.getCurrentLocation(responderId);
    if (!location) {
      return res.status(404).json({ error: 'Location not found for responder' });
    }
    res.json({ success: true, data: location });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * 4. Create dispatch request
 */
dispatchRouter.post('/requests', async (req: Request, res: Response) => {
  try {
    const {
      dispatch_domain,
      source_reference_type,
      source_reference_id,
      required_capability,
      pickup_latitude,
      pickup_longitude,
      destination_latitude,
      destination_longitude,
      vehicle_id,
      priority,
      strategy,
    } = req.body;

    const result = await dispatchService.createRequest({
      dispatch_domain: dispatch_domain as DispatchDomain,
      source_reference_type,
      source_reference_id,
      required_capability,
      pickup_latitude: pickup_latitude !== undefined ? Number(pickup_latitude) : undefined,
      pickup_longitude: pickup_longitude !== undefined ? Number(pickup_longitude) : undefined,
      destination_latitude: destination_latitude !== undefined ? Number(destination_latitude) : undefined,
      destination_longitude: destination_longitude !== undefined ? Number(destination_longitude) : undefined,
      vehicle_id,
      priority: priority as DispatchPriority,
      strategy: strategy as DispatchStrategy,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 5. Get dispatch request details, attempts, and candidates
 */
dispatchRouter.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const request = dispatchRepository.getRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Dispatch request not found' });
    }

    const candidates = dispatchRepository.getCandidatesByRequest(request.id);
    const activeAttempt = request.active_attempt_id
      ? dispatchRepository.getAttemptById(request.active_attempt_id)
      : null;

    res.json({
      success: true,
      data: {
        request,
        active_attempt: activeAttempt,
        candidates,
      },
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * 6. Accept dispatch offer (atomic transaction)
 */
dispatchRouter.post('/requests/:id/offers/:offerId/accept', async (req: Request, res: Response) => {
  try {
    const { responder_reference_id } = req.body;

    const result = await dispatchService.acceptOffer({
      dispatchRequestId: req.params.id,
      offerId: req.params.offerId,
      responderReferenceId: responder_reference_id,
      actor: {
        id: req.actor!.user_id,
        role: req.actor!.platform_roles[0] || req.actor!.active_membership?.role || 'PROVIDER',
        name: req.actor!.profile.display_name,
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 7. Manual assignment with override audit
 */
dispatchRouter.post('/requests/:id/manual-assign', requireOperations, async (req: Request, res: Response) => {
  try {
    const { candidate_id, override_reason } = req.body;

    const result = await dispatchService.manualAssign({
      dispatchRequestId: req.params.id,
      candidateId: candidate_id,
      overrideReason: override_reason,
      actor: {
        id: req.actor!.user_id,
        role: req.actor!.platform_roles[0] || 'OPERATIONS',
        name: req.actor!.profile.display_name,
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 8. Emergency Reassignment
 */
dispatchRouter.post('/requests/:id/reassign', requireOperations, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    const result = await dispatchService.reassign({
      dispatchRequestId: req.params.id,
      reason: reason || 'Responder delayed / uncommunicative',
      actor: {
        id: req.actor!.user_id,
        role: req.actor!.platform_roles[0] || 'OPERATIONS',
        name: req.actor!.profile.display_name,
      },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 9. Customer Privacy-Guarded Live Tracking View
 */
dispatchRouter.get('/tracking/:assignmentId', async (req: Request, res: Response) => {
  try {
    const trackingView = dispatchService.getTrackingView({
      assignmentId: req.params.assignmentId,
      requesterUserId: req.actor!.user_id,
      requesterRole: req.actor!.platform_roles[0] || req.actor!.active_membership?.role || 'CUSTOMER',
    });

    res.json({ success: true, data: trackingView });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * 10. Operations Command Overview
 */
dispatchRouter.get('/operations/overview', requireOperations, async (req: Request, res: Response) => {
  try {
    const overview = dispatchRepository.getOperationsOverview();
    res.json({ success: true, data: overview });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * 11. Real-Time SSE Stream Endpoint
 */
dispatchRouter.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = `sse_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const topicsParam = (req.query.topics as string) || '';
  const topics = topicsParam.split(',').map((t) => t.trim()).filter(Boolean);
  if (topics.length === 0) {
    return res.status(400).json({ error: 'At least one authorized topic is required' });
  }

  try {
    realtimeBus.registerSseClient(clientId, res, topics, req.actor!);
  } catch {
    return res.status(403).json({ error: 'Realtime subscription access denied' });
  }
});
