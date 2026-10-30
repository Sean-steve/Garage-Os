/**
 * Canonical Distance Domain & Normalization Strategy (GAR-000 §6, GAR-004 §12, GAR-006 §10)
 *
 * Rules:
 * 1. Standard internal distance unit is KM.
 * 2. Miles are converted deterministically using the international standard: 1 mile = 1.609344 km.
 * 3. Odometer comparisons must always compare normalized values.
 */

import { OdometerUnit } from '../vehicle/types';

export const KM_PER_MILE = 1.609344;
export const MILES_PER_KM = 1 / KM_PER_MILE;

/**
 * Normalizes any distance to kilometers deterministically
 */
export function normalizeDistanceToKm(value: number, unit: OdometerUnit | 'KM' | 'MILES' = OdometerUnit.KM): number {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  const isMiles = String(unit).toUpperCase() === 'MILES';
  if (isMiles) {
    return Math.round(value * KM_PER_MILE * 100) / 100;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Converts a distance from one unit to another
 */
export function convertDistance(
  value: number,
  fromUnit: OdometerUnit | 'KM' | 'MILES',
  toUnit: OdometerUnit | 'KM' | 'MILES'
): number {
  if (fromUnit === toUnit) return value;
  if (fromUnit === 'MILES' && toUnit === 'KM') {
    return Math.round(value * KM_PER_MILE * 100) / 100;
  }
  if (fromUnit === 'KM' && toUnit === 'MILES') {
    return Math.round(value * MILES_PER_KM * 100) / 100;
  }
  return value;
}

/**
 * Formats distance with unit for display
 */
export function formatDistance(valueKm: number, preferredUnit: 'KM' | 'MILES' = 'KM'): string {
  if (preferredUnit === 'MILES') {
    const miles = Math.round(valueKm * MILES_PER_KM);
    return `${miles.toLocaleString()} mi`;
  }
  return `${Math.round(valueKm).toLocaleString()} km`;
}
