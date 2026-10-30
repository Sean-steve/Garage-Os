/**
 * Canonical Health Probes & Readiness Architecture (GAR-002 §8, GAR-045 §1-§8)
 *
 * Rules:
 * 1. /health/live: Determines whether process is alive. Independent of external providers.
 * 2. /health/ready: Determines whether system can safely receive traffic. Checks critical dependencies.
 * 3. Degraded dependency must not mark core application dead.
 */

import { config } from '../config/env';
import { getCurrentUtcIsoString } from '../domain/time';

export type ComponentHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface ComponentHealth {
  status: ComponentHealthStatus;
  latency_ms?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SystemHealthReport {
  status: ComponentHealthStatus;
  platform: string;
  version: string;
  environment: string;
  timestamp: string;
  checks: Record<string, ComponentHealth>;
}

export type HealthCheckFn = () => Promise<ComponentHealth> | ComponentHealth;

class HealthRegistry {
  private checks: Map<string, HealthCheckFn> = new Map();

  registerCheck(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
  }

  getLiveness(): { status: 'UP'; timestamp: string } {
    return {
      status: 'UP',
      timestamp: getCurrentUtcIsoString(),
    };
  }

  async getReadiness(): Promise<SystemHealthReport> {
    const results: Record<string, ComponentHealth> = {};
    let overallStatus: ComponentHealthStatus = 'HEALTHY';

    for (const [name, checkFn] of this.checks.entries()) {
      const start = Date.now();
      try {
        const res = await checkFn();
        results[name] = {
          ...res,
          latency_ms: res.latency_ms ?? (Date.now() - start),
        };

        if (res.status === 'DOWN') {
          overallStatus = 'DOWN';
        } else if (res.status === 'DEGRADED' && overallStatus !== 'DOWN') {
          overallStatus = 'DEGRADED';
        }
      } catch (err) {
        results[name] = {
          status: 'DOWN',
          latency_ms: Date.now() - start,
          message: err instanceof Error ? err.message : 'Check failed',
        };
        overallStatus = 'DOWN';
      }
    }

    return {
      status: overallStatus,
      platform: config.APP_NAME,
      version: '1.0.0-sprint1',
      environment: config.APP_ENV,
      timestamp: getCurrentUtcIsoString(),
      checks: results,
    };
  }
}

export const healthRegistry = new HealthRegistry();
