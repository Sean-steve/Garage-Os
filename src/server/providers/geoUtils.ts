/**
 * Geospatial Utilities for Automotive Service Providers (GAR-011 §13, §16)
 *
 * Provides:
 * - Haversine great-circle distance computation (km)
 * - Geofence containment: radial distance & polygon point-in-polygon (ray casting)
 * - Coordinate validation (-90..90 lat, -180..180 lon)
 */

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface PolygonPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Validates latitude and longitude values
 */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
    return false;
  }
  if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
    return false;
  }
  return true;
}

/**
 * Computes Haversine great-circle distance between two geographic coordinates in kilometers
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    return Infinity;
  }

  const toRad = (degree: number) => (degree * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(radLat1) * Math.cos(radLat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

/**
 * Tests whether a point (lat, lng) lies inside a polygon using ray-casting algorithm
 */
export function isPointInPolygon(point: PolygonPoint, polygon: PolygonPoint[]): boolean {
  if (!polygon || polygon.length < 3) {
    return false;
  }

  const { lat: x, lng: y } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Evaluates whether coordinates fall within a given provider service area
 */
export function isPointInServiceArea(
  point: GeoCoordinates,
  area: {
    area_type: string;
    center_lat?: number | null;
    center_lng?: number | null;
    radius_km?: number | null;
    polygon_json?: string | null;
  }
): boolean {
  if (!isValidCoordinate(point.latitude, point.longitude)) {
    return false;
  }

  if (area.area_type === 'RADIUS') {
    if (
      area.center_lat == null ||
      area.center_lng == null ||
      area.radius_km == null ||
      area.radius_km <= 0
    ) {
      return false;
    }
    const distance = haversineDistanceKm(
      point.latitude,
      point.longitude,
      area.center_lat,
      area.center_lng
    );
    return distance <= area.radius_km;
  }

  if (area.area_type === 'POLYGON' && area.polygon_json) {
    try {
      const coords: PolygonPoint[] = JSON.parse(area.polygon_json);
      return isPointInPolygon({ lat: point.latitude, lng: point.longitude }, coords);
    } catch {
      return false;
    }
  }

  return false;
}
