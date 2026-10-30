/**
 * Metrics & Observability Collector (GAR-045 §12, GAR-000 §8)
 *
 * Implements:
 * - Request counts, error rates, latency histograms with p95/p99 calculation
 * - Queue depth tracking (outbox, background jobs, dead letters)
 * - Domain state counters
 */

export interface MetricSnapshot {
  timestamp: string;
  uptime_seconds: number;
  http: {
    total_requests: number;
    status_codes: Record<string, number>;
    error_rate_percentage: number;
    latency: {
      avg_ms: number;
      min_ms: number;
      max_ms: number;
      p95_ms: number;
      p99_ms: number;
    };
  };
  queues: {
    outbox_pending: number;
    jobs_queued: number;
    jobs_running: number;
    jobs_failed: number;
    dead_letters: number;
  };
  safety: {
    sos_activations_total: number;
    sos_unconfirmed_client_total: number;
    roadside_dispatches_total: number;
  };
  finance: {
    fuel_entries_recorded_total: number;
    fuel_economy_calculated_total: number;
    fuel_efficiency_anomalies_observed_total: number;
    vehicle_expenses_recorded_total: number;
    vehicle_expenses_by_category_total: Record<string, number>;
    recurring_expenses_processed_total: number;
    tco_summaries_generated_total: number;
  };
}

class MetricsCollector {
  private startTime = Date.now();
  private totalRequests = 0;
  private statusCodes: Record<string, number> = {};
  private latencies: number[] = [];
  private maxLatenciesRecorded = 2000;

  // Domain counters
  private sosActivationsTotal = 0;
  private sosUnconfirmedTotal = 0;
  private roadsideDispatchesTotal = 0;

  // Finance & Fuel domain counters (GAR-009 §85)
  private fuelEntriesRecordedTotal = 0;
  private fuelEconomyCalculatedTotal = 0;
  private fuelEfficiencyAnomaliesObservedTotal = 0;
  private vehicleExpensesRecordedTotal = 0;
  private vehicleExpensesByCategoryTotal: Record<string, number> = {};
  private recurringExpensesProcessedTotal = 0;
  private tcoSummariesGeneratedTotal = 0;

  // External supplier functions for queue stats
  private queueStatsProvider: () => {
    outboxPending: number;
    jobsQueued: number;
    jobsRunning: number;
    jobsFailed: number;
    deadLetters: number;
  } = () => ({
    outboxPending: 0,
    jobsQueued: 0,
    jobsRunning: 0,
    jobsFailed: 0,
    deadLetters: 0,
  });

  registerQueueStatsProvider(provider: typeof this.queueStatsProvider): void {
    this.queueStatsProvider = provider;
  }

  recordHttpRequest(statusCode: number, durationMs: number): void {
    this.totalRequests++;
    const codeKey = `${Math.floor(statusCode / 100)}xx`;
    this.statusCodes[codeKey] = (this.statusCodes[codeKey] || 0) + 1;
    this.statusCodes[String(statusCode)] = (this.statusCodes[String(statusCode)] || 0) + 1;

    this.latencies.push(durationMs);
    if (this.latencies.length > this.maxLatenciesRecorded) {
      this.latencies.shift();
    }
  }

  recordSosActivation(): void {
    this.sosActivationsTotal++;
  }

  recordSosUnconfirmed(): void {
    this.sosUnconfirmedTotal++;
  }

  recordRoadsideDispatch(): void {
    this.roadsideDispatchesTotal++;
  }

  recordFuelEntry(): void {
    this.fuelEntriesRecordedTotal++;
  }

  recordFuelEconomyCalculation(): void {
    this.fuelEconomyCalculatedTotal++;
  }

  recordFuelEfficiencyAnomaly(): void {
    this.fuelEfficiencyAnomaliesObservedTotal++;
  }

  recordVehicleExpense(category: string): void {
    this.vehicleExpensesRecordedTotal++;
    this.vehicleExpensesByCategoryTotal[category] =
      (this.vehicleExpensesByCategoryTotal[category] || 0) + 1;
  }

  recordRecurringExpenseProcessed(): void {
    this.recurringExpensesProcessedTotal++;
  }

  recordTcoSummaryGenerated(): void {
    this.tcoSummariesGeneratedTotal++;
  }

  getPercentile(p: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return Math.round(sorted[Math.max(0, index)] * 100) / 100;
  }

  getSnapshot(): MetricSnapshot {
    const queueStats = this.queueStatsProvider();
    const errorCount = (this.statusCodes['4xx'] || 0) + (this.statusCodes['5xx'] || 0);
    const errorRate = this.totalRequests > 0 ? (errorCount / this.totalRequests) * 100 : 0;

    const sum = this.latencies.reduce((acc, val) => acc + val, 0);
    const avg = this.latencies.length > 0 ? sum / this.latencies.length : 0;
    const min = this.latencies.length > 0 ? Math.min(...this.latencies) : 0;
    const max = this.latencies.length > 0 ? Math.max(...this.latencies) : 0;

    return {
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      http: {
        total_requests: this.totalRequests,
        status_codes: this.statusCodes,
        error_rate_percentage: Math.round(errorRate * 100) / 100,
        latency: {
          avg_ms: Math.round(avg * 100) / 100,
          min_ms: Math.round(min * 100) / 100,
          max_ms: Math.round(max * 100) / 100,
          p95_ms: this.getPercentile(95),
          p99_ms: this.getPercentile(99),
        },
      },
      queues: {
        outbox_pending: queueStats.outboxPending,
        jobs_queued: queueStats.jobsQueued,
        jobs_running: queueStats.jobsRunning,
        jobs_failed: queueStats.jobsFailed,
        dead_letters: queueStats.deadLetters,
      },
      safety: {
        sos_activations_total: this.sosActivationsTotal,
        sos_unconfirmed_client_total: this.sosUnconfirmedTotal,
        roadside_dispatches_total: this.roadsideDispatchesTotal,
      },
      finance: {
        fuel_entries_recorded_total: this.fuelEntriesRecordedTotal,
        fuel_economy_calculated_total: this.fuelEconomyCalculatedTotal,
        fuel_efficiency_anomalies_observed_total: this.fuelEfficiencyAnomaliesObservedTotal,
        vehicle_expenses_recorded_total: this.vehicleExpensesRecordedTotal,
        vehicle_expenses_by_category_total: { ...this.vehicleExpensesByCategoryTotal },
        recurring_expenses_processed_total: this.recurringExpensesProcessedTotal,
        tco_summaries_generated_total: this.tcoSummariesGeneratedTotal,
      },
    };
  }
}

export const metrics = new MetricsCollector();
