/**
 * Garage OS Canonical System Types & Shared Contracts (GAR-000, GAR-002, GAR-034, GAR-035)
 */

import { ErrorCode } from './errors';
import { DataProvenanceClass } from './provenance';

// Canonical Actor Model (GAR-000 §4)
export enum CanonicalActorType {
  VEHICLE_OWNER = 'VEHICLE_OWNER',
  HOUSEHOLD_FLEET_MANAGER = 'HOUSEHOLD_FLEET_MANAGER',
  GARAGE_STAFF = 'GARAGE_STAFF',
  MOBILE_MECHANIC_TOW_PROVIDER = 'MOBILE_MECHANIC_TOW_PROVIDER',
  SELLER = 'SELLER',
  TRUSTED_CONTACT = 'TRUSTED_CONTACT',
  PLATFORM_OPERATOR = 'PLATFORM_OPERATOR',
  SYSTEM_WORKER = 'SYSTEM_WORKER',
}

export interface ActorContext {
  actor_id: string;
  actor_type: CanonicalActorType;
  roles: string[];
  session_id?: string;
  organization_id?: string;
  tenant_id?: string;
}

// Canonical Platform Lifecycle State (GAR-002 §6)
export enum PlatformLifecycleState {
  ACTIVE = 'ACTIVE',
  DEGRADED = 'DEGRADED',
  READ_ONLY = 'READ_ONLY',
  MAINTENANCE = 'MAINTENANCE',
  UNAVAILABLE = 'UNAVAILABLE',
}

// Canonical API Request Envelope (GAR-034)
export interface RequestEnvelope<T = unknown> {
  data: T;
  meta?: {
    idempotency_key?: string;
    client_timestamp?: string;
    client_version?: string;
    correlation_id?: string;
  };
}

// Canonical API Response Metadata (GAR-034 §12B)
export interface ResponseMeta {
  correlation_id: string;
  timestamp: string;
  idempotency_replayed?: boolean;
  resource_version?: number;
  pagination?: {
    cursor?: string;
    next_cursor?: string | null;
    has_more: boolean;
    total_count?: number;
    limit: number;
  };
}

// Canonical API Response Envelope (GAR-034 §12B)
export interface ResponseEnvelope<T = unknown> {
  data: T;
  meta: ResponseMeta;
  warnings?: Array<{ code: string; message: string }>;
}

// Canonical API Error Envelope (GAR-034)
export interface ApiErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Array<{ field?: string; message: string; code?: string }>;
    path?: string;
    timestamp: string;
  };
  meta: {
    correlation_id: string;
    timestamp: string;
  };
}

// Canonical Event Envelope (GAR-035 §4.x & §9)
export interface EventEnvelope<T = Record<string, unknown>> {
  event_id: string;
  type: string;
  version: number;
  occurred_at: string;
  recorded_at: string;
  producer: string;
  correlation_id: string;
  causation_id?: string;
  subject_ids: Record<string, string>; // e.g. { vehicle_id: "...", owner_id: "..." }
  actor_id?: string;
  actor_type?: CanonicalActorType;
  provenance_class: DataProvenanceClass;
  payload: T;
}

// Background Job Specification (GAR-036)
export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  RETRY_WAIT = 'RETRY_WAIT',
  DEAD_LETTERED = 'DEAD_LETTERED',
  CANCELLED = 'CANCELLED',
}

export interface JobDefinition<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  max_retries: number;
  retry_count: number;
  status: JobStatus;
  run_at: string;
  created_at: string;
  updated_at: string;
  lease_id?: string | null;
  lease_expires_at?: string | null;
  last_error?: string | null;
  correlation_id: string;
}

// Platform Capabilities (GAR-002 §8 /v1/platform/capabilities)
export interface PlatformCapabilityRegistry {
  platform_name: string;
  version: string;
  environment: string;
  lifecycle_state: PlatformLifecycleState;
  architecture_baseline: string; // 'GAR-000-to-GAR-051'
  active_sprint: string;        // 'Sprint 1: Engineering Foundation'
  domains: Array<{
    id: string;
    title: string;
    status: 'FOUNDATION_READY' | 'NEXT_SPRINT' | 'PLANNED';
    owner: string;
  }>;
  subsystems: {
    database: { type: string; status: string; migrations_applied: number };
    event_bus: { type: string; outbox_status: string; unconsumed_events: number };
    background_worker: { active_jobs: number; failed_jobs: number; dead_letter_count: number };
    storage: { provider: string; status: string };
    security: { hsts: boolean; rate_limiting: boolean; audit_enabled: boolean };
  };
}
