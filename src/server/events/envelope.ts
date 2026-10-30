/**
 * Canonical Event Envelope Factory & Validation (GAR-035 §4.x, GAR-035 §9)
 *
 * Rules:
 * 1. Event IDs are globally unique and consumers must be idempotent.
 * 2. Envelope includes event_id, type, version, occurred_at, recorded_at, producer,
 *    correlation_id, causation_id, subject_ids, actor_id, actor_type, provenance_class, payload.
 */

import { generatePrefixedId } from '../domain/id';
import { getCurrentUtcIsoString, normalizeToUtcIsoString } from '../domain/time';
import { DataProvenanceClass } from '../../shared/provenance';
import { CanonicalActorType, EventEnvelope } from '../../shared/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export interface CreateEventParams<T = Record<string, unknown>> {
  type: string;
  version?: number;
  occurred_at?: string;
  producer?: string;
  correlation_id: string;
  causation_id?: string;
  subject_ids: Record<string, string>;
  actor_id?: string;
  actor_type?: CanonicalActorType;
  provenance_class?: DataProvenanceClass;
  payload: T;
}

export function createCanonicalEventEnvelope<T = Record<string, unknown>>(
  params: CreateEventParams<T>
): EventEnvelope<T> {
  if (!params.type) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Event type is required');
  }
  if (!params.correlation_id) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Event correlation_id is required');
  }

  const occurredAt = params.occurred_at
    ? normalizeToUtcIsoString(params.occurred_at)
    : getCurrentUtcIsoString();

  return {
    event_id: generatePrefixedId('evt'),
    type: params.type,
    version: params.version ?? 1,
    occurred_at: occurredAt,
    recorded_at: getCurrentUtcIsoString(),
    producer: params.producer ?? 'garage-os-core',
    correlation_id: params.correlation_id,
    causation_id: params.causation_id,
    subject_ids: params.subject_ids || {},
    actor_id: params.actor_id,
    actor_type: params.actor_type,
    provenance_class: params.provenance_class ?? DataProvenanceClass.DERIVED_DETERMINISTIC,
    payload: params.payload,
  };
}
