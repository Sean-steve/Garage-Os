/**
 * Canonical API Router (GAR-034 §1-§8)
 *
 * Implements /api/v1 endpoints for platform capabilities, administration,
 * outbox & job operations, storage, audit logs and feature flags.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getSanitizedConfig } from '../config/env';
import { getDatabase, checkDatabaseHealth } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { outboxWorker, enqueueOutboxEvent } from '../events/outbox';
import { eventBus } from '../events/eventBus';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { jobEngine } from '../jobs/jobEngine';
import { listDeadLetters, getDeadLetterCount } from '../jobs/deadLetter';
import { storageEngine } from '../storage/storageEngine';
import { listAuditEvents, recordAuditEvent } from '../security/audit';
import { featureFlagManager } from '../featureFlags/flags';
import { metrics } from '../observability/metrics';
import { SPRINT_1_TRACEABILITY_MATRIX, R1_SPRINT_1_TO_14_TRACEABILITY_MATRIX, SPRINT_15_TRACEABILITY_MATRIX, SPRINT_16_TRACEABILITY_MATRIX } from '../../shared/traceability';
import { PlatformLifecycleState, CanonicalActorType } from '../../shared/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { DataProvenanceClass } from '../../shared/provenance';
import { authRouter } from './authRouter';
import { authenticate } from './authMiddleware';
import { PlatformRole } from '../identity/types';
import { config } from '../config/env';
import { vehicleRouter } from './vehicleRouter';
import { timelineRouter } from './timelineRouter';
import { maintenanceRouter } from './maintenanceRouter';
import { issueRouter } from './issueRouter';
import { fuelExpenseRouter } from './fuelExpenseRouter';
import { componentRouter } from './componentRouter';
import { providerRouter } from './providerRouter';
import { operationsRouter } from './operationsRouter';
import { bookingRouter } from './bookingRouter';
import { roadsideRouter } from './roadsideRouter';
import { towingRouter } from './towingRouter';
import { dispatchRouter } from '../dispatch/dispatchRouter';
import { safetyRouter } from './safetyRouter';

export const apiV1Router = Router();

function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor?.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)) {
    return next(new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Platform administrator access required', 403));
  }
  next();
}

function requireNonProduction(req: Request, _res: Response, next: NextFunction): void {
  if (config.APP_ENV === 'production') {
    return next(new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Endpoint not available', 404));
  }
  next();
}

// Mount Sprint 2 Identity, Auth & Organization Router
apiV1Router.use(authRouter);

// Mount Sprint 3 Canonical Vehicle Domain Router
apiV1Router.use(vehicleRouter);

// Mount Sprint 4 Vehicle Timeline & Digital Vehicle Passport Router
apiV1Router.use(timelineRouter);

// Mount Sprint 5 Vehicle Maintenance & Service Intelligence Router
apiV1Router.use(maintenanceRouter);

// Mount Sprint 6 Vehicle Issue, Fault & Persistent Problem Router
apiV1Router.use(issueRouter);

// Mount Sprint 7 Fuel, Expense & Total Cost of Ownership Router
apiV1Router.use(fuelExpenseRouter);

// Mount Sprint 8 Tyres, Parts, Components & Vehicle Configuration Router
apiV1Router.use(componentRouter);

// Mount Sprint 9 Service Provider Network & Domain Router
apiV1Router.use(providerRouter);

// Mount Sprint 10 Garage Operations Management Router
apiV1Router.use(operationsRouter);

// Mount Sprint 11 Booking, Scheduling, Quotes & Service Transactions Router
apiV1Router.use(bookingRouter);

// Mount Sprint 12 Roadside Assistance Core Router (GAR-014)
apiV1Router.use('/roadside', roadsideRouter);

// Mount Sprint 13 Towing & Recovery Architecture Router (GAR-015)
apiV1Router.use(towingRouter);

// Mount Sprint 14 Real-Time Dispatch, Location & Provider Matching Router (GAR-016)
apiV1Router.use('/dispatch', dispatchRouter);

// Mount Sprint 15 Emergency Circle & Human Safety Foundation Router (GAR-017)
apiV1Router.use('/safety', safetyRouter);

// 1. Platform Capabilities (GAR-002 §8 /v1/platform/capabilities)
apiV1Router.get('/platform/capabilities', (req: Request, res: Response) => {
  const dbHealth = checkDatabaseHealth();
  const db = getDatabase();
  const migrationCount = (db.prepare('SELECT COUNT(*) as count FROM schema_migrations;').get() as { count: number })?.count || 0;
  const queueDepth = jobEngine.getQueueDepth();
  const outboxPending = outboxWorker.getPendingCount();
  const deadLetters = getDeadLetterCount();

  const capabilities = {
    platform_name: 'Garage OS',
    version: '16.0.0-sprint16',
    environment: process.env.NODE_ENV || 'development',
    lifecycle_state: PlatformLifecycleState.ACTIVE,
    architecture_baseline: 'GAR-000-to-GAR-051',
    active_sprint: 'Sprint 16: SOS Engine & Emergency Activation (GAR-017)',
    next_sprint: 'Sprint 17: Trusted Contact Experience (GAR-017)',
    constitutional_laws_enforced: 12,
    config: getSanitizedConfig(),
    domains: [
      { id: 'GAR-003', title: 'Identity & Authentication', status: 'ACTIVE_IMPLEMENTED', owner: 'Identity Domain' },
      { id: 'GAR-004', title: 'Vehicle Kernel & Identity', status: 'ACTIVE_IMPLEMENTED', owner: 'Vehicle Domain' },
      { id: 'GAR-005', title: 'Digital Vehicle Passport & Timeline', status: 'ACTIVE_IMPLEMENTED', owner: 'Passport Domain' },
      { id: 'GAR-006', title: 'Maintenance & Service Intelligence', status: 'ACTIVE_IMPLEMENTED', owner: 'Maintenance Domain' },
      { id: 'GAR-007', title: 'Vehicle Health Engine', status: 'FOUNDATION_READY', owner: 'Health Domain' },
      { id: 'GAR-008', title: 'Vehicle Issues & Recurrence', status: 'ACTIVE_IMPLEMENTED', owner: 'Diagnostics Domain' },
      { id: 'GAR-009', title: 'Fuel, Expenses & TCO', status: 'ACTIVE_IMPLEMENTED', owner: 'Cost Domain' },
      { id: 'GAR-010', title: 'Tyres & Vehicle Components', status: 'ACTIVE_IMPLEMENTED', owner: 'Components Domain' },
      { id: 'GAR-011', title: 'Garage & Provider Network', status: 'ACTIVE_IMPLEMENTED', owner: 'Provider Domain' },
      { id: 'GAR-012', title: 'Garage Operations Management', status: 'ACTIVE_IMPLEMENTED', owner: 'Garage Operations Domain' },
      { id: 'GAR-013', title: 'Booking, Scheduling & Quotes', status: 'ACTIVE_IMPLEMENTED', owner: 'Booking Domain' },
      { id: 'GAR-014', title: 'Roadside Assistance', status: 'ACTIVE_IMPLEMENTED', owner: 'Roadside Domain' },
      { id: 'GAR-015', title: 'Towing & Recovery', status: 'ACTIVE_IMPLEMENTED', owner: 'Towing Domain' },
      { id: 'GAR-016', title: 'Real-Time Dispatch & Matching', status: 'ACTIVE_IMPLEMENTED_R1_HARDENED', owner: 'Dispatch Domain' },
      { id: 'GAR-017', title: 'SOS & Human Safety Engine', status: 'SOS_ENGINE_IMPLEMENTED_SPRINT_16', owner: 'Safety Domain' },
    ],
    subsystems: {
      database: {
        type: 'node:sqlite (WAL mode + ACID transactions)',
        status: dbHealth.status,
        latency_ms: dbHealth.latency_ms,
        migrations_applied: migrationCount,
      },
      event_bus: {
        type: 'Transactional Outbox + In-Memory EventBus',
        outbox_status: 'RUNNING',
        pending_outbox_events: outboxPending,
        registered_event_types: eventBus.getRegisteredEvents(),
      },
      background_worker: {
        status: 'RUNNING',
        active_jobs: queueDepth.running,
        queued_jobs: queueDepth.queued,
        dead_letter_count: deadLetters,
      },
      storage: {
        provider: 'local-memory-driver',
        status: 'AVAILABLE',
        max_size_bytes: 15728640,
      },
      security: {
        security_headers: true,
        rate_limiting: true,
        idempotency_caching: true,
        immutable_audit: true,
      },
    },
  };

  return res.canonicalSuccess(capabilities);
});

// 2. Traceability Matrix (GAR-049 §8 /v1/admin/traceability)
apiV1Router.get('/admin/traceability', authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const matrix = [...SPRINT_1_TRACEABILITY_MATRIX, ...R1_SPRINT_1_TO_14_TRACEABILITY_MATRIX, ...SPRINT_15_TRACEABILITY_MATRIX, ...SPRINT_16_TRACEABILITY_MATRIX];
  return res.canonicalSuccess({
    total_requirements: matrix.length,
    matrix,
    traceability: matrix,
    certification_phase: 'R1+S15+S16',
  });
});

// 3. Queue & Background Operations Inspector (GAR-036 §8 /v1/admin/queues)
apiV1Router.get('/admin/queues', authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const db = getDatabase();
  const recentOutbox = db.prepare(`
    SELECT * FROM outbox_events ORDER BY created_at DESC LIMIT 20;
  `).all();
  const recentJobs = db.prepare(`
    SELECT * FROM job_instances ORDER BY created_at DESC LIMIT 20;
  `).all();
  const deadLetters = listDeadLetters(20);

  return res.canonicalSuccess({
    summary: {
      outbox_pending: outboxWorker.getPendingCount(),
      queue_depth: jobEngine.getQueueDepth(),
      dead_letter_count: getDeadLetterCount(),
    },
    outbox_events: recentOutbox,
    jobs: recentJobs,
    dead_letters: deadLetters,
  });
});

// 4. Immutable Audit Log Query (GAR-043 §8 /v1/admin/audit)
apiV1Router.get('/admin/audit', authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  const resourceType = req.query.resource_type ? String(req.query.resource_type) : undefined;

  const result = listAuditEvents(limit, offset, resourceType);
  return res.canonicalSuccess(result.items, {
    pagination: {
      limit,
      cursor: String(offset),
      next_cursor: offset + limit < result.total ? String(offset + limit) : null,
      has_more: offset + limit < result.total,
      total_count: result.total,
    },
  });
});

// 5. Feature Flags (GAR-046 §8 /v1/feature-flags)
apiV1Router.get('/feature-flags', authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const flags = featureFlagManager.getAllFlags();
  return res.canonicalSuccess(flags);
});

apiV1Router.patch('/feature-flags/:key', authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const { key } = req.params;
  const { enabled, percentage } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'enabled must be a boolean');
  }

  const updated = featureFlagManager.updateFlag(key, enabled, percentage);
  if (!updated) {
    throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Feature flag '${key}' not found`, 404);
  }

  recordAuditEvent({
    action: 'UPDATE_FEATURE_FLAG',
    resource_type: 'feature_flag',
    resource_id: key,
    correlation_id: req.correlationId,
    source: 'ADMIN_CONSOLE',
    after_state: { enabled, percentage },
  });

  return res.canonicalSuccess({ key, enabled, percentage });
});

// 6. Secure Media / Evidence Upload (GAR-038 §8)
apiV1Router.post('/uploads', authenticate(), async (req: Request, res: Response) => {
  const { filename, contentType, dataBase64, classification } = req.body;

  if (!filename || !contentType || !dataBase64) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      'filename, contentType, and dataBase64 are required fields',
      400
    );
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  const record = await storageEngine.storeFile({
    filename,
    contentType,
    buffer,
    ownerId: req.actor?.id,
    classification,
  });

  const signedToken = storageEngine.generateSignedAccessToken(record.id, 3600);

  recordAuditEvent({
    action: 'UPLOAD_FILE',
    resource_type: 'file_object',
    resource_id: record.id,
    correlation_id: req.correlationId,
    source: 'API_UPLOAD',
    metadata: { filename: record.filename, mime: record.content_type },
  });

  return res.canonicalSuccess({
    ...record,
    download_token: signedToken,
    access_url: `/api/v1/files/${record.id}?token=${signedToken}`,
  });
});

apiV1Router.get('/files/:id', authenticate({ optional: true }), async (req: Request, res: Response) => {
  const { id } = req.params;
  const token = req.query.token as string | undefined;

  let signedAccessValid = false;
  if (token) {
    const verified = storageEngine.verifySignedAccessToken(token);
    signedAccessValid = verified.valid && verified.fileId === id;
    if (!signedAccessValid) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Invalid or expired signed access token', 403);
    }
  }

  const file = await storageEngine.getFile(id);
  if (!file) {
    throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Requested file not found', 404);
  }

  const isOwner = Boolean(req.actor && file.record.owner_id && req.actor.id === file.record.owner_id);
  const isPlatformAdmin = Boolean(req.actor?.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN));
  if (!signedAccessValid && !isOwner && !isPlatformAdmin) {
    throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Signed access token or authorized owner access required', 403);
  }

  res.setHeader('Content-Type', file.record.content_type);
  res.setHeader('Content-Length', file.record.size_bytes);
  return res.send(file.buffer);
});

// 7. Test Verification Endpoints (for CI, test suites, and interactive validation)
apiV1Router.post('/test/idempotency', requireNonProduction, authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const { action, amount } = req.body;
  const transactionId = `tx_${Date.now()}`;

  return res.canonicalSuccess({
    message: 'Operation executed successfully',
    action,
    amount,
    transaction_id: transactionId,
  });
});

apiV1Router.post('/test/emit-event', requireNonProduction, authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const { eventType, payload } = req.body;

  const event = createCanonicalEventEnvelope({
    type: eventType || 'VehicleCreated',
    correlation_id: req.correlationId,
    subject_ids: { test_id: 'test-123' },
    provenance_class: DataProvenanceClass.PROVIDER_RECORDED,
    payload: payload || { sample: true },
  });

  const outboxId = withTransaction((ctx) => {
    return enqueueOutboxEvent(event, ctx.db);
  });

  return res.canonicalSuccess({
    event_id: event.event_id,
    outbox_id: outboxId,
    event,
  });
});

apiV1Router.post('/test/enqueue-job', requireNonProduction, authenticate(), requirePlatformAdmin, (req: Request, res: Response) => {
  const { jobName, payload } = req.body;

  const jobId = jobEngine.enqueue(
    jobName || 'test.maintenance.reminder',
    payload || { vehicleId: 'veh_test_01' },
    { correlationId: req.correlationId }
  );

  return res.canonicalSuccess({
    job_id: jobId,
    job_name: jobName || 'test.maintenance.reminder',
    status: 'QUEUED',
  });
});
