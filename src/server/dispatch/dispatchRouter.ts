/**
 * Garage OS — Sprint 14: Dispatch HTTP & SSE API Router (GAR-016)
 * REST endpoints and Server-Sent Events for real-time dispatch, location, and operations.
 */

import { Router, Request, Response } from 'express';
import { dispatchService } from './dispatchService';
import { locationService } from './locationService';
import { dispatchRepository } from './dispatchRepository';
import { realtimeBus } from './realtimeBus';
import {
  DispatchDomain,
  DispatchPriority,
  DispatchStrategy,
  ResponderType,
  ResponderAvailabilityStatus,
  LocationSourceType,
} from './types';
import { authenticate } from '../api/authMiddleware';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import {
  assertDispatchRequestAccess,
  assertDispatchSourceAccess,
  assertOperationsAccess,
  assertProviderAccess,
  assertResponderAccess,
  assertTrackingAccess,
} from './dispatchAuthorization';

export const dispatchRouter = Router();

// Dispatch APIs are protected by canonical session authentication.
dispatchRouter.use(authenticate());

/**
 * 1. Update responder presence and heartbeat
 */
dispatchRouter.post('/responders/:responderId/presence', async (req: Request, res: Response) => {
  try {
    const { responderId } = req.params;
    const { provider_id, responder_type, status, current_job_reference } = req.body;
    const existingPresence = locationService.getPresence(responderId);
    const effectiveProviderId = provider_id || existingPresence?.provider_id;

    if (!effectiveProviderId) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'provider_id is required when registering responder presence',
        400
      );
    }
    assertProviderAccess(req.actor!, effectiveProviderId);

    const presence = locationService.updatePresence({
      provider_id: effectiveProviderId,
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

    assertResponderAccess(req.actor!, responderId);

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
    assertResponderAccess(req.actor!, responderId);
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

    assertDispatchSourceAccess(req.actor!, dispatch_domain as DispatchDomain, source_reference_id);

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
    assertDispatchRequestAccess(req.actor!, req.params.id);
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
    const { responder_reference_id, actor } = req.body;

    const result = await dispatchService.acceptOffer({
      dispatchRequestId: req.params.id,
      offerId: req.params.offerId,
      responderReferenceId: responder_reference_id,
      actor: actor || { id: 'api_actor', role: 'PROVIDER' },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 7. Manual assignment with override audit
 */
dispatchRouter.post('/requests/:id/manual-assign', async (req: Request, res: Response) => {
  try {
    const { candidate_id, override_reason, actor } = req.body;

    const result = await dispatchService.manualAssign({
      dispatchRequestId: req.params.id,
      candidateId: candidate_id,
      overrideReason: override_reason,
      actor: actor || { id: 'dispatcher', role: 'OPERATIONS_AGENT', name: 'Dispatcher Agent' },
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

/**
 * 8. Emergency Reassignment
 */
dispatchRouter.post('/requests/:id/reassign', async (req: Request, res: Response) => {
  try {
    const { reason, actor } = req.body;

    const result = await dispatchService.reassign({
      dispatchRequestId: req.params.id,
      reason: reason || 'Responder delayed / uncommunicative',
      actor: actor || { id: 'dispatcher', role: 'OPERATIONS_AGENT', name: 'Dispatcher Agent' },
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
    const requesterUserId = (req.query.userId as string) || 'customer_demo';
    const requesterRole = (req.query.role as string) || 'CUSTOMER';

    const trackingView = dispatchService.getTrackingView({
      assignmentId: req.params.assignmentId,
      requesterUserId,
      requesterRole,
    });

    res.json({ success: true, data: trackingView });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * 10. Operations Command Overview
 */
dispatchRouter.get('/operations/overview', async (req: Request, res: Response) => {
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
  const topicsParam = (req.query.topics as string) || '*';
  const topics = topicsParam.split(',').map((t) => t.trim());

  realtimeBus.registerSseClient(clientId, res, topics, {
    userId: req.query.userId as string,
    role: req.query.role as string,
  });
});
