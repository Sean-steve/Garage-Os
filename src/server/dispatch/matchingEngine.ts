/**
 * Garage OS — Sprint 14: Dispatch Candidate Discovery & Ranking Engine (GAR-016)
 * Implements deterministic matching, hard filtering, weighted multi-factor scoring,
 * and ranking with complete auditability of exclusion reasons.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { routingService, calculateHaversineDistanceMeters } from './routingService';
import { locationService } from './locationService';
import {
  DispatchDomain,
  DispatchCandidateEntity,
  ResponderType,
  ResponderAvailabilityStatus,
  LocationFreshness,
  DistanceType,
  EtaSource,
  ExclusionReason,
} from './types';

export interface MatchingParams {
  dispatchRequestId: string;
  dispatchAttemptId: string;
  domain: DispatchDomain;
  requiredCapability: string;
  pickupLatitude: number;
  pickupLongitude: number;
  vehicleId?: string | null;
  searchRadiusKm: number;
  maxCandidates?: number;
}

export class MatchingEngine {
  readonly STRATEGY_VERSION = 'v1.0';

  /**
   * Discovers and ranks candidate responders for a dispatch request.
   */
  async evaluateCandidates(
    params: MatchingParams,
    customDb?: DatabaseSync
  ): Promise<DispatchCandidateEntity[]> {
    const db = customDb || getDatabase();
    const now = getCurrentUtcIsoString();
    const maxRadiusMeters = params.searchRadiusKm * 1000;

    // 1. Fetch potential providers and their units/staff
    // Providers must be active
    let activeProviders: Array<{ id: string; name: string }> = [];
    try {
      activeProviders = db.prepare(`
        SELECT id, name
        FROM service_providers
        WHERE status = 'ACTIVE';
      `).all() as Array<{ id: string; name: string }>;
    } catch {
      activeProviders = [];
    }

    const candidates: DispatchCandidateEntity[] = [];

    // Query active assignments across roadside and towing to identify busy units/technicians
    const busyRoadsideResponders = new Set<string>();
    try {
      const activeRoadsideRows = db.prepare(`
        SELECT assigned_technician_id, provider_id
        FROM roadside_assignments
        WHERE status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ARRIVED', 'ON_SITE', 'IN_PROGRESS');
      `).all() as Array<{ assigned_technician_id: string | null; provider_id: string }>;

      for (const row of activeRoadsideRows) {
        if (row.assigned_technician_id) {
          busyRoadsideResponders.add(row.assigned_technician_id);
        }
      }
    } catch {
      // Table might not exist in isolated tests
    }

    const busyTowUnits = new Set<string>();
    try {
      const activeTowRows = db.prepare(`
        SELECT recovery_unit_id
        FROM tow_assignments
        WHERE status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'VEHICLE_LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING');
      `).all() as Array<{ recovery_unit_id: string }>;

      for (const row of activeTowRows) {
        if (row.recovery_unit_id) {
          busyTowUnits.add(row.recovery_unit_id);
        }
      }
    } catch {
      // Table might not exist in isolated tests
    }

    // Iterate through active providers
    for (const provider of activeProviders) {
      // Check provider capabilities
      const hasCapability = this.checkProviderCapability(
        provider.id,
        params.domain,
        params.requiredCapability,
        db
      );

      // Depending on domain, evaluate responders:
      // For TOWING -> evaluate recovery_units
      // For ROADSIDE / MOBILE_SERVICE -> evaluate provider staff or general provider mobile unit
      const responderUnits = this.getRespondersForProvider(provider.id, params.domain, db);

      for (const responder of responderUnits) {
        const candidateId = generateCanonicalId('dc');

        // Fetch presence
        const presence = locationService.getPresence(responder.referenceId, db);
        // Fetch current location
        const currentLocation = locationService.getCurrentLocation(responder.referenceId, db);

        // --- HARD FILTERS ---
        let eligibilityStatus: 'ELIGIBLE' | 'EXCLUDED' = 'ELIGIBLE';
        let exclusionReason: ExclusionReason | null = null;

        if (!hasCapability) {
          eligibilityStatus = 'EXCLUDED';
          exclusionReason = ExclusionReason.CAPABILITY_MISMATCH;
        } else if (!presence || presence.status === ResponderAvailabilityStatus.OFFLINE || presence.status === ResponderAvailabilityStatus.OUT_OF_SERVICE || presence.status === ResponderAvailabilityStatus.PAUSED) {
          eligibilityStatus = 'EXCLUDED';
          exclusionReason = ExclusionReason.RESPONDER_OFFLINE;
        } else if (
          presence.status === ResponderAvailabilityStatus.ON_JOB ||
          presence.status === ResponderAvailabilityStatus.BUSY ||
          busyRoadsideResponders.has(responder.referenceId) ||
          busyTowUnits.has(responder.referenceId)
        ) {
          eligibilityStatus = 'EXCLUDED';
          exclusionReason = ExclusionReason.ALREADY_ASSIGNED;
        } else if (!currentLocation) {
          eligibilityStatus = 'EXCLUDED';
          exclusionReason = ExclusionReason.UNKNOWN_LOCATION;
        }

        let distanceMeters: number | null = null;
        let distanceType: DistanceType | null = null;
        let etaSeconds: number | null = null;
        let etaSource: EtaSource | null = null;
        let locationFreshness: LocationFreshness | null = null;

        if (currentLocation) {
          locationFreshness = currentLocation.freshness_state;

          // Compute distance
          const distanceGeodesic = calculateHaversineDistanceMeters(
            currentLocation.latitude,
            currentLocation.longitude,
            params.pickupLatitude,
            params.pickupLongitude
          );

          if (eligibilityStatus === 'ELIGIBLE' && distanceGeodesic > maxRadiusMeters) {
            eligibilityStatus = 'EXCLUDED';
            exclusionReason = ExclusionReason.OUT_OF_RANGE;
          }

          if (eligibilityStatus === 'ELIGIBLE') {
            // Compute routing & ETA
            const routeResult = await routingService.computeRoute(
              { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
              { latitude: params.pickupLatitude, longitude: params.pickupLongitude },
              { db }
            );

            distanceMeters = routeResult.distanceMeters;
            distanceType = routeResult.distanceType;
            etaSeconds = routeResult.durationSeconds;
            etaSource = routeResult.source;
          } else {
            distanceMeters = distanceGeodesic;
            distanceType = DistanceType.GEODESIC_DISTANCE;
            etaSource = EtaSource.UNAVAILABLE;
          }
        }

        // --- SCORING ---
        let capabilityScore = 1.0;
        let distanceScore = 0.0;
        let etaScore = 0.0;
        let workloadScore = 1.0;
        let freshnessMultiplier = 1.0;
        let overallScore = 0.0;

        if (eligibilityStatus === 'ELIGIBLE' && distanceMeters !== null) {
          // Distance score: 1.0 at 0m, decaying to 0.0 at searchRadiusMeters
          distanceScore = Math.max(0, Math.min(1, 1 - distanceMeters / maxRadiusMeters));

          // ETA score: 1.0 at 0s, 0.0 at 3600s (1 hr)
          if (etaSeconds !== null && etaSeconds >= 0) {
            etaScore = Math.max(0, Math.min(1, 1 - etaSeconds / 3600));
          } else {
            // If ETA is unavailable, use distance-based approximation for score
            etaScore = distanceScore;
          }

          // Workload score: 1.0 if AVAILABLE, 0.7 if AVAILABLE_LIMITED
          if (presence?.status === ResponderAvailabilityStatus.AVAILABLE_LIMITED) {
            workloadScore = 0.7;
          }

          // Location Freshness multiplier: FRESH = 1.0, AGING = 0.75, STALE = 0.4
          if (locationFreshness === LocationFreshness.AGING) {
            freshnessMultiplier = 0.75;
          } else if (locationFreshness === LocationFreshness.STALE) {
            freshnessMultiplier = 0.4;
          }

          // Overall weighted score
          overallScore =
            0.35 * distanceScore +
            0.25 * etaScore +
            0.20 * capabilityScore +
            0.10 * workloadScore +
            0.10 * freshnessMultiplier;

          // Round to 4 decimal places
          overallScore = Math.round(overallScore * 10000) / 10000;
        }

        candidates.push({
          id: candidateId,
          dispatch_request_id: params.dispatchRequestId,
          dispatch_attempt_id: params.dispatchAttemptId,
          provider_id: provider.id,
          responder_type: responder.type,
          responder_reference_id: responder.referenceId,
          eligibility_status: eligibilityStatus,
          distance_meters: distanceMeters,
          distance_type: distanceType,
          eta_seconds: etaSeconds,
          eta_source: etaSource,
          location_freshness: locationFreshness,
          availability_state: presence?.status || ResponderAvailabilityStatus.OFFLINE,
          capability_score: capabilityScore,
          distance_score: distanceScore,
          eta_score: etaScore,
          workload_score: workloadScore,
          overall_score: overallScore,
          rank: null,
          exclusion_reason: exclusionReason,
          strategy_version: this.STRATEGY_VERSION,
          created_at: now,
        });
      }
    }

    // --- DETERMINISTIC RANKING ---
    // Separate eligible and excluded
    const eligibleCandidates = candidates.filter((c) => c.eligibility_status === 'ELIGIBLE');
    const excludedCandidates = candidates.filter((c) => c.eligibility_status === 'EXCLUDED');

    // Sort eligible by:
    // 1. overall_score DESC
    // 2. distance_meters ASC
    // 3. responder_reference_id ASC (deterministic tiebreaker)
    eligibleCandidates.sort((a, b) => {
      if (b.overall_score !== a.overall_score) {
        return b.overall_score - a.overall_score;
      }
      const distA = a.distance_meters ?? Infinity;
      const distB = b.distance_meters ?? Infinity;
      if (distA !== distB) {
        return distA - distB;
      }
      return a.responder_reference_id.localeCompare(b.responder_reference_id);
    });

    // Assign sequential ranks: 1, 2, 3...
    eligibleCandidates.forEach((c, idx) => {
      c.rank = idx + 1;
    });

    // Limit to maxCandidates if provided
    const rankedEligible = params.maxCandidates
      ? eligibleCandidates.slice(0, params.maxCandidates)
      : eligibleCandidates;

    return [...rankedEligible, ...excludedCandidates];
  }

  /**
   * Helper to check if a provider has the requested capability
   */
  private checkProviderCapability(
    providerId: string,
    domain: DispatchDomain,
    capability: string,
    db: DatabaseSync
  ): boolean {
    if (domain === DispatchDomain.TOWING) {
      try {
        const profile = db.prepare(`
          SELECT id FROM tow_capability_profiles
          WHERE provider_id = ? AND is_active = 1;
        `).get(providerId);
        return !!profile;
      } catch {
        return true;
      }
    } else {
      try {
        const row = db.prepare(`
          SELECT id FROM provider_capabilities
          WHERE provider_id = ? AND capability_code = ?;
        `).get(providerId, capability);
        if (row) return true;

        // Also check if provider services general roadside
        const services = db.prepare(`
          SELECT services_offered FROM service_providers WHERE id = ?;
        `).get(providerId) as any;

        if (services && services.services_offered) {
          return services.services_offered.includes(capability) ||
                 services.services_offered.includes('ROADSIDE_ASSISTANCE') ||
                 services.services_offered.includes('EMERGENCY_DISPATCH');
        }
        return true;
      } catch {
        return true;
      }
    }
  }

  /**
   * Discovers responder units (staff or recovery units) associated with a provider
   */
  private getRespondersForProvider(
    providerId: string,
    domain: DispatchDomain,
    db: DatabaseSync
  ): Array<{ type: ResponderType; referenceId: string }> {
    const list: Array<{ type: ResponderType; referenceId: string }> = [];

    // Check responder_presence for registered responders
    try {
      const presenceRows = db.prepare(`
        SELECT responder_type, responder_reference_id
        FROM responder_presence
        WHERE provider_id = ?;
      `).all(providerId) as Array<{ responder_type: string; responder_reference_id: string }>;

      for (const p of presenceRows) {
        list.push({ type: p.responder_type as ResponderType, referenceId: p.responder_reference_id });
      }
    } catch {
      // Ignore
    }

    if (domain === DispatchDomain.TOWING) {
      try {
        const units = db.prepare(`
          SELECT id FROM recovery_units
          WHERE provider_id = ? AND operational_status != 'OUT_OF_SERVICE';
        `).all(providerId) as Array<{ id: string }>;

        for (const unit of units) {
          if (!list.some(r => r.referenceId === unit.id)) {
            list.push({ type: ResponderType.RECOVERY_UNIT, referenceId: unit.id });
          }
        }
      } catch {
        // Fallback to provider general entity
      }
    } else {
      // Roadside / mobile mechanics: check users/staff belonging to provider
      try {
        const staff = db.prepare(`
          SELECT id FROM users
          WHERE provider_id = ? AND status = 'ACTIVE';
        `).all(providerId) as Array<{ id: string }>;

        for (const member of staff) {
          if (!list.some(r => r.referenceId === member.id)) {
            list.push({ type: ResponderType.PROVIDER_STAFF, referenceId: member.id });
          }
        }
      } catch {
        // Fallback
      }
    }

    // If no specific unit/staff found, register provider itself as mobile unit responder
    if (list.length === 0) {
      list.push({ type: ResponderType.PROVIDER, referenceId: providerId });
    }

    return list;
  }
}

export const matchingEngine = new MatchingEngine();
