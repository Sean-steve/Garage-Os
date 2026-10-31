import { jobEngine } from './jobEngine';
import { logger } from '../observability/logger';
import {
  SOS_FINALIZE_ACTIVATION_JOB,
  SOS_LOCATION_RETENTION_JOB,
  SOS_NOTIFICATION_ATTEMPT_JOB,
  SOS_SAFETY_CHECK_TIMEOUT_JOB,
  sosService,
} from '../safety/sosService';

export function registerSafetyJobWorkers(): void {
  jobEngine.registerWorker(SOS_FINALIZE_ACTIVATION_JOB, async (payload: any, correlationId: string) => {
    const incidentId = String(payload?.incident_id || '');
    if (!incidentId) return;
    const result = sosService.finalizeActivation(incidentId);
    logger.info('SOS activation finalizer processed', {
      correlation_id: correlationId,
      resource_id: incidentId,
      details: { status: result?.status || 'NOT_FOUND' },
    });
  });

  jobEngine.registerWorker(SOS_NOTIFICATION_ATTEMPT_JOB, async (payload: any, correlationId: string) => {
    const attemptId = String(payload?.attempt_id || '');
    if (!attemptId) return;
    const result = await sosService.processNotificationAttempt(attemptId);
    logger.info('SOS notification attempt processed', {
      correlation_id: correlationId,
      resource_id: attemptId,
      details: { status: result?.status || 'NOT_FOUND' },
    });
  });

  jobEngine.registerWorker(SOS_SAFETY_CHECK_TIMEOUT_JOB, async (payload: any, correlationId: string) => {
    const checkId = String(payload?.check_id || '');
    const incidentId = String(payload?.incident_id || '');
    if (!checkId || !incidentId) return;
    const changed = sosService.timeoutSafetyCheck(checkId, incidentId);
    logger.info('SOS safety check timeout processed', {
      correlation_id: correlationId,
      resource_id: incidentId,
      details: { timed_out: changed, injury_inferred: false },
    });
  });

  jobEngine.registerWorker(SOS_LOCATION_RETENTION_JOB, async (_payload: any, correlationId: string) => {
    const pruned = sosService.pruneExpiredLocations();
    logger.info('SOS location retention cleanup processed', {
      correlation_id: correlationId,
      details: { pruned },
    });
  });

  logger.info('Registered Sprint 16 SOS & human-safety job workers');
}
