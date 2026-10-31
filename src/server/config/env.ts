/**
 * Centralized Typed Configuration System (GAR-046 §1-§8, Sprint 1 §10)
 *
 * Rules:
 * 1. Configuration must be validated during startup.
 * 2. Required variables must fail fast.
 * 3. Secrets must never be logged or exposed to the client.
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env if present
dotenv.config();

const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('Garage OS'),
  APP_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:3000/api/v1'),
  PORT: z.coerce.number().default(3000),

  // Database (GAR-033)
  DATABASE_URL: z.string().default('file:./data/garage_os.db'),
  DATABASE_POOL_MIN: z.coerce.number().default(1),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Observability & Logging (GAR-045)
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_STRUCTURED_LOGS: z.string().default('true').transform((v) => v === 'true'),
  ENABLE_METRICS: z.string().default('true').transform((v) => v === 'true'),

  // Storage (GAR-038)
  OBJECT_STORAGE_PROVIDER: z.enum(['local', 'memory', 'gcs', 's3']).default('local'),
  OBJECT_STORAGE_BUCKET: z.string().default('garage-os-media'),
  OBJECT_STORAGE_LOCAL_PATH: z.string().default('./data/storage'),

  // Security & CORS (GAR-039)
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),
  IDEMPOTENCY_RETENTION_HOURS: z.coerce.number().default(24),
  ALLOW_DEV_ACTOR_HEADERS: z.string().default('false').transform((v) => v === 'true'),

  // Auth placeholders (GAR-003)
  JWT_SECRET: z.string().default('dev-insecure-secret-replace-in-production'),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400),

  // Outbox & Jobs (GAR-035, GAR-036)
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  JOB_MAX_RETRIES: z.coerce.number().default(5),

  // Adapters
  PAYMENT_GATEWAY_ADAPTER: z.string().default('mock-sandbox'),
  MESSAGING_ADAPTER: z.string().default('mock-sandbox'),
  MAPS_GEO_ADAPTER: z.string().default('mock-sandbox'),
  OBD_TELEMETRY_ADAPTER: z.string().default('mock-sandbox'),

  // Optional AI API Key (server-side only)
  GEMINI_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cachedConfig: AppConfig | null = null;

export function loadAndValidateConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('FATAL: Configuration validation failed:', JSON.stringify(result.error.format(), null, 2));
    throw new Error(`Configuration validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }

  // Safety check: In production, JWT_SECRET must not be the default placeholder
  if (result.data.APP_ENV === 'production') {
    if (result.data.JWT_SECRET.includes('insecure') || result.data.JWT_SECRET.length < 32) {
      throw new Error('FATAL: Production mode requires a secure JWT_SECRET of at least 32 characters.');
    }
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export const config = loadAndValidateConfig();

/**
 * Returns safe non-sensitive configuration for public health/status endpoints
 */
export function getSanitizedConfig(): Record<string, unknown> {
  const cfg = loadAndValidateConfig();
  return {
    app_name: cfg.APP_NAME,
    app_env: cfg.APP_ENV,
    app_url: cfg.APP_URL,
    api_url: cfg.API_URL,
    storage_provider: cfg.OBJECT_STORAGE_PROVIDER,
    log_level: cfg.LOG_LEVEL,
    metrics_enabled: cfg.ENABLE_METRICS,
    rate_limit: {
      window_ms: cfg.RATE_LIMIT_WINDOW_MS,
      max_requests: cfg.RATE_LIMIT_MAX_REQUESTS,
    },
    dev_actor_headers_enabled: cfg.APP_ENV !== 'production' && cfg.ALLOW_DEV_ACTOR_HEADERS,
    adapters: {
      payment: cfg.PAYMENT_GATEWAY_ADAPTER,
      messaging: cfg.MESSAGING_ADAPTER,
      maps: cfg.MAPS_GEO_ADAPTER,
      telemetry: cfg.OBD_TELEMETRY_ADAPTER,
    },
  };
}
