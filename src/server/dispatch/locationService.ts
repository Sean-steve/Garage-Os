/**
 * Garage OS — Sprint 14: Responder Location & Freshness Engine (GAR-016)
 * Handles raw GPS ingestion, outlier detection, out-of-order rejection,
 * and current location projections.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { calculateHaversineDistanceMeters } from './routingService';
import {
  ResponderType,
  LocationSourceType,
  LocationFreshness,
  LocationQuality,
  MovementState,
  ResponderAvailabilityStatus,
  HeartbeatFreshness,
  ResponderCurrentLocationEntity,
  ResponderLocationObservationEntity,
  ResponderPresenceEntity,
} from './types';

export interface IngestLocationParams {
  responder_type: ResponderType;
  responder_reference_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
  heading_degrees?: number | null;
  speed_meters_per_second?: number | null;
  captured_at: string;
  source_type?: LocationSourceType;
}

export class LocationService {
  /**
   * Evaluates freshness classification for a given timestamp
   */
  evaluateFreshness(capturedAtIso: string, referenceTime = new Date()): LocationFreshness {
    const capturedTime = new Date(capturedAtIso).getTime();
    if (isNaN(capturedTime)) return LocationFreshness.UNKNOWN;

    const diffSeconds = Math.max(0, Math.floor((referenceTime.getTime() - capturedTime) / 1000));
    if (diffSeconds <= 120) {
      return LocationFreshness.FRESH;
    } else if (diffSeconds <= 300) {
      return LocationFreshness.AGING;
    } else {
      return LocationFreshness.STALE;
    }
  }

  /**
   * Evaluates heartbeat freshness classification
   */
  evaluateHeartbeatFreshness(lastHeartbeatIso: string, referenceTime = new Date()): HeartbeatFreshness {
    const heartbeatTime = new Date(lastHeartbeatIso).getTime();
    if (isNaN(heartbeatTime)) return HeartbeatFreshness.STALE;

    const diffSeconds = Math.max(0, Math.floor((referenceTime.getTime() - heartbeatTime) / 1000));
    if (diffSeconds <= 60) {
      return HeartbeatFreshness.FRESH;
    } else if (diffSeconds <= 180) {
      return HeartbeatFreshness.DEGRADED;
    } else {
      return HeartbeatFreshness.STALE;
    }
  }

  /**
   * Ingests a raw GPS telemetry observation, performs validation,
   * detects impossible jumps & out-of-order packets, and updates current projection.
   */
  ingestObservation(params: IngestLocationParams, customDb?: DatabaseSync): {
    observation: ResponderLocationObservationEntity;
    currentProjectionUpdated: boolean;
    projection?: ResponderCurrentLocationEntity;
  } {
    const db = customDb || getDatabase();
    const receivedAt = getCurrentUtcIsoString();
    const sourceType = params.source_type || LocationSourceType.DEVICE_GPS;

    // 1. Basic Coordinate Validation
    const isLatitudeValid = typeof params.latitude === 'number' && params.latitude >= -90 && params.latitude <= 90;
    const isLongitudeValid = typeof params.longitude === 'number' && params.longitude >= -180 && params.longitude <= 180;
    const capturedTime = new Date(params.captured_at).getTime();
    const isTimestampValid = !isNaN(capturedTime);

    let isOutlier = 0;
    let outlierReason: string | null = null;

    if (!isLatitudeValid || !isLongitudeValid || !isTimestampValid) {
      isOutlier = 1;
      outlierReason = 'INVALID_COORDINATES_OR_TIMESTAMP';
    }

    // 2. Fetch existing Current Location for Out-of-Order and Jump Check
    const existingRow = db.prepare(`
      SELECT * FROM responder_current_locations WHERE responder_reference_id = ?;
    `).get(params.responder_reference_id) as any;

    const existingCurrent: ResponderCurrentLocationEntity | null = existingRow
      ? {
          responder_reference_id: existingRow.responder_reference_id,
          responder_type: existingRow.responder_type as ResponderType,
          latitude: existingRow.latitude,
          longitude: existingRow.longitude,
          accuracy_meters: existingRow.accuracy_meters,
          heading_degrees: existingRow.heading_degrees,
          speed_meters_per_second: existingRow.speed_meters_per_second,
          captured_at: existingRow.captured_at,
          received_at: existingRow.received_at,
          freshness_state: existingRow.freshness_state as LocationFreshness,
          quality: existingRow.quality as LocationQuality,
          movement_state: existingRow.movement_state as MovementState,
          source_type: existingRow.source_type as LocationSourceType,
          updated_at: existingRow.updated_at,
        }
      : null;

    let isOutOfOrder = false;

    if (!isOutlier && existingCurrent) {
      const existingCapturedTime = new Date(existingCurrent.captured_at).getTime();

      // Out-of-order check: new captured_at is older than or equal to current projection
      if (capturedTime <= existingCapturedTime) {
        isOutOfOrder = true;
        isOutlier = 1;
        outlierReason = 'OUT_OF_ORDER_TIMESTAMP';
      } else {
        // Impossible jump detection (teleportation check)
        const timeDeltaSeconds = (capturedTime - existingCapturedTime) / 1000;
        const distanceDeltaMeters = calculateHaversineDistanceMeters(
          existingCurrent.latitude,
          existingCurrent.longitude,
          params.latitude,
          params.longitude
        );

        if (timeDeltaSeconds > 0) {
          const calculatedSpeedMps = distanceDeltaMeters / timeDeltaSeconds;
          // > 300 m/s is ~1080 km/h (impossible for road service / tow vehicles)
          if (calculatedSpeedMps > 300 && distanceDeltaMeters > 500) {
            isOutlier = 1;
            outlierReason = `IMPOSSIBLE_SPEED_JUMP: ${Math.round(calculatedSpeedMps)}m/s (${Math.round(distanceDeltaMeters)}m in ${timeDeltaSeconds}s)`;
          }
        }
      }
    }

    // 3. Save Raw Observation
    const observationId = generateCanonicalId('rlo');
    const observation: ResponderLocationObservationEntity = {
      id: observationId,
      responder_type: params.responder_type,
      responder_reference_id: params.responder_reference_id,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy_meters: params.accuracy_meters ?? null,
      heading_degrees: params.heading_degrees ?? null,
      speed_meters_per_second: params.speed_meters_per_second ?? null,
      captured_at: params.captured_at,
      received_at: receivedAt,
      source_type: sourceType,
      is_outlier: isOutlier,
      outlier_reason: outlierReason,
      created_at: receivedAt,
    };

    db.prepare(`
      INSERT INTO responder_location_observations (
        id, responder_type, responder_reference_id, latitude, longitude,
        accuracy_meters, heading_degrees, speed_meters_per_second,
        captured_at, received_at, source_type, is_outlier, outlier_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      observation.id,
      observation.responder_type,
      observation.responder_reference_id,
      observation.latitude,
      observation.longitude,
      observation.accuracy_meters,
      observation.heading_degrees,
      observation.speed_meters_per_second,
      observation.captured_at,
      observation.received_at,
      observation.source_type,
      observation.is_outlier,
      observation.outlier_reason,
      observation.created_at
    );

    // If flagged as outlier (or out-of-order), do NOT update current location projection
    if (isOutlier === 1) {
      return {
        observation,
        currentProjectionUpdated: false,
        projection: existingCurrent || undefined,
      };
    }

    // 4. Determine Quality and Freshness
    let quality = LocationQuality.GOOD;
    if (params.accuracy_meters !== null && params.accuracy_meters !== undefined) {
      if (params.accuracy_meters > 100) {
        quality = LocationQuality.POOR;
      } else if (params.accuracy_meters > 25) {
        quality = LocationQuality.DEGRADED;
      }
    }

    const freshness = this.evaluateFreshness(params.captured_at);

    // Determine movement state
    let movement = MovementState.UNKNOWN;
    if (params.speed_meters_per_second !== null && params.speed_meters_per_second !== undefined) {
      movement = params.speed_meters_per_second > 1.5 ? MovementState.MOVING : MovementState.STATIONARY;
    } else if (existingCurrent) {
      const dist = calculateHaversineDistanceMeters(
        existingCurrent.latitude,
        existingCurrent.longitude,
        params.latitude,
        params.longitude
      );
      movement = dist > 15 ? MovementState.MOVING : MovementState.STATIONARY;
    }

    // 5. Upsert Current Location Projection
    const updatedProjection: ResponderCurrentLocationEntity = {
      responder_reference_id: params.responder_reference_id,
      responder_type: params.responder_type,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy_meters: params.accuracy_meters ?? null,
      heading_degrees: params.heading_degrees ?? null,
      speed_meters_per_second: params.speed_meters_per_second ?? null,
      captured_at: params.captured_at,
      received_at: receivedAt,
      freshness_state: freshness,
      quality,
      movement_state: movement,
      source_type: sourceType,
      updated_at: receivedAt,
    };

    db.prepare(`
      INSERT INTO responder_current_locations (
        responder_reference_id, responder_type, latitude, longitude,
        accuracy_meters, heading_degrees, speed_meters_per_second,
        captured_at, received_at, freshness_state, quality,
        movement_state, source_type, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(responder_reference_id) DO UPDATE SET
        responder_type = excluded.responder_type,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_meters = excluded.accuracy_meters,
        heading_degrees = excluded.heading_degrees,
        speed_meters_per_second = excluded.speed_meters_per_second,
        captured_at = excluded.captured_at,
        received_at = excluded.received_at,
        freshness_state = excluded.freshness_state,
        quality = excluded.quality,
        movement_state = excluded.movement_state,
        source_type = excluded.source_type,
        updated_at = excluded.updated_at;
    `).run(
      updatedProjection.responder_reference_id,
      updatedProjection.responder_type,
      updatedProjection.latitude,
      updatedProjection.longitude,
      updatedProjection.accuracy_meters,
      updatedProjection.heading_degrees,
      updatedProjection.speed_meters_per_second,
      updatedProjection.captured_at,
      updatedProjection.received_at,
      updatedProjection.freshness_state,
      updatedProjection.quality,
      updatedProjection.movement_state,
      updatedProjection.source_type,
      updatedProjection.updated_at
    );

    return {
      observation,
      currentProjectionUpdated: true,
      projection: updatedProjection,
    };
  }

  /**
   * Retrieves the current location projection for a responder
   */
  getCurrentLocation(responderReferenceId: string, customDb?: DatabaseSync): ResponderCurrentLocationEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`
      SELECT * FROM responder_current_locations WHERE responder_reference_id = ?;
    `).get(responderReferenceId) as any;

    if (!row) return null;

    // Dynamically recalculate freshness based on current clock
    const currentFreshness = this.evaluateFreshness(row.captured_at);

    return {
      responder_reference_id: row.responder_reference_id,
      responder_type: row.responder_type as ResponderType,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy_meters: row.accuracy_meters,
      heading_degrees: row.heading_degrees,
      speed_meters_per_second: row.speed_meters_per_second,
      captured_at: row.captured_at,
      received_at: row.received_at,
      freshness_state: currentFreshness,
      quality: row.quality as LocationQuality,
      movement_state: row.movement_state as MovementState,
      source_type: row.source_type as LocationSourceType,
      updated_at: row.updated_at,
    };
  }

  /**
   * Updates responder presence and heartbeat
   */
  updatePresence(params: {
    provider_id: string;
    responder_type: ResponderType;
    responder_reference_id: string;
    status: ResponderAvailabilityStatus;
    current_job_reference?: string | null;
  }, customDb?: DatabaseSync): ResponderPresenceEntity {
    const db = customDb || getDatabase();
    const now = getCurrentUtcIsoString();

    const existing = db.prepare(`
      SELECT * FROM responder_presence WHERE responder_reference_id = ?;
    `).get(params.responder_reference_id) as any;

    if (existing) {
      const availableSince =
        params.status === ResponderAvailabilityStatus.AVAILABLE &&
        existing.status !== ResponderAvailabilityStatus.AVAILABLE
          ? now
          : existing.available_since;

      db.prepare(`
        UPDATE responder_presence
        SET provider_id = ?,
            responder_type = ?,
            status = ?,
            last_heartbeat_at = ?,
            available_since = ?,
            current_job_reference = ?,
            updated_at = ?
        WHERE responder_reference_id = ?;
      `).run(
        params.provider_id,
        params.responder_type,
        params.status,
        now,
        availableSince,
        params.current_job_reference ?? existing.current_job_reference,
        now,
        params.responder_reference_id
      );

      return {
        id: existing.id,
        provider_id: params.provider_id,
        responder_type: params.responder_type,
        responder_reference_id: params.responder_reference_id,
        status: params.status,
        last_heartbeat_at: now,
        available_since: availableSince,
        current_job_reference: params.current_job_reference ?? existing.current_job_reference,
        created_at: existing.created_at,
        updated_at: now,
      };
    } else {
      const id = generateCanonicalId('pres');
      const availableSince = params.status === ResponderAvailabilityStatus.AVAILABLE ? now : null;

      db.prepare(`
        INSERT INTO responder_presence (
          id, provider_id, responder_type, responder_reference_id,
          status, last_heartbeat_at, available_since, current_job_reference,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        id,
        params.provider_id,
        params.responder_type,
        params.responder_reference_id,
        params.status,
        now,
        availableSince,
        params.current_job_reference || null,
        now,
        now
      );

      return {
        id,
        provider_id: params.provider_id,
        responder_type: params.responder_type,
        responder_reference_id: params.responder_reference_id,
        status: params.status,
        last_heartbeat_at: now,
        available_since: availableSince,
        current_job_reference: params.current_job_reference || null,
        created_at: now,
        updated_at: now,
      };
    }
  }

  /**
   * Retrieves presence for a responder
   */
  getPresence(responderReferenceId: string, customDb?: DatabaseSync): ResponderPresenceEntity | null {
    const db = customDb || getDatabase();
    const row = db.prepare(`
      SELECT * FROM responder_presence WHERE responder_reference_id = ?;
    `).get(responderReferenceId) as any;

    if (!row) return null;

    return {
      id: row.id,
      provider_id: row.provider_id,
      responder_type: row.responder_type as ResponderType,
      responder_reference_id: row.responder_reference_id,
      status: row.status as ResponderAvailabilityStatus,
      last_heartbeat_at: row.last_heartbeat_at,
      available_since: row.available_since,
      current_job_reference: row.current_job_reference,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Prunes location observations older than the retention limit (hours)
   */
  pruneOldObservations(retentionHours = 24, customDb?: DatabaseSync): number {
    const db = customDb || getDatabase();
    const cutoffTime = new Date(Date.now() - retentionHours * 3600 * 1000).toISOString();
    const result = db.prepare(`
      DELETE FROM responder_location_observations WHERE captured_at < ?;
    `).run(cutoffTime);
    return result.changes ? Number(result.changes) : 0;
  }
}

export const locationService = new LocationService();
