/**
 * Canonical Vehicle Timeline & Digital Vehicle Passport Repository (GAR-005, GAR-033 §12C)
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  VehicleTimelineEntryEntity,
  TimelineCorrectionEntity,
  TimelineDisputeEntity,
  VehiclePassportProjectionEntity,
  PassportShareGrantEntity,
  PassportShareAccessLogEntity,
  TimelineFilterQueryDTO,
  TimelineEntryType,
  TimelineCategory,
  TimelineSourceType,
  TimelineVerificationStatus,
  TimelineVisibility,
  TimelineSensitivity,
  TimelineCorrectionReason,
} from './types';
import { CanonicalActorType } from '../../shared/types';
import { OdometerUnit } from '../vehicle/types';

export class TimelineRepository {
  /**
   * Idempotently persists a timeline entry.
   * If source_event_id already exists, ignores the insert to prevent duplicate events.
   * Returns true if newly created, false if skipped due to existing source_event_id.
   */
  insertTimelineEntry(entry: VehicleTimelineEntryEntity): boolean {
    const db = getDatabase();

    if (entry.source_event_id) {
      const existing = db
        .prepare('SELECT id FROM vehicle_timeline_entries WHERE source_event_id = ?;')
        .get(entry.source_event_id) as { id: string } | undefined;
      if (existing) {
        return false;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO vehicle_timeline_entries (
        id, vehicle_id, entry_type, category, occurred_at, recorded_at,
        title, summary, source_type, source_reference_type, source_reference_id,
        source_event_id, actor_type, actor_id, organization_id,
        verification_status, confidence, odometer_value, odometer_unit,
        location_reference, visibility, sensitivity, supersedes_timeline_entry_id,
        corrected_by_timeline_entry_id, is_active, metadata, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      );
    `);

    stmt.run(
      entry.id,
      entry.vehicle_id,
      entry.entry_type,
      entry.category,
      entry.occurred_at,
      entry.recorded_at,
      entry.title,
      entry.summary,
      entry.source_type,
      entry.source_reference_type || null,
      entry.source_reference_id || null,
      entry.source_event_id || null,
      entry.actor_type || null,
      entry.actor_id || null,
      entry.organization_id || null,
      entry.verification_status,
      entry.confidence !== undefined ? entry.confidence : null,
      entry.odometer_value !== undefined ? entry.odometer_value : null,
      entry.odometer_unit || null,
      entry.location_reference || null,
      entry.visibility,
      entry.sensitivity,
      entry.supersedes_timeline_entry_id || null,
      entry.corrected_by_timeline_entry_id || null,
      entry.is_active ? 1 : 0,
      JSON.stringify(entry.metadata || {}),
      entry.created_at,
      entry.updated_at
    );

    return true;
  }

  /**
   * Retrieves a single timeline entry by ID.
   */
  getTimelineEntryById(id: string): VehicleTimelineEntryEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_timeline_entries WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapTimelineRowToEntity(row);
  }

  /**
   * Retrieves paginated timeline entries for a vehicle with filtering.
   * Chronologically ordered by occurred_at DESC, id DESC.
   */
  getTimelineEntries(
    vehicleId: string,
    filters: TimelineFilterQueryDTO = {}
  ): { entries: VehicleTimelineEntryEntity[]; totalCount: number; nextCursor: string | null } {
    const db = getDatabase();

    const conditions: string[] = ['vehicle_id = ?'];
    const params: (string | number | null)[] = [vehicleId];

    if (!filters.include_superseded) {
      conditions.push('is_active = 1');
    }

    if (filters.category && filters.category !== TimelineCategory.ALL) {
      conditions.push('category = ?');
      params.push(filters.category);
    }

    if (filters.entry_type) {
      conditions.push('entry_type = ?');
      params.push(filters.entry_type);
    }

    if (filters.from_date) {
      conditions.push('occurred_at >= ?');
      params.push(filters.from_date);
    }

    if (filters.to_date) {
      conditions.push('occurred_at <= ?');
      params.push(filters.to_date);
    }

    // Cursor pagination (cursor format: base64(occurred_at:id))
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const [cursorTime, cursorId] = decoded.split(':');
        if (cursorTime && cursorId) {
          conditions.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
          params.push(cursorTime, cursorTime, cursorId);
        }
      } catch {
        // Ignore malformed cursor
      }
    }

    const whereClause = conditions.join(' AND ');

    // Get total count matching criteria (without cursor limit)
    const countConditions = conditions.filter((c) => !c.includes('< ?'));
    const countParams = params.slice(0, countConditions.length === 1 ? 1 : countConditions.length);
    // Safer count query
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM vehicle_timeline_entries WHERE vehicle_id = ?;`).get(vehicleId) as { count: number };
    const totalCount = totalRow ? totalRow.count : 0;

    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    const query = `
      SELECT * FROM vehicle_timeline_entries
      WHERE ${whereClause}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?;
    `;

    const rows = db.prepare(query).all(...params, limit + 1) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const entries = resultRows.map((r) => this.mapTimelineRowToEntity(r));

    let nextCursor: string | null = null;
    if (hasMore && resultRows.length > 0) {
      const last = resultRows[resultRows.length - 1];
      const cursorStr = `${last.occurred_at}:${last.id}`;
      nextCursor = Buffer.from(cursorStr, 'utf-8').toString('base64');
    }

    return {
      entries,
      totalCount,
      nextCursor,
    };
  }

  /**
   * Retrieves all timeline entries for a vehicle (active and inactive), chronologically sorted.
   * Useful for passport projection building.
   */
  getAllVehicleTimelineEntries(vehicleId: string): VehicleTimelineEntryEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM vehicle_timeline_entries WHERE vehicle_id = ? ORDER BY occurred_at DESC, id DESC;')
      .all(vehicleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapTimelineRowToEntity(r));
  }

  listTimelineEntries(vehicleId: string): VehicleTimelineEntryEntity[] {
    return this.getAllVehicleTimelineEntries(vehicleId);
  }

  /**
   * Performs a non-destructive correction of an existing timeline entry.
   * Atomically marks original entry as SUPERSEDED (is_active = 0, corrected_by_timeline_entry_id = newEntry.id),
   * inserts corrected entry, and logs correction audit record.
   */
  recordCorrection(params: {
    originalEntryId: string;
    vehicleId: string;
    correctionReason: TimelineCorrectionReason;
    explanation: string;
    actorId: string;
    actorType: string;
    correctedEntry: VehicleTimelineEntryEntity;
  }): {
    original: VehicleTimelineEntryEntity;
    corrected: VehicleTimelineEntryEntity;
    correction: TimelineCorrectionEntity;
  } {
    return withTransaction(() => {
      const db = getDatabase();
      const now = getCurrentUtcIsoString();

      const originalRow = db
        .prepare('SELECT * FROM vehicle_timeline_entries WHERE id = ? AND vehicle_id = ?;')
        .get(params.originalEntryId, params.vehicleId) as Record<string, unknown> | undefined;

      if (!originalRow) {
        throw new Error(`Original timeline entry ${params.originalEntryId} not found for vehicle ${params.vehicleId}`);
      }

      // Mark original entry superseded
      db.prepare(`
        UPDATE vehicle_timeline_entries
        SET corrected_by_timeline_entry_id = ?,
            verification_status = 'SUPERSEDED',
            is_active = 0,
            updated_at = ?
        WHERE id = ?;
      `).run(params.correctedEntry.id, now, params.originalEntryId);

      // Insert corrected entry
      this.insertTimelineEntry(params.correctedEntry);

      // Create correction audit record
      const correctionId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      db.prepare(`
        INSERT INTO vehicle_timeline_corrections (
          id, vehicle_id, original_entry_id, corrected_entry_id,
          correction_reason, explanation, actor_id, actor_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        correctionId,
        params.vehicleId,
        params.originalEntryId,
        params.correctedEntry.id,
        params.correctionReason,
        params.explanation,
        params.actorId,
        params.actorType,
        now
      );

      const updatedOriginal = this.getTimelineEntryById(params.originalEntryId)!;
      const correction: TimelineCorrectionEntity = {
        id: correctionId,
        vehicle_id: params.vehicleId,
        original_entry_id: params.originalEntryId,
        corrected_entry_id: params.correctedEntry.id,
        correction_reason: params.correctionReason,
        explanation: params.explanation,
        actor_id: params.actorId,
        actor_type: params.actorType,
        created_at: now,
      };

      return {
        original: updatedOriginal,
        corrected: params.correctedEntry,
        correction,
      };
    });
  }

  /**
   * Records a dispute against a timeline entry.
   */
  recordDispute(params: {
    entryId: string;
    vehicleId: string;
    disputeReason: string;
    actorId: string;
  }): TimelineDisputeEntity {
    return withTransaction(() => {
      const db = getDatabase();
      const now = getCurrentUtcIsoString();

      db.prepare(`
        UPDATE vehicle_timeline_entries
        SET verification_status = 'DISPUTED',
            updated_at = ?
        WHERE id = ? AND vehicle_id = ?;
      `).run(now, params.entryId, params.vehicleId);

      const disputeId = `disp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      db.prepare(`
        INSERT INTO vehicle_timeline_disputes (
          id, vehicle_id, timeline_entry_id, dispute_reason, actor_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?);
      `).run(disputeId, params.vehicleId, params.entryId, params.disputeReason, params.actorId, now);

      return {
        id: disputeId,
        vehicle_id: params.vehicleId,
        timeline_entry_id: params.entryId,
        dispute_reason: params.disputeReason,
        actor_id: params.actorId,
        status: 'OPEN',
        resolved_at: null,
        resolution_notes: null,
        created_at: now,
      };
    });
  }

  /**
   * Retrieves correction history for an entry.
   */
  getCorrectionsForEntry(entryId: string): TimelineCorrectionEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM vehicle_timeline_corrections WHERE original_entry_id = ? OR corrected_entry_id = ? ORDER BY created_at ASC;')
      .all(entryId, entryId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      vehicle_id: r.vehicle_id as string,
      original_entry_id: r.original_entry_id as string,
      corrected_entry_id: r.corrected_entry_id as string,
      correction_reason: r.correction_reason as TimelineCorrectionReason,
      explanation: r.explanation as string,
      actor_id: r.actor_id as string,
      actor_type: r.actor_type as string,
      created_at: r.created_at as string,
    }));
  }

  /**
   * Retrieves disputes for an entry.
   */
  getDisputesForEntry(entryId: string): TimelineDisputeEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM vehicle_timeline_disputes WHERE timeline_entry_id = ? ORDER BY created_at ASC;')
      .all(entryId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      vehicle_id: r.vehicle_id as string,
      timeline_entry_id: r.timeline_entry_id as string,
      dispute_reason: r.dispute_reason as string,
      actor_id: r.actor_id as string,
      status: r.status as 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED',
      resolved_at: (r.resolved_at as string) || null,
      resolution_notes: (r.resolution_notes as string) || null,
      created_at: r.created_at as string,
    }));
  }

  /**
   * Passport projection retrieval.
   */
  getPassportProjection(vehicleId: string): VehiclePassportProjectionEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM vehicle_passport_projections WHERE vehicle_id = ?;')
      .get(vehicleId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      vehicle_id: row.vehicle_id as string,
      version: Number(row.version),
      passport_payload: row.passport_payload as string,
      integrity_hash: row.integrity_hash as string,
      source_version: Number(row.source_version),
      is_stale: Boolean(row.is_stale),
      last_projected_at: row.last_projected_at as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  /**
   * Materializes or updates passport projection.
   */
  upsertPassportProjection(projection: VehiclePassportProjectionEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_passport_projections (
        vehicle_id, version, passport_payload, integrity_hash,
        source_version, is_stale, last_projected_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vehicle_id) DO UPDATE SET
        version = excluded.version,
        passport_payload = excluded.passport_payload,
        integrity_hash = excluded.integrity_hash,
        source_version = excluded.source_version,
        is_stale = 0,
        last_projected_at = excluded.last_projected_at,
        updated_at = excluded.updated_at;
    `).run(
      projection.vehicle_id,
      projection.version,
      projection.passport_payload,
      projection.integrity_hash,
      projection.source_version,
      projection.is_stale ? 1 : 0,
      projection.last_projected_at,
      projection.created_at,
      projection.updated_at
    );
  }

  /**
   * Marks passport projection as stale to prompt re-projection.
   */
  markPassportProjectionStale(vehicleId: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE vehicle_passport_projections
      SET is_stale = 1, updated_at = ?
      WHERE vehicle_id = ?;
    `).run(getCurrentUtcIsoString(), vehicleId);
  }

  /**
   * Creates a passport secure share grant.
   */
  createPassportShareGrant(grant: PassportShareGrantEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_passport_share_grants (
        id, vehicle_id, created_by, token_hash, scope,
        recipient_label, expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      grant.id,
      grant.vehicle_id,
      grant.created_by,
      grant.token_hash,
      grant.scope,
      grant.recipient_label || null,
      grant.expires_at,
      grant.revoked_at || null,
      grant.created_at
    );
  }

  /**
   * Looks up a share grant by SHA-256 token hash.
   */
  getPassportShareGrantByTokenHash(tokenHash: string): PassportShareGrantEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM vehicle_passport_share_grants WHERE token_hash = ?;')
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapShareGrantRowToEntity(row);
  }

  /**
   * Looks up a share grant by ID.
   */
  getPassportShareGrantById(shareId: string): PassportShareGrantEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM vehicle_passport_share_grants WHERE id = ?;')
      .get(shareId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapShareGrantRowToEntity(row);
  }

  /**
   * Retrieves active share grants for a vehicle.
   */
  getPassportShareGrantsForVehicle(vehicleId: string): PassportShareGrantEntity[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM vehicle_passport_share_grants WHERE vehicle_id = ? ORDER BY created_at DESC;')
      .all(vehicleId) as Record<string, unknown>[];
    return rows.map((r) => this.mapShareGrantRowToEntity(r));
  }

  /**
   * Revokes a share grant.
   */
  revokePassportShareGrant(shareId: string, vehicleId: string): boolean {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();
    const result = db
      .prepare('UPDATE vehicle_passport_share_grants SET revoked_at = ? WHERE id = ? AND vehicle_id = ? AND revoked_at IS NULL;')
      .run(now, shareId, vehicleId);
    return result.changes > 0;
  }

  /**
   * Records an access log entry for a passport share token use.
   */
  logPassportShareAccess(accessLog: PassportShareAccessLogEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_passport_share_access_logs (
        id, share_grant_id, ip_address, user_agent, accessed_at
      ) VALUES (?, ?, ?, ?, ?);
    `).run(
      accessLog.id,
      accessLog.share_grant_id,
      accessLog.ip_address || null,
      accessLog.user_agent || null,
      accessLog.accessed_at
    );
  }

  // --- Helper Mapping Methods ---

  private mapTimelineRowToEntity(row: Record<string, unknown>): VehicleTimelineEntryEntity {
    let metadata: Record<string, unknown> = {};
    if (typeof row.metadata === 'string') {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }
    } else if (row.metadata && typeof row.metadata === 'object') {
      metadata = row.metadata as Record<string, unknown>;
    }

    return {
      id: row.id as string,
      vehicle_id: row.vehicle_id as string,
      entry_type: row.entry_type as TimelineEntryType,
      category: row.category as TimelineCategory,
      occurred_at: row.occurred_at as string,
      recorded_at: row.recorded_at as string,
      title: row.title as string,
      summary: row.summary as string,
      source_type: row.source_type as TimelineSourceType,
      source_reference_type: (row.source_reference_type as string) || null,
      source_reference_id: (row.source_reference_id as string) || null,
      source_event_id: (row.source_event_id as string) || null,
      actor_type: (row.actor_type as CanonicalActorType) || null,
      actor_id: (row.actor_id as string) || null,
      organization_id: (row.organization_id as string) || null,
      verification_status: row.verification_status as TimelineVerificationStatus,
      confidence: row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : null,
      odometer_value: row.odometer_value !== null && row.odometer_value !== undefined ? Number(row.odometer_value) : null,
      odometer_unit: (row.odometer_unit as OdometerUnit) || null,
      location_reference: (row.location_reference as string) || null,
      visibility: row.visibility as TimelineVisibility,
      sensitivity: row.sensitivity as TimelineSensitivity,
      supersedes_timeline_entry_id: (row.supersedes_timeline_entry_id as string) || null,
      corrected_by_timeline_entry_id: (row.corrected_by_timeline_entry_id as string) || null,
      is_active: Boolean(row.is_active),
      metadata,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private mapShareGrantRowToEntity(row: Record<string, unknown>): PassportShareGrantEntity {
    return {
      id: row.id as string,
      vehicle_id: row.vehicle_id as string,
      created_by: row.created_by as string,
      token_hash: row.token_hash as string,
      scope: row.scope as string,
      recipient_label: (row.recipient_label as string) || null,
      expires_at: row.expires_at as string,
      revoked_at: (row.revoked_at as string) || null,
      created_at: row.created_at as string,
    };
  }
}

export const timelineRepository = new TimelineRepository();
