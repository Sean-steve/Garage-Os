/**
 * Feature Flags Management & Controlled Rollout Engine (GAR-046 §4.x & §7, Sprint 1 §28)
 *
 * Rules:
 * 1. Feature flags support staged exposure by percentage or user role.
 * 2. Feature flags do not substitute for authorization.
 * 3. Flag states are persistent and auditable.
 */

import { getDatabase } from '../database/connection';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export interface FeatureFlagRecord {
  key: string;
  enabled: boolean;
  description: string;
  percentage: number; // 0 to 100
  roles: string[];
  created_at: string;
  updated_at: string;
}

export const CANONICAL_FEATURE_FLAGS: Array<Omit<FeatureFlagRecord, 'created_at' | 'updated_at'>> = [
  {
    key: 'marketplace_v3',
    enabled: true,
    description: 'Automotive parts & tyres marketplace (GAR-021)',
    percentage: 100,
    roles: ['VEHICLE_OWNER', 'SELLER', 'PLATFORM_OPERATOR'],
  },
  {
    key: 'obd_telemetry_v2',
    enabled: true,
    description: 'Connected OBD-II telemetry ingestion & DTC decoding (GAR-026, GAR-027)',
    percentage: 100,
    roles: ['VEHICLE_OWNER', 'GARAGE_STAFF', 'PLATFORM_OPERATOR'],
  },
  {
    key: 'ai_vehicle_assistant',
    enabled: true,
    description: 'AI Vehicle assistant with guarded tools (GAR-028)',
    percentage: 100,
    roles: ['VEHICLE_OWNER', 'PLATFORM_OPERATOR'],
  },
  {
    key: 'trip_guardian_safety',
    enabled: true,
    description: 'Journey safety & trip check-in monitoring (GAR-019)',
    percentage: 100,
    roles: ['VEHICLE_OWNER', 'TRUSTED_CONTACT', 'PLATFORM_OPERATOR'],
  },
  {
    key: 'fleet_management',
    enabled: true,
    description: 'Organizational fleet management & reporting (GAR-030)',
    percentage: 100,
    roles: ['HOUSEHOLD_FLEET_MANAGER', 'PLATFORM_OPERATOR'],
  },
];

class FeatureFlagManager {
  private cache = new Map<string, FeatureFlagRecord>();

  init(): void {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    // Ensure default flags are present
    for (const flag of CANONICAL_FEATURE_FLAGS) {
      db.prepare(`
        INSERT INTO feature_flags (key, enabled, description, percentage, roles, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO NOTHING;
      `).run(
        flag.key,
        flag.enabled ? 1 : 0,
        flag.description,
        flag.percentage,
        JSON.stringify(flag.roles),
        now,
        now
      );
    }

    this.reloadCache();
  }

  reloadCache(): void {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM feature_flags;').all() as Array<{
      key: string;
      enabled: number;
      description: string;
      percentage: number;
      roles: string;
      created_at: string;
      updated_at: string;
    }>;

    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.key, {
        key: row.key,
        enabled: row.enabled === 1,
        description: row.description,
        percentage: row.percentage,
        roles: JSON.parse(row.roles || '[]'),
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  }

  isEnabled(key: string, userContext?: { id?: string; role?: string }): boolean {
    const flag = this.cache.get(key);
    if (!flag) return false;
    if (!flag.enabled) return false;

    // If roles configured and userContext provides role
    if (flag.roles.length > 0 && userContext?.role) {
      if (!flag.roles.includes(userContext.role)) {
        return false;
      }
    }

    // Percentage rollout evaluation using deterministic user ID hash
    if (flag.percentage < 100 && userContext?.id) {
      let hash = 0;
      for (let i = 0; i < userContext.id.length; i++) {
        hash = (hash * 31 + userContext.id.charCodeAt(i)) % 100;
      }
      return hash < flag.percentage;
    }

    return true;
  }

  getAllFlags(): FeatureFlagRecord[] {
    return Array.from(this.cache.values());
  }

  updateFlag(key: string, enabled: boolean, percentage?: number): boolean {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();
    const pct = percentage !== undefined ? percentage : 100;

    const res = db.prepare(`
      UPDATE feature_flags
      SET enabled = ?, percentage = ?, updated_at = ?
      WHERE key = ?;
    `).run(enabled ? 1 : 0, pct, now, key);

    if (res.changes > 0) {
      this.reloadCache();
      logger.info(`Updated feature flag [${key}] to enabled=${enabled}, pct=${pct}`);
      return true;
    }
    return false;
  }
}

export const featureFlagManager = new FeatureFlagManager();
