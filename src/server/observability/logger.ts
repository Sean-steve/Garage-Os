/**
 * Structured JSON Logging Architecture with PII Redaction (GAR-045 §1, GAR-039 §11, GAR-040)
 */

import { config } from '../config/env';
import { getCurrentUtcIsoString } from '../domain/time';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'jwt_secret',
  'apikey',
  'api_key',
  'creditcard',
  'pan',
  'cvv',
  'phone_number',
  'medical_notes',
]);

/**
 * Deeply redact sensitive keys in log payloads
 */
export function redactPayload(obj: unknown, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactPayload(item, depth + 1));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password')) {
      redacted[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object') {
      redacted[key] = redactPayload(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export interface StructuredLogEntry {
  timestamp: string;
  severity: LogLevel;
  service: string;
  environment: string;
  message: string;
  correlation_id?: string;
  actor_id?: string;
  resource_type?: string;
  resource_id?: string;
  duration_ms?: number;
  error_code?: string;
  details?: unknown;
}

export class Logger {
  private service: string;
  private minLevel: LogLevel;

  constructor(service = 'garage-os-core') {
    this.service = service;
    this.minLevel = config.LOG_LEVEL;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[this.minLevel];
  }

  private write(entry: StructuredLogEntry): void {
    if (!this.shouldLog(entry.severity)) return;

    const output: StructuredLogEntry = {
      timestamp: entry.timestamp || getCurrentUtcIsoString(),
      severity: entry.severity,
      service: this.service,
      environment: config.APP_ENV,
      message: entry.message,
      correlation_id: entry.correlation_id,
      actor_id: entry.actor_id,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      duration_ms: entry.duration_ms,
      error_code: entry.error_code,
      details: entry.details ? redactPayload(entry.details) : undefined,
    };

    const jsonStr = JSON.stringify(output);
    if (entry.severity === 'error') {
      console.error(jsonStr);
    } else if (entry.severity === 'warn') {
      console.warn(jsonStr);
    } else {
      console.log(jsonStr);
    }
  }

  debug(message: string, meta?: Partial<StructuredLogEntry>): void {
    this.write({ severity: 'debug', message, service: this.service, environment: config.APP_ENV, timestamp: getCurrentUtcIsoString(), ...meta });
  }

  info(message: string, meta?: Partial<StructuredLogEntry>): void {
    this.write({ severity: 'info', message, service: this.service, environment: config.APP_ENV, timestamp: getCurrentUtcIsoString(), ...meta });
  }

  warn(message: string, meta?: Partial<StructuredLogEntry>): void {
    this.write({ severity: 'warn', message, service: this.service, environment: config.APP_ENV, timestamp: getCurrentUtcIsoString(), ...meta });
  }

  error(message: string, meta?: Partial<StructuredLogEntry>): void {
    this.write({ severity: 'error', message, service: this.service, environment: config.APP_ENV, timestamp: getCurrentUtcIsoString(), ...meta });
  }
}

export const logger = new Logger('garage-os-api');
