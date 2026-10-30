/**
 * Canonical Vehicle Timeline & Passport Backfill Service (GAR-005 §71-§72, §95)
 *
 * Ensures all existing vehicles and odometer observations from Sprint 3
 * have complete, auditable timeline entries and materialized passport projections.
 * Idempotent and safe to run multiple times.
 */

import { getDatabase } from '../database/connection';
import { timelineRepository } from './timelineRepository';
import { passportBuilder } from './passportBuilder';
import { logger } from '../observability/logger';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  VehicleTimelineEntryEntity,
  TimelineEntryType,
  TimelineCategory,
  TimelineSourceType,
  TimelineVerificationStatus,
  TimelineVisibility,
  TimelineSensitivity,
} from './types';
import { OdometerObservationStatus, OdometerUnit } from '../vehicle/types';

export interface BackfillResult {
  vehicles_processed: number;
  timeline_entries_created: number;
  passports_built: number;
}

export class TimelineBackfillService {
  /**
   * Executes backfill across all existing vehicles in the system.
   */
  backfillAll(): BackfillResult {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const vehicleRows = db.prepare('SELECT * FROM vehicles ORDER BY created_at ASC;').all() as Record<string, unknown>[];
    let entriesCreated = 0;
    let passportsBuilt = 0;

    for (const vRow of vehicleRows) {
      const vehicleId = vRow.id as string;
      const createdAt = vRow.created_at as string;
      const displayName = vRow.display_name as string;
      const make = vRow.make as string;
      const model = vRow.model as string;
      const modelYear = Number(vRow.model_year);

      // 1. Check & Backfill VEHICLE_CREATED
      const createdEntryId = `vte_cre_${vehicleId}`;
      const existingCreated = timelineRepository.getTimelineEntryById(createdEntryId);
      if (!existingCreated) {
        const createdEntry: VehicleTimelineEntryEntity = {
          id: createdEntryId,
          vehicle_id: vehicleId,
          entry_type: TimelineEntryType.VEHICLE_CREATED,
          category: TimelineCategory.IDENTITY,
          occurred_at: createdAt,
          recorded_at: createdAt,
          title: 'Vehicle profile registered',
          summary: `${displayName} registered on Garage OS`,
          source_type: TimelineSourceType.OWNER_ENTERED,
          source_reference_type: 'VEHICLE',
          source_reference_id: vehicleId,
          source_event_id: `backfill:${vehicleId}:created`,
          actor_type: null,
          actor_id: (vRow.created_by as string) || null,
          organization_id: null,
          verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
          confidence: 1.0,
          odometer_value: null,
          odometer_unit: null,
          location_reference: null,
          visibility: TimelineVisibility.OWNER_ONLY,
          sensitivity: TimelineSensitivity.NORMAL,
          supersedes_timeline_entry_id: null,
          corrected_by_timeline_entry_id: null,
          is_active: true,
          metadata: { make, model, model_year: modelYear },
          created_at: now,
          updated_at: now,
        };
        if (timelineRepository.insertTimelineEntry(createdEntry)) {
          entriesCreated++;
        }
      }

      // 2. Check & Backfill OWNERSHIP_STARTED
      const ownershipEntryId = `vte_own_${vehicleId}`;
      const existingOwnership = timelineRepository.getTimelineEntryById(ownershipEntryId);
      if (!existingOwnership) {
        const ownershipEntry: VehicleTimelineEntryEntity = {
          id: ownershipEntryId,
          vehicle_id: vehicleId,
          entry_type: TimelineEntryType.OWNERSHIP_STARTED,
          category: TimelineCategory.OWNERSHIP,
          occurred_at: createdAt,
          recorded_at: createdAt,
          title: 'Initial vehicle ownership established',
          summary: 'Vehicle registered under initial primary ownership',
          source_type: TimelineSourceType.OWNER_ENTERED,
          source_reference_type: 'VEHICLE',
          source_reference_id: vehicleId,
          source_event_id: `backfill:${vehicleId}:ownership`,
          actor_type: null,
          actor_id: (vRow.created_by as string) || null,
          organization_id: null,
          verification_status: TimelineVerificationStatus.OWNER_ASSERTED,
          confidence: 1.0,
          odometer_value: null,
          odometer_unit: null,
          location_reference: null,
          visibility: TimelineVisibility.OWNER_ONLY,
          sensitivity: TimelineSensitivity.NORMAL,
          supersedes_timeline_entry_id: null,
          corrected_by_timeline_entry_id: null,
          is_active: true,
          metadata: {},
          created_at: now,
          updated_at: now,
        };
        if (timelineRepository.insertTimelineEntry(ownershipEntry)) {
          entriesCreated++;
        }
      }

      // 3. Backfill Odometer Observations
      const odoRows = db
        .prepare('SELECT * FROM odometer_observations WHERE vehicle_id = ? ORDER BY recorded_at ASC;')
        .all(vehicleId) as Record<string, unknown>[];

      for (const odo of odoRows) {
        const odoId = odo.id as string;
        const odoEntryId = `vte_odo_${odoId}`;
        const existingOdo = timelineRepository.getTimelineEntryById(odoEntryId);

        if (!existingOdo) {
          const readingKm = Number(odo.reading_km);
          const isFlagged = odo.status === OdometerObservationStatus.FLAGGED;
          const odoEntry: VehicleTimelineEntryEntity = {
            id: odoEntryId,
            vehicle_id: vehicleId,
            entry_type: TimelineEntryType.ODOMETER_RECORDED,
            category: TimelineCategory.MILEAGE,
            occurred_at: (odo.observed_at as string) || (odo.recorded_at as string),
            recorded_at: odo.recorded_at as string,
            title: isFlagged ? 'Mileage observation flagged for review' : 'Mileage observation recorded',
            summary: isFlagged
              ? `Odometer reading of ${readingKm.toLocaleString()} km flagged: ${(odo.flag_reason as string) || 'Mileage regression detected'}`
              : `Odometer reading confirmed at ${readingKm.toLocaleString()} km`,
            source_type: (odo.source_class as TimelineSourceType) || TimelineSourceType.OWNER_ENTERED,
            source_reference_type: 'ODOMETER_OBSERVATION',
            source_reference_id: odoId,
            source_event_id: `backfill:${odoId}`,
            actor_type: null,
            actor_id: (odo.actor_id as string) || null,
            organization_id: null,
            verification_status: isFlagged ? TimelineVerificationStatus.DISPUTED : TimelineVerificationStatus.VERIFIED,
            confidence: isFlagged ? 0.5 : 1.0,
            odometer_value: readingKm,
            odometer_unit: (odo.unit as OdometerUnit) || OdometerUnit.KM,
            location_reference: null,
            visibility: TimelineVisibility.OWNER_ONLY,
            sensitivity: TimelineSensitivity.NORMAL,
            supersedes_timeline_entry_id: null,
            corrected_by_timeline_entry_id: null,
            is_active: true,
            metadata: {
              reading_km: readingKm,
              flag_reason: odo.flag_reason || null,
            },
            created_at: now,
            updated_at: now,
          };

          if (timelineRepository.insertTimelineEntry(odoEntry)) {
            entriesCreated++;
          }
        }
      }

      // 4. Build or Refresh Materialized Passport Projection
      try {
        passportBuilder.buildPassport(vehicleId);
        passportsBuilt++;
      } catch (err) {
        logger.warn(`Backfill could not build passport for vehicle ${vehicleId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`Timeline backfill complete: ${vehicleRows.length} vehicles, ${entriesCreated} entries created, ${passportsBuilt} passports built.`);

    return {
      vehicles_processed: vehicleRows.length,
      timeline_entries_created: entriesCreated,
      passports_built: passportsBuilt,
    };
  }
}

export const timelineBackfillService = new TimelineBackfillService();
