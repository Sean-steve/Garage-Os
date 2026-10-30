/**
 * Event Bus & Subscription Registry (GAR-035 §1-§8)
 *
 * Implements:
 * - Strongly-typed event dispatching
 * - Idempotent consumer execution
 * - Outbox listener integration
 */

import { EventEnvelope } from '../../shared/types';
import { logger } from '../observability/logger';

export type EventHandler<T = Record<string, unknown>> = (event: EventEnvelope<T>) => Promise<void> | void;

class EventBus {
  private handlers: Map<string, Set<EventHandler<any>>> = new Map();
  private processedEventIds = new Set<string>();

  /**
   * Subscribe to a canonical domain event
   */
  subscribe<T = Record<string, unknown>>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Publish an event to registered consumers
   */
  async publish<T = Record<string, unknown>>(event: EventEnvelope<T>): Promise<{ dispatched: number; failed: number }> {
    const handlers = this.handlers.get(event.type);
    let dispatched = 0;
    let failed = 0;

    // Idempotent safeguard on consumer side
    if (this.processedEventIds.has(event.event_id)) {
      logger.warn(`Event ${event.event_id} (${event.type}) already processed, skipping duplicate execution`, {
        correlation_id: event.correlation_id,
      });
      return { dispatched: 0, failed: 0 };
    }

    if (!handlers || handlers.size === 0) {
      logger.debug(`No in-process handlers registered for event type ${event.type}`, {
        correlation_id: event.correlation_id,
        resource_id: event.event_id,
      });
      return { dispatched: 0, failed: 0 };
    }

    for (const handler of handlers) {
      try {
        await handler(event);
        dispatched++;
      } catch (err) {
        failed++;
        logger.error(`Error in event handler for ${event.type}: ${err instanceof Error ? err.message : String(err)}`, {
          correlation_id: event.correlation_id,
          resource_id: event.event_id,
        });
      }
    }

    // Keep bounded history of processed event IDs for deduplication
    this.processedEventIds.add(event.event_id);
    if (this.processedEventIds.size > 5000) {
      const oldest = Array.from(this.processedEventIds).slice(0, 1000);
      for (const id of oldest) {
        this.processedEventIds.delete(id);
      }
    }

    return { dispatched, failed };
  }

  getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }

  clear(): void {
    this.handlers.clear();
    this.processedEventIds.clear();
  }
}

export const eventBus = new EventBus();
