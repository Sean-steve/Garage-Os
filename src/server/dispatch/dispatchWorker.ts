/**
 * Garage OS — Sprint 14: Dispatch Background Worker (GAR-016)
 * Periodically evaluates responder presence heartbeats, location staleness,
 * offer expiration, and telemetry retention pruning.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { locationService } from './locationService';
import { realtimeBus } from './realtimeBus';
import {
  ResponderAvailabilityStatus,
  LocationFreshness,
  DispatchAttemptStatus,
  DispatchRequestStatus,
} from './types';

export class DispatchWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs = 15000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runEvaluationCycle().catch((err) => {
        logger.error(`Error in dispatch worker cycle: ${err}`);
      });
    }, intervalMs);
    logger.info(`Dispatch background worker started (interval: ${intervalMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runEvaluationCycle(customDb?: DatabaseSync) {
    if (this.isRunning) return;
    this.isRunning = true;
    const db = customDb || getDatabase();
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      // 1. Evaluate Heartbeat Staleness (> 180s stale)
      const heartbeatCutoff = new Date(now.getTime() - 180 * 1000).toISOString();
      const staleHeartbeatResponders = db.prepare(`
        SELECT responder_reference_id, status FROM responder_presence
        WHERE status IN ('AVAILABLE', 'AVAILABLE_LIMITED') AND last_heartbeat_at < ?;
      `).all(heartbeatCutoff) as Array<{ responder_reference_id: string; status: string }>;

      if (staleHeartbeatResponders.length > 0) {
        db.prepare(`
          UPDATE responder_presence
          SET status = 'UNKNOWN', updated_at = ?
          WHERE status IN ('AVAILABLE', 'AVAILABLE_LIMITED') AND last_heartbeat_at < ?;
        `).run(nowIso, heartbeatCutoff);

        for (const resp of staleHeartbeatResponders) {
          realtimeBus.publish(`responder.${resp.responder_reference_id}`, 'PRESENCE_STALE', {
            responder_reference_id: resp.responder_reference_id,
            status: ResponderAvailabilityStatus.UNKNOWN,
          });
        }
      }

      // 2. Evaluate Location Staleness (> 300s stale)
      const locationCutoff = new Date(now.getTime() - 300 * 1000).toISOString();
      db.prepare(`
        UPDATE responder_current_locations
        SET freshness_state = 'STALE', updated_at = ?
        WHERE freshness_state != 'STALE' AND captured_at < ?;
      `).run(nowIso, locationCutoff);

      // 3. Evaluate Expired Dispatch Attempts
      const expiredAttempts = db.prepare(`
        SELECT da.id, da.dispatch_request_id, da.attempt_number, da.search_radius_km
        FROM dispatch_attempts da
        JOIN dispatch_requests dr ON da.dispatch_request_id = dr.id
        WHERE da.status = 'OFFERS_SENT' AND da.expires_at < ? AND dr.status = 'OFFERING';
      `).all(nowIso) as Array<{
        id: string;
        dispatch_request_id: string;
        attempt_number: number;
        search_radius_km: number;
      }>;

      for (const attempt of expiredAttempts) {
        db.prepare(`
          UPDATE dispatch_attempts
          SET status = 'TIMED_OUT', completed_at = ?
          WHERE id = ?;
        `).run(nowIso, attempt.id);

        realtimeBus.publish(`dispatch.request.${attempt.dispatch_request_id}`, 'ATTEMPT_TIMED_OUT', {
          dispatch_request_id: attempt.dispatch_request_id,
          attempt_id: attempt.id,
        });
      }

      // 4. Prune raw location observations older than 24 hours
      locationService.pruneOldObservations(24, db);
    } catch (err) {
      logger.error(`DispatchWorker cycle encountered error: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }
}

export const dispatchWorker = new DispatchWorker();
