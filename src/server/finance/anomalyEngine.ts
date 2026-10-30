/**
 * Canonical Fuel Efficiency Baseline & Anomaly Engine (GAR-009 §40-44, §90, §114)
 *
 * Evaluates vehicle-specific historical consumption without diagnosing mechanical faults.
 * Adheres strictly to minimum qualifying criteria (>=3 intervals, >=300 km).
 */

import { FuelEconomyInterval, FuelEfficiencySnapshot } from './types';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';

export class FuelAnomalyEngine {
  /**
   * Minimum qualifying data thresholds
   */
  private static readonly MIN_INTERVALS = 3;
  private static readonly MIN_TOTAL_DISTANCE_KM = 300;
  private static readonly ANOMALY_THRESHOLD_PERCENT = 15.0; // 15% drop in economy

  /**
   * Evaluates intervals for a vehicle and determines whether consumption has materially changed.
   */
  static evaluateEfficiency(
    vehicleId: string,
    intervals: FuelEconomyInterval[]
  ): FuelEfficiencySnapshot {
    const totalDistance = intervals.reduce((acc, i) => acc + i.distance_km, 0);

    // If insufficient data, return safe non-anomalous snapshot
    if (
      intervals.length < this.MIN_INTERVALS ||
      totalDistance < this.MIN_TOTAL_DISTANCE_KM
    ) {
      const avgEconomy =
        intervals.length > 0
          ? intervals.reduce((acc, i) => acc + i.km_per_litre, 0) / intervals.length
          : 0;

      return {
        id: generateCanonicalId('fes'),
        vehicle_id: vehicleId,
        rolling_economy_km_l: Math.round(avgEconomy * 100) / 100,
        baseline_economy_km_l: Math.round(avgEconomy * 100) / 100,
        delta_percent: 0,
        anomaly_detected: false,
        observation_text: null,
        data_quality: 'INSUFFICIENT_DATA',
        qualifying_intervals_count: intervals.length,
        total_distance_km: Math.round(totalDistance * 100) / 100,
        observed_at: getCurrentUtcIsoString(),
        created_at: getCurrentUtcIsoString(),
      };
    }

    // Sort intervals chronologically
    const sorted = [...intervals].sort(
      (a, b) => new Date(a.calculated_at).getTime() - new Date(b.calculated_at).getTime()
    );

    // Baseline: Median economy of earlier intervals (historical baseline)
    const baselineSlice = sorted.length >= 5 ? sorted.slice(0, sorted.length - 2) : sorted;
    const sortedRates = [...baselineSlice].map((i) => i.km_per_litre).sort((a, b) => a - b);
    const mid = Math.floor(sortedRates.length / 2);
    const baselineMedian =
      sortedRates.length % 2 !== 0
        ? sortedRates[mid]
        : (sortedRates[mid - 1] + sortedRates[mid]) / 2;

    // Rolling recent economy: Last 2 intervals (or recent period)
    const recentSlice = sorted.slice(-2);
    const recentSumDistance = recentSlice.reduce((acc, i) => acc + i.distance_km, 0);
    const recentSumFuel = recentSlice.reduce((acc, i) => acc + i.fuel_consumed_litres, 0);
    const rollingEconomy =
      recentSumFuel > 0
        ? Math.round((recentSumDistance / recentSumFuel) * 100) / 100
        : baselineMedian;

    // Delta percentage: ((rolling - baseline) / baseline) * 100
    // Negative delta indicates worsening fuel economy (fewer km per litre)
    let deltaPercent = 0;
    if (baselineMedian > 0) {
      deltaPercent = Math.round(((rollingEconomy - baselineMedian) / baselineMedian) * 10000) / 100;
    }

    // Anomaly condition: economy dropped by >= 15% (i.e. deltaPercent <= -15)
    const anomalyDetected = deltaPercent <= -this.ANOMALY_THRESHOLD_PERCENT;

    // CRITICAL: Observation text is factual, NEVER a mechanical diagnosis!
    let observationText: string | null = null;
    if (anomalyDetected) {
      observationText =
        'Fuel consumption has increased compared with this vehicle’s recent history.';
    }

    return {
      id: generateCanonicalId('fes'),
      vehicle_id: vehicleId,
      rolling_economy_km_l: rollingEconomy,
      baseline_economy_km_l: Math.round(baselineMedian * 100) / 100,
      delta_percent: deltaPercent,
      anomaly_detected: anomalyDetected,
      observation_text: observationText,
      data_quality: 'HIGH',
      qualifying_intervals_count: intervals.length,
      total_distance_km: Math.round(totalDistance * 100) / 100,
      observed_at: getCurrentUtcIsoString(),
      created_at: getCurrentUtcIsoString(),
    };
  }
}
