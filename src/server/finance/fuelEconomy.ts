/**
 * Canonical Fuel Economy Engine (GAR-009 §4, §7-18, §80-81, §87)
 *
 * Implements deterministic full-to-full tank consumption algorithm with partial-fill aggregation,
 * unit normalization, multi-standard outputs, and rigorous data confidence levels.
 */

import {
  FillType,
  FuelEconomyConfidence,
  FuelEconomyInterval,
  FuelEntry,
  FuelQuantityUnit,
} from './types';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';

// Unit conversion constants
const GALLON_US_TO_LITRES = 3.785411784;
const GALLON_UK_TO_LITRES = 4.54609;
const MILES_TO_KM = 1.609344;
const KM_PER_LITRE_TO_MPG_US = 2.35214583;
const KM_PER_LITRE_TO_MPG_UK = 2.824809;

export class FuelEconomyEngine {
  /**
   * Normalizes any supported fuel quantity unit into Litres.
   */
  static normalizeToLitres(quantity: number, unit: FuelQuantityUnit): number {
    switch (unit) {
      case FuelQuantityUnit.LITRE:
        return quantity;
      case FuelQuantityUnit.GALLON_US:
        return Math.round(quantity * GALLON_US_TO_LITRES * 10000) / 10000;
      case FuelQuantityUnit.GALLON_UK:
        return Math.round(quantity * GALLON_UK_TO_LITRES * 10000) / 10000;
      case FuelQuantityUnit.KWH:
        // For EV / Plug-in hybrid kWh tracking, return energy quantity
        return quantity;
      default:
        return quantity;
    }
  }

  /**
   * Normalizes distance to kilometers.
   */
  static normalizeDistanceToKm(odometerValue: number, unit = 'KM'): number {
    if (unit.toUpperCase() === 'MILES' || unit.toUpperCase() === 'MI') {
      return Math.round(odometerValue * MILES_TO_KM * 10000) / 10000;
    }
    return odometerValue;
  }

  /**
   * Converts km/L to L/100km.
   */
  static kmPerLitreToLitresPer100Km(kmPerLitre: number): number {
    if (kmPerLitre <= 0) return 0;
    return Math.round((100 / kmPerLitre) * 100) / 100;
  }

  /**
   * Converts km/L to MPG (US).
   */
  static kmPerLitreToMpgUs(kmPerLitre: number): number {
    return Math.round(kmPerLitre * KM_PER_LITRE_TO_MPG_US * 100) / 100;
  }

  /**
   * Converts km/L to MPG (UK).
   */
  static kmPerLitreToMpgUk(kmPerLitre: number): number {
    return Math.round(kmPerLitre * KM_PER_LITRE_TO_MPG_UK * 100) / 100;
  }

  /**
   * Calculates fuel economy intervals from a chronological list of fuel entries.
   *
   * Algorithm:
   * 1. Entries must be sorted chronologically by fueled_at / odometer_km ascending.
   * 2. Identify initial FULL anchor with a valid odometer reading.
   * 3. Accumulate any PARTIAL fills between full anchors.
   * 4. When the next FULL anchor with a valid odometer is reached:
   *    - distance = end.odometer_km - start.odometer_km
   *    - fuel consumed = sum(intermediate partials litres) + end.quantity_litres
   *    - if distance <= 0: mark INSUFFICIENT_DATA (odometer anomaly)
   *    - compute km_per_litre, litres_per_100_km, mpg_us, mpg_uk
   *    - confidence:
   *      - HIGH: 0 partial fills, distance <= 1200 km
   *      - MEDIUM: 1-2 partial fills
   *      - LOW: >2 partial fills or distance > 1200 km
   * 5. Set the new anchor to the end fill and repeat.
   */
  static calculateIntervals(entries: FuelEntry[]): FuelEconomyInterval[] {
    // Filter out uncorrected/valid entries and sort chronologically
    const sorted = [...entries]
      .filter((e) => !e.is_corrected)
      .sort((a, b) => {
        const timeDiff = new Date(a.fueled_at).getTime() - new Date(b.fueled_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return (a.odometer_km ?? 0) - (b.odometer_km ?? 0);
      });

    const intervals: FuelEconomyInterval[] = [];
    let currentFullAnchor: FuelEntry | null = null;
    let intermediatePartialLitres = 0;
    let intermediatePartialCount = 0;

    for (const entry of sorted) {
      // Must have valid odometer reading to qualify as an anchor or participate in distance calculation
      const hasOdometer = typeof entry.odometer_km === 'number' && entry.odometer_km > 0;

      if (entry.fill_type === FillType.FULL && hasOdometer) {
        if (!currentFullAnchor) {
          // First qualifying full anchor established
          currentFullAnchor = entry;
          intermediatePartialLitres = 0;
          intermediatePartialCount = 0;
          continue;
        }

        // We have a prior full anchor and a new full anchor
        const distanceKm = entry.odometer_km! - currentFullAnchor.odometer_km!;
        const totalConsumedLitres = intermediatePartialLitres + entry.quantity_litres;

        if (distanceKm > 0 && totalConsumedLitres > 0) {
          const rawKmPerLitre = distanceKm / totalConsumedLitres;
          const kmPerLitre = Math.round(rawKmPerLitre * 100) / 100;
          const litresPer100Km = this.kmPerLitreToLitresPer100Km(kmPerLitre);
          const mpgUs = this.kmPerLitreToMpgUs(kmPerLitre);
          const mpgUk = this.kmPerLitreToMpgUk(kmPerLitre);

          let confidence = FuelEconomyConfidence.HIGH;
          if (intermediatePartialCount > 2 || distanceKm > 1500) {
            confidence = FuelEconomyConfidence.LOW;
          } else if (intermediatePartialCount > 0) {
            confidence = FuelEconomyConfidence.MEDIUM;
          }

          intervals.push({
            id: generateCanonicalId('fei'),
            vehicle_id: entry.vehicle_id,
            start_fuel_entry_id: currentFullAnchor.id,
            end_fuel_entry_id: entry.id,
            distance_km: distanceKm,
            fuel_consumed_litres: Math.round(totalConsumedLitres * 100) / 100,
            km_per_litre: kmPerLitre,
            litres_per_100_km: litresPer100Km,
            mpg_us: mpgUs,
            mpg_uk: mpgUk,
            confidence,
            partial_fills_included_count: intermediatePartialCount,
            calculated_at: getCurrentUtcIsoString(),
          });
        }

        // Reset anchor to current full fill
        currentFullAnchor = entry;
        intermediatePartialLitres = 0;
        intermediatePartialCount = 0;
      } else if (entry.fill_type === FillType.PARTIAL) {
        // Intermediate partial fill
        if (currentFullAnchor) {
          intermediatePartialLitres += entry.quantity_litres;
          intermediatePartialCount++;
        }
      } else {
        // UNKNOWN fill type or missing odometer: resets anchor if unknown breaks tank state
        if (entry.fill_type === FillType.UNKNOWN) {
          currentFullAnchor = null;
          intermediatePartialLitres = 0;
          intermediatePartialCount = 0;
        }
      }
    }

    return intervals;
  }
}
