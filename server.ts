/**
 * Garage OS Server Entry Point
 *
 * Implements:
 * - Enterprise System Topology (GAR-002)
 * - Observability, Reliability & Health Probes (GAR-045)
 * - Security & Rate Limiting (GAR-039)
 * - Transactional Outbox & Background Worker Bootstrap (GAR-035, GAR-036)
 * - Vite Single Page Application middleware
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

import { config, loadAndValidateConfig } from './src/server/config/env';
import { getDatabase, checkDatabaseHealth } from './src/server/database/connection';
import { runMigrations } from './src/server/database/migrations';
import { seedDatabase } from './src/server/seed/devSeed';
import { featureFlagManager } from './src/server/featureFlags/flags';
import { outboxWorker } from './src/server/events/outbox';
import { jobEngine } from './src/server/jobs/jobEngine';
import { healthRegistry } from './src/server/observability/health';
import { metrics } from './src/server/observability/metrics';
import { logger } from './src/server/observability/logger';
import { securityHeadersMiddleware } from './src/server/security/headers';
import { correlationMiddleware } from './src/server/security/correlation';
import { rateLimiter } from './src/server/security/rateLimiter';
import { idempotencyMiddleware } from './src/server/security/idempotency';
import { canonicalEnvelopeMiddleware, canonicalErrorHandler } from './src/server/api/middleware';
import { apiV1Router } from './src/server/api/router';
import { registerIdentityJobs } from './src/server/identity/identityJobs';
import { timelineProjector } from './src/server/timeline/timelineProjector';
import { timelineBackfillService } from './src/server/timeline/timelineBackfill';
import { passportBuilder } from './src/server/timeline/passportBuilder';
import { seedMaintenanceCatalog } from './src/server/maintenance/catalogSeed';
import { registerMaintenanceJobWorkers } from './src/server/jobs/maintenanceJob';
import { registerIssueFollowupJobWorkers } from './src/server/jobs/issueFollowupJob';
import { registerRecurringExpenseJobWorkers } from './src/server/jobs/recurringExpenseJob';
import { registerBookingJobWorkers } from './src/server/jobs/bookingJob';
import { realtimeBus } from './src/server/dispatch/realtimeBus';
import { dispatchWorker } from './src/server/dispatch/dispatchWorker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrapServer() {
  // 1. Validate configuration fail-fast
  loadAndValidateConfig();
  logger.info(`Bootstrapping ${config.APP_NAME} in [${config.APP_ENV}] mode`);

  // 2. Initialize Database and run migrations
  const db = getDatabase();
  const migrationResult = runMigrations(db);
  logger.info(`Migrations verified. Applied: ${migrationResult.applied.length}, up-to-date: ${migrationResult.alreadyUpToDate}`);

  // 3. Initialize Feature Flags & Dev Seed Data
  featureFlagManager.init();
  if (config.APP_ENV === 'development' || config.APP_ENV === 'test') {
    seedDatabase(db);
    seedMaintenanceCatalog();
  }

  // 4. Register Health Checks (GAR-045)
  healthRegistry.registerCheck('database', () => {
    const res = checkDatabaseHealth();
    return {
      status: res.status,
      latency_ms: res.latency_ms,
      details: { engine: 'node:sqlite (WAL mode)', path: res.path },
    };
  });

  healthRegistry.registerCheck('outbox_worker', () => {
    const pending = outboxWorker.getPendingCount();
    return {
      status: pending > 500 ? 'DEGRADED' : 'HEALTHY',
      details: { pending_events: pending },
    };
  });

  healthRegistry.registerCheck('job_engine', () => {
    const depth = jobEngine.getQueueDepth();
    return {
      status: depth.failed > 20 ? 'DEGRADED' : 'HEALTHY',
      details: depth,
    };
  });

  // 5. Connect metrics queue stats provider
  metrics.registerQueueStatsProvider(() => {
    const depth = jobEngine.getQueueDepth();
    return {
      outboxPending: outboxWorker.getPendingCount(),
      jobsQueued: depth.queued,
      jobsRunning: depth.running,
      jobsFailed: depth.failed,
      deadLetters: 0,
    };
  });

  // 6. Register default worker handlers (GAR-036)
  jobEngine.registerWorker('test.maintenance.reminder', async (payload, correlationId) => {
    logger.info('Processing maintenance reminder job', {
      correlation_id: correlationId,
      details: payload,
    });
  });

  jobEngine.registerWorker('telemetry.aggregate', async (payload, correlationId) => {
    logger.info('Aggregating vehicle telemetry metrics', {
      correlation_id: correlationId,
      details: payload,
    });
  });

  // Register identity lifecycle and notification workers (Sprint 2)
  registerIdentityJobs();

  // Register timeline & passport workers (Sprint 4)
  jobEngine.registerWorker('timeline.backfill', async () => {
    timelineBackfillService.backfillAll();
  });

  jobEngine.registerWorker('passport.rebuild', async (payload) => {
    if (payload && payload.vehicle_id) {
      passportBuilder.buildPassport(payload.vehicle_id as string);
    }
  });

  // Register maintenance due-state evaluation workers (Sprint 5)
  registerMaintenanceJobWorkers();

  // Register vehicle issue follow-up workers (Sprint 6)
  registerIssueFollowupJobWorkers();

  // Register recurring expense processor workers (Sprint 7)
  registerRecurringExpenseJobWorkers();

  // Register booking, scheduling & quote workers (Sprint 11)
  registerBookingJobWorkers();

  // Initialize Timeline Event Projector (GAR-005)
  timelineProjector.initialize();

  // Run idempotent timeline backfill for existing seed records
  timelineBackfillService.backfillAll();

  // 7. Start Outbox & Job Background Workers
  outboxWorker.start();
  jobEngine.start();

  // 8. Construct Express App
  const app = express();
  const PORT = config.PORT;

  // Security & standard middlewares
  app.use(securityHeadersMiddleware);

  // CORS
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.CORS_ALLOWED_ORIGINS);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id, Idempotency-Key, X-Actor-Id, X-Actor-Role, X-Organization-Id, X-Session-Token');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Body parser with size limits
  app.use(express.json({ limit: '15mb' }));

  // Correlation ID, Rate Limiting & Response Envelopes
  app.use(correlationMiddleware);
  app.use(rateLimiter.getMiddleware());
  app.use(canonicalEnvelopeMiddleware);
  app.use(idempotencyMiddleware);

  // Health and Metrics endpoints (GAR-002, GAR-045)
  app.get('/health/live', (req: Request, res: Response) => {
    res.json(healthRegistry.getLiveness());
  });

  app.get('/health/ready', async (req: Request, res: Response) => {
    const report = await healthRegistry.getReadiness();
    const httpStatus = report.status === 'DOWN' ? 503 : 200;
    res.status(httpStatus).json(report);
  });

  app.get('/metrics', (req: Request, res: Response) => {
    res.json(metrics.getSnapshot());
  });

  // API v1 Router
  app.use('/api/v1', apiV1Router);

  // Error handling middleware
  app.use(canonicalErrorHandler);

  // Vite middleware setup (SPA fallback)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to 0.0.0.0 using configured port
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Garage OS Canonical Platform online and listening on http://0.0.0.0:${PORT}`);
  });

  // Initialize Real-time WebSocket Bus (GAR-016)
  realtimeBus.init(server);

  // Start Sprint 14 Dispatch Background Worker
  dispatchWorker.start();

  // Graceful shutdown handling
  const shutdown = () => {
    logger.info('Gracefully shutting down Garage OS server...');
    outboxWorker.stop();
    jobEngine.stop();
    dispatchWorker.stop();
    server.close(() => {
      logger.info('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}

bootstrapServer().catch((err) => {
  logger.error(`Fatal server bootstrap failure: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
