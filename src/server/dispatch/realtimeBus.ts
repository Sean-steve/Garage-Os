/**
 * Garage OS — Sprint 14: Authenticated Real-Time Event Bus (GAR-016)
 *
 * R1 hardening:
 * - WebSocket connections begin unauthenticated and cannot subscribe until AUTH succeeds.
 * - Subscription topics are authorized server-side against current actor/resource context.
 * - SSE callers must arrive with an authenticated actor supplied by the HTTP router.
 * - No user/role/provider identity is trusted from URL query parameters.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { Response } from 'express';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { authService } from '../identity/authService';
import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { getDatabase } from '../database/connection';

export interface DispatchRealtimeEvent<T = any> {
  topic: string;
  sequence: number;
  event: string;
  data: T;
  timestamp: string;
}

export interface ClientSubscription {
  socket?: WebSocket;
  sseResponse?: Response;
  topics: Set<string>;
  actor?: AuthenticatedActorContext;
  authenticated: boolean;
}

function isPlatformOperations(actor?: AuthenticatedActorContext): boolean {
  if (!actor) return false;
  return actor.platform_roles.some((role) =>
    [PlatformRole.PLATFORM_ADMIN, PlatformRole.OPERATIONS, PlatformRole.TRUST_AND_SAFETY].includes(role)
  );
}

function actorBelongsToProvider(actor: AuthenticatedActorContext | undefined, providerId: string): boolean {
  if (!actor) return false;
  if (isPlatformOperations(actor)) return true;

  const db = getDatabase();
  const provider = db.prepare(
    'SELECT organization_id FROM service_providers WHERE id = ? LIMIT 1;'
  ).get(providerId) as { organization_id?: string } | undefined;

  if (!provider?.organization_id) return false;
  return actor.memberships.some(
    (membership) =>
      membership.organization_id === provider.organization_id &&
      membership.status === 'ACTIVE'
  );
}

function canSubscribe(actor: AuthenticatedActorContext | undefined, topic: string): boolean {
  if (!actor) return false;

  if (topic === 'operations.dispatch' || topic === '*') {
    return isPlatformOperations(actor);
  }

  if (topic.startsWith('assignment.')) {
    const assignmentId = topic.slice('assignment.'.length);
    const db = getDatabase();
    const tracking = db.prepare(
      'SELECT customer_user_id, tracking_access_status FROM dispatch_tracking_projections WHERE assignment_id = ? LIMIT 1;'
    ).get(assignmentId) as { customer_user_id?: string | null; tracking_access_status?: string } | undefined;

    if (!tracking) return false;
    if (tracking.tracking_access_status !== 'ACTIVE' && !isPlatformOperations(actor)) return false;
    return tracking.customer_user_id === actor.user_id || isPlatformOperations(actor);
  }

  if (topic.startsWith('responder.')) {
    const responderId = topic.slice('responder.'.length);
    const db = getDatabase();
    const presence = db.prepare(
      'SELECT provider_id FROM responder_presence WHERE responder_reference_id = ? LIMIT 1;'
    ).get(responderId) as { provider_id?: string } | undefined;
    return Boolean(presence?.provider_id && actorBelongsToProvider(actor, presence.provider_id));
  }

  // Dispatch request topics are operations-only. Customer tracking uses assignment.{id}.
  if (topic.startsWith('dispatch.request.')) {
    return isPlatformOperations(actor);
  }

  return false;
}

export class RealtimeBus {
  private wss: WebSocketServer | null = null;
  private wsClients = new Map<WebSocket, ClientSubscription>();
  private sseClients = new Map<string, ClientSubscription>();
  private sequenceCounter = 0;

  init(server: HttpServer) {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      server,
      path: '/api/v1/dispatch/ws',
    });

    this.wss.on('connection', (socket: WebSocket) => {
      const subscription: ClientSubscription = {
        socket,
        topics: new Set<string>(),
        authenticated: false,
      };
      this.wsClients.set(socket, subscription);

      socket.send(JSON.stringify({
        topic: 'system',
        sequence: ++this.sequenceCounter,
        event: 'AUTH_REQUIRED',
        data: { authenticated: false },
        timestamp: getCurrentUtcIsoString(),
      }));

      socket.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message.toString());

          if (parsed.action === 'AUTH') {
            const token = typeof parsed.sessionToken === 'string' ? parsed.sessionToken.trim() : '';
            const activeOrgId = typeof parsed.organizationId === 'string' ? parsed.organizationId : undefined;
            const actor = token ? authService.authenticateSession(token, activeOrgId) : null;

            if (!actor) {
              socket.send(JSON.stringify({
                topic: 'system',
                sequence: ++this.sequenceCounter,
                event: 'AUTH_FAILED',
                data: { authenticated: false },
                timestamp: getCurrentUtcIsoString(),
              }));
              socket.close(1008, 'Authentication required');
              return;
            }

            subscription.actor = actor;
            subscription.authenticated = true;
            subscription.topics.clear();
            socket.send(JSON.stringify({
              topic: 'system',
              sequence: ++this.sequenceCounter,
              event: 'AUTHENTICATED',
              data: { authenticated: true, userId: actor.user_id },
              timestamp: getCurrentUtcIsoString(),
            }));
            return;
          }

          if (!subscription.authenticated || !subscription.actor) {
            socket.send(JSON.stringify({
              topic: 'system',
              sequence: ++this.sequenceCounter,
              event: 'AUTH_REQUIRED',
              data: { authenticated: false },
              timestamp: getCurrentUtcIsoString(),
            }));
            return;
          }

          if (parsed.action === 'SUBSCRIBE' && parsed.topic) {
            const topic = String(parsed.topic);
            if (!canSubscribe(subscription.actor, topic)) {
              socket.send(JSON.stringify({
                topic,
                sequence: ++this.sequenceCounter,
                event: 'SUBSCRIPTION_DENIED',
                data: { topic },
                timestamp: getCurrentUtcIsoString(),
              }));
              return;
            }

            subscription.topics.add(topic);
            socket.send(JSON.stringify({
              topic,
              sequence: ++this.sequenceCounter,
              event: 'SUBSCRIBED',
              data: { topic },
              timestamp: getCurrentUtcIsoString(),
            }));
          } else if (parsed.action === 'UNSUBSCRIBE' && parsed.topic) {
            subscription.topics.delete(String(parsed.topic));
          } else if (parsed.action === 'PING') {
            socket.send(JSON.stringify({ action: 'PONG', timestamp: getCurrentUtcIsoString() }));
          }
        } catch (err) {
          logger.warn(`Failed to process WebSocket message: ${err}`);
        }
      });

      socket.on('close', () => {
        this.wsClients.delete(socket);
      });

      socket.on('error', (err) => {
        logger.warn(`WebSocket error: ${err.message}`);
        this.wsClients.delete(socket);
      });
    });

    logger.info('Authenticated Real-Time WebSocket Server initialized on /api/v1/dispatch/ws');
  }

  registerSseClient(
    clientId: string,
    res: Response,
    topics: string[],
    actor: AuthenticatedActorContext
  ) {
    const authorizedTopics = topics.filter((topic) => canSubscribe(actor, topic));
    if (authorizedTopics.length !== topics.length) {
      throw new Error('One or more requested realtime topics are not authorized');
    }

    const subscription: ClientSubscription = {
      sseResponse: res,
      topics: new Set(authorizedTopics),
      actor,
      authenticated: true,
    };

    this.sseClients.set(clientId, subscription);
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, clientId })}\n\n`);

    res.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  publish<T>(topic: string, event: string, data: T): DispatchRealtimeEvent<T> {
    const payload: DispatchRealtimeEvent<T> = {
      topic,
      sequence: ++this.sequenceCounter,
      event,
      data,
      timestamp: getCurrentUtcIsoString(),
    };

    const messageString = JSON.stringify(payload);

    for (const [socket, sub] of this.wsClients.entries()) {
      if (
        socket.readyState === WebSocket.OPEN &&
        sub.authenticated &&
        sub.actor &&
        sub.topics.has(topic) &&
        canSubscribe(sub.actor, topic)
      ) {
        try {
          socket.send(messageString);
        } catch (err) {
          logger.warn(`Error sending WebSocket message: ${err}`);
        }
      }
    }

    for (const [, sub] of this.sseClients.entries()) {
      if (
        sub.sseResponse &&
        sub.authenticated &&
        sub.actor &&
        sub.topics.has(topic) &&
        canSubscribe(sub.actor, topic)
      ) {
        try {
          sub.sseResponse.write(`event: ${event}\ndata: ${messageString}\n\n`);
        } catch {
          // Client disconnect is handled by the close listener.
        }
      }
    }

    return payload;
  }

  getConnectedWsClientCount(): number {
    return this.wsClients.size;
  }

  getConnectedSseClientCount(): number {
    return this.sseClients.size;
  }
}

export const realtimeBus = new RealtimeBus();
