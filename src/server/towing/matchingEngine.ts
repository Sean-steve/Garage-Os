/**
 * Canonical Towing Provider Matching Engine (GAR-015)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

import { getDatabase } from '../database/connection';
import { haversineDistanceKm } from '../providers/geoUtils';
import { TowingCompatibilityEngine, VehicleSpecsForTowing } from './compatibilityEngine';
import {
  TowCompatibilityStatus,
  RecoveryUnitEntity,
  TowCompatibilityStatus as CompatStatus,
  VehicleCompatibilityEvaluation,
  RecoveryUnitStatus,
} from './types';
import { towingRepository } from './towingRepository';

export interface MatchedTowCandidate {
  provider_id: string;
  provider_name: string;
  recovery_unit_id: string;
  unit_registration: string;
  unit_type: string;
  distance_km: number | null;
  compatibility: VehicleCompatibilityEvaluation;
  estimated_price_minor: number | null;
  currency: string;
}

export interface MatchFilterCriteria {
  pickup_latitude: number;
  pickup_longitude: number;
  max_search_radius_km?: number;
  preferred_provider_id?: string | null;
}

export class TowingMatchingEngine {
  /**
   * Discovers eligible and compatible towing providers for a vehicle recovery request.
   */
  public static findCandidates(
    vehicle: VehicleSpecsForTowing,
    criteria: MatchFilterCriteria
  ): MatchedTowCandidate[] {
    const db = getDatabase();
    const radius = criteria.max_search_radius_km || 50;

    // 1. Fetch candidate service providers that offer towing or have recovery units
    const providers = db
      .prepare(`
        SELECT p.id, p.name, p.provider_type, p.status, p.verification_status,
               p.currency, l.latitude, l.longitude
        FROM service_providers p
        LEFT JOIN provider_locations l ON p.primary_location_id = l.id
        WHERE p.status = 'ACTIVE'
          AND (
            p.provider_type = 'TOWING_RECOVERY'
            OR EXISTS (SELECT 1 FROM recovery_units ru WHERE ru.provider_id = p.id)
          )
      `)
      .all() as Array<{
        id: string;
        name: string;
        provider_type: string;
        status: string;
        verification_status: string;
        currency: string | null;
        latitude: number | null;
        longitude: number | null;
      }>;

    const candidates: MatchedTowCandidate[] = [];

    for (const provider of providers) {
      // Static Sprint 13 matching may use geodesic distance for eligibility/ranking,
      // but it must never invent a distance when provider location is unknown.
      let dist: number | null = null;
      if (provider.latitude != null && provider.longitude != null) {
        dist = haversineDistanceKm(
          criteria.pickup_latitude,
          criteria.pickup_longitude,
          provider.latitude,
          provider.longitude
        );
        if (
          dist > radius &&
          (!criteria.preferred_provider_id || criteria.preferred_provider_id !== provider.id)
        ) {
          continue;
        }
      }

      // Fetch recovery units for this provider
      const units = towingRepository.listRecoveryUnitsByProvider(provider.id);
      const availableUnits = units.filter((u) => u.status === RecoveryUnitStatus.AVAILABLE);

      if (availableUnits.length === 0) {
        continue;
      }

      // Evaluate each available unit for compatibility
      let bestEvaluation: { unit: RecoveryUnitEntity; eval: VehicleCompatibilityEvaluation } | null = null;

      for (const unit of availableUnits) {
        const equipment = towingRepository.listUnitEquipment(unit.id);
        const supportedClasses = towingRepository.listUnitSupportedClasses(unit.id);
        const evalResult = TowingCompatibilityEngine.evaluate(vehicle, unit, equipment, supportedClasses);

        if (evalResult.status === CompatStatus.CONFIRMED) {
          bestEvaluation = { unit, eval: evalResult };
          break; // Found confirmed compatible unit
        } else if (evalResult.status === CompatStatus.LIKELY && (!bestEvaluation || bestEvaluation.eval.status === CompatStatus.UNKNOWN)) {
          bestEvaluation = { unit, eval: evalResult };
        } else if (evalResult.status === CompatStatus.UNKNOWN && !bestEvaluation) {
          bestEvaluation = { unit, eval: evalResult };
        }
      }

      if (bestEvaluation) {
        const roundedDist = dist == null ? null : Math.round(dist * 10) / 10;

        candidates.push({
          provider_id: provider.id,
          provider_name: provider.name,
          recovery_unit_id: bestEvaluation.unit.id,
          unit_registration: bestEvaluation.unit.registration_identifier,
          unit_type: bestEvaluation.unit.unit_type,
          distance_km: roundedDist,
          compatibility: bestEvaluation.eval,
          // Exact tow pricing requires an explicit provider quote/rate model and,
          // for mileage pricing, road distance. Haversine distance never creates a charge.
          estimated_price_minor: null,
          currency: provider.currency || 'KES',
        });
      }
    }

    // Sort: Preferred first, then CONFIRMED over UNKNOWN, then by distance ascending
    candidates.sort((a, b) => {
      if (criteria.preferred_provider_id) {
        if (a.provider_id === criteria.preferred_provider_id) return -1;
        if (b.provider_id === criteria.preferred_provider_id) return 1;
      }
      if (a.compatibility.status === TowCompatibilityStatus.CONFIRMED && b.compatibility.status !== TowCompatibilityStatus.CONFIRMED) {
        return -1;
      }
      if (b.compatibility.status === TowCompatibilityStatus.CONFIRMED && a.compatibility.status !== TowCompatibilityStatus.CONFIRMED) {
        return 1;
      }
      if (a.distance_km == null) return 1;
      if (b.distance_km == null) return -1;
      return a.distance_km - b.distance_km;
    });

    return candidates;
  }
}
