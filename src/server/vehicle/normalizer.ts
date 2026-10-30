/**
 * Canonical Vehicle Normalizer & Distance Math (GAR-004 §5-§7, GAR-000 §13)
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { OdometerUnit } from './types';

const KM_PER_MILE = 1.609344;

/**
 * Normalizes VIN strings: uppercase, trims whitespace and hyphens.
 */
export function normalizeVin(vin: string): string {
  if (!vin) return '';
  return vin.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Validates VIN according to ISO 3779 (17 alphanumeric chars, excluding I, O, Q).
 * Returns true if valid ISO 3779.
 */
export function isValidStandardVin(normalizedVin: string): boolean {
  if (normalizedVin.length !== 17) {
    return false;
  }
  // Disallow I, O, Q in standard 17-char VIN
  const standardVinRegex = /^[A-HJ-NPR-Z0-9]{17}$/;
  return standardVinRegex.test(normalizedVin);
}

/**
 * Checks if a string is a recognized chassis or non-standard vehicle identifier
 * (e.g. Japanese domestic market chassis numbers: JZX100-0012345, TRH200-1234567).
 */
export function isValidChassisNumber(identifier: string): boolean {
  const cleaned = identifier.replace(/\s/g, '').toUpperCase();
  // Typically 6 to 20 alphanumeric characters, may contain a hyphen
  return /^[A-Z0-9]{2,10}-?[A-Z0-9]{4,12}$/.test(cleaned);
}

/**
 * Normalizes registration number.
 * Kenya pattern example: 'KDA 789X', 'KBZ 123A', 'KCA 001B'.
 * International pattern: trimmed, uppercase, collapsed spaces.
 */
export function normalizeRegistrationNumber(reg: string, country = 'KE'): string {
  if (!reg) return '';
  const trimmed = reg.trim().toUpperCase().replace(/\s+/g, ' ');

  if (country === 'KE') {
    // If entered without space like 'KDA789X' or 'KAA123A', format to 'KDA 789X'
    const match = trimmed.replace(/\s/g, '').match(/^([A-Z]{3})(\d{3}[A-Z])$/);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
  }

  return trimmed;
}

/**
 * Validates registration number format.
 */
export function isValidRegistrationNumber(reg: string): boolean {
  if (!reg || reg.trim().length < 2 || reg.trim().length > 20) {
    return false;
  }
  return true;
}

/**
 * Normalizes any distance to canonical Kilometers (KM).
 */
export function normalizeDistanceToKm(value: number, unit: OdometerUnit): number {
  if (typeof value !== 'number' || isNaN(value) || value < 0) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Odometer reading must be a non-negative number', 400);
  }
  if (unit === OdometerUnit.MILES) {
    return Math.round(value * KM_PER_MILE * 10) / 10;
  }
  return Math.round(value * 10) / 10;
}

/**
 * Converts canonical kilometers to target unit.
 */
export function convertDistanceFromKm(km: number, toUnit: OdometerUnit): number {
  if (toUnit === OdometerUnit.MILES) {
    return Math.round((km / KM_PER_MILE) * 10) / 10;
  }
  return Math.round(km * 10) / 10;
}

/**
 * Validates model year against sensible automotive manufacturing boundaries.
 */
export function validateModelYear(year: number): void {
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear + 2; // Allow next-generation model year early releases
  const minYear = 1900;

  if (!Number.isInteger(year) || year < minYear || year > maxYear) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      `Model year must be an integer between ${minYear} and ${maxYear}. Received: ${year}`,
      400
    );
  }
}

/**
 * Formats canonical vehicle display name.
 */
export function formatVehicleDisplayName(
  make: string,
  model: string,
  modelYear: number,
  trim?: string | null
): string {
  const base = `${modelYear} ${make} ${model}`.trim();
  if (trim && trim.trim()) {
    return `${base} ${trim.trim()}`;
  }
  return base;
}
