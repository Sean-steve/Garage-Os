/**
 * Garage OS — Sprint 14: Routing & ETA Provider Abstraction (GAR-016)
 * Provides road routing and geodesic distance fallback with circuit breaker & caching.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  DistanceType,
  EtaSource,
  DispatchRouteEstimateEntity,
  DispatchEtaEstimateEntity,
} from './types';

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number | null;
  distanceType: DistanceType;
  source: EtaSource;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  trafficIncluded: boolean;
}

export interface RouteProvider {
  name: string;
  calculateRoute(origin: GeoCoordinate, destination: GeoCoordinate): Promise<RouteResult>;
}

/**
 * Calculates geodesic distance between two points using the Haversine formula (meters).
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Quantizes coordinate to ~11m precision for cache keys
 */
function quantizeCoord(coord: number): number {
  return Math.round(coord * 10000) / 10000;
}

/**
 * In-memory circuit breaker and cache for route estimates
 */
export class RoutingService {
  private memoryCache = new Map<string, { result: RouteResult; expiresAt: number }>();
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 3;
  private readonly resetTimeoutMs = 30000; // 30s reset
  private activeProvider: RouteProvider | null = null;

  constructor(provider?: RouteProvider) {
    if (provider) {
      this.activeProvider = provider;
    }
  }

  setProvider(provider: RouteProvider | null) {
    this.activeProvider = provider;
  }

  /**
   * Evaluates route between two coordinates with caching and safe geodesic fallback.
   */
  async computeRoute(
    origin: GeoCoordinate,
    destination: GeoCoordinate,
    options?: { forceGeodesic?: boolean; db?: DatabaseSync }
  ): Promise<RouteResult> {
    const geodesicMeters = calculateHaversineDistanceMeters(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude
    );

    // If geodesic is explicitly forced or coordinates are identical
    if (options?.forceGeodesic || geodesicMeters < 10) {
      return {
        distanceMeters: geodesicMeters,
        durationSeconds: geodesicMeters < 10 ? 0 : null,
        distanceType: DistanceType.GEODESIC_DISTANCE,
        source: geodesicMeters < 10 ? EtaSource.SYSTEM_ESTIMATE : EtaSource.UNAVAILABLE,
        confidence: geodesicMeters < 10 ? 'HIGH' : 'LOW',
        trafficIncluded: false,
      };
    }

    const cacheKey = `${quantizeCoord(origin.latitude)},${quantizeCoord(origin.longitude)}->${quantizeCoord(destination.latitude)},${quantizeCoord(destination.longitude)}`;
    const now = Date.now();

    // Check in-memory cache
    const cached = this.memoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    // Check circuit breaker status
    const isCircuitOpen =
      this.failureCount >= this.failureThreshold &&
      now - this.lastFailureTime < this.resetTimeoutMs;

    if (!this.activeProvider || isCircuitOpen) {
      // Circuit open or no external provider configured:
      // Safe fallback to geodesic distance, explicitly reporting distance type and unavailable ETA.
      const fallbackResult: RouteResult = {
        distanceMeters: geodesicMeters,
        durationSeconds: null,
        distanceType: DistanceType.GEODESIC_DISTANCE,
        source: EtaSource.UNAVAILABLE,
        confidence: 'NONE',
        trafficIncluded: false,
      };
      return fallbackResult;
    }

    try {
      const result = await this.activeProvider.calculateRoute(origin, destination);
      // Reset failure counter on success
      this.failureCount = 0;

      // Cache result for 5 minutes
      this.memoryCache.set(cacheKey, {
        result,
        expiresAt: now + 5 * 60 * 1000,
      });

      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = now;

      // Fallback safely to geodesic distance with UNAVAILABLE ETA
      return {
        distanceMeters: geodesicMeters,
        durationSeconds: null,
        distanceType: DistanceType.GEODESIC_DISTANCE,
        source: EtaSource.UNAVAILABLE,
        confidence: 'NONE',
        trafficIncluded: false,
      };
    }
  }

  /**
   * Generates a persistable ETA record for a candidate
   */
  async generateEtaRecord(
    dispatchRequestId: string,
    responderReferenceId: string,
    origin: GeoCoordinate,
    destination: GeoCoordinate,
    db?: DatabaseSync
  ): Promise<DispatchEtaEstimateEntity> {
    const route = await this.computeRoute(origin, destination, { db });
    const now = new Date();
    const calculatedAt = now.toISOString();

    let estimatedArrivalAt: string | null = null;
    if (route.durationSeconds !== null && route.durationSeconds >= 0) {
      estimatedArrivalAt = new Date(now.getTime() + route.durationSeconds * 1000).toISOString();
    }

    // Record expires in 3 minutes
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString();

    return {
      id: generateCanonicalId('dee'),
      dispatch_request_id: dispatchRequestId,
      responder_reference_id: responderReferenceId,
      estimated_arrival_at: estimatedArrivalAt,
      duration_seconds: route.durationSeconds,
      source: route.source,
      calculated_at: calculatedAt,
      route_distance_meters: route.distanceMeters,
      confidence: route.confidence,
      traffic_included: route.trafficIncluded ? 1 : 0,
      expires_at: expiresAt,
      created_at: calculatedAt,
    };
  }
}

/**
 * Standard simulated road network provider for local/offline environments.
 * Uses road winding factor (1.25x - 1.35x) and urban speed estimates (35-45 km/h in urban East Africa).
 */
export class StandardRoadNetworkProvider implements RouteProvider {
  name = 'StandardRoadNetworkEngine';

  async calculateRoute(origin: GeoCoordinate, destination: GeoCoordinate): Promise<RouteResult> {
    const geodesicMeters = calculateHaversineDistanceMeters(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude
    );

    // Realistic road network factor
    const roadDistanceMeters = Math.round(geodesicMeters * 1.28);
    // Average urban responder transit speed: ~36 km/h = 10 m/s
    const durationSeconds = Math.max(60, Math.round(roadDistanceMeters / 10));

    return {
      distanceMeters: roadDistanceMeters,
      durationSeconds,
      distanceType: DistanceType.ROAD_DISTANCE,
      source: EtaSource.STATIC_ROUTING,
      confidence: 'MEDIUM',
      trafficIncluded: false,
    };
  }
}

export const routingService = new RoutingService(new StandardRoadNetworkProvider());
