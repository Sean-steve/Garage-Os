/**
 * Garage OS — Sprint 14 Real-Time Event Bus (GAR-016)
 *
 * Security rules:
 * - Identity is derived from a canonical session, never query-supplied user/role IDs.
 * - Every topic subscription is authorized server-side.
 * - Topic authorization is re-evaluated when events are published so expired
 *   tracking contexts stop receiving sensitive updates.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer, IncomingMessage } from 'http';
import { Response } from 'express';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';
import { authService } from '../identity/authService';
import { AuthenticatedActorContext } from '../identity/types';
import { assertRealtimeTopicAccess } from './dispatchAuthorization';

export interface DispatchRealtimeEvent<T = unknown> {
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
  actor: AuthenticatedActorContext;
  sessionToken?: string;
  organizationId?: string;
}

function sessionTokenFromRequest(req: IncomingMessage): {
  token?: string;
  organizationId?: string;
  initialTopic?: string;
} {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const authHeader = req.headers.authorization;
  const headerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  return {
    token: headerToken || url.searchParams.get('sessionToken') || url.searchParams.get('token') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    initialTopic: url.searchParams.get('topic') || undefined,
  };
}

export class RealtimeBus {
  private wss: WebSocketServer | null = null;
  private wsClients = new Map<WebSocket, ClientSubscription>();
  private sseClients = new Map<string, ClientSubscription>();
  private sequenceCounter = 0;

  init(server: HttpServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      server,
      path: '/api/v1/dispatch/ws',
    });

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      try {
        const { token, organizationId, initialTopic } = sessionTokenFromRequest(req);
        if (!token) {
          socket.close(4401, 'Authentication required');
          return;
        }

        const actor = authService.authenticateSession(token, organizationId);
        if (!actor) {
          socket.close(4401, 'Invalid or expired session');
          return;
        }

        const subscription: ClientSubscription = {
          socket,
          topics: new Set<string>(),
          actor,
          sessionToken: token,
          organizationId,
        };

        if (initialTopic) {
          assertRealtimeTopicAccess(actor, initialTopic);
          subscription.topics.add(initialTopic);
        }

        this.wsClients.set(socket, subscription);

        socket.send(
          JSON.stringify({
            topic: 'system',
            sequence: ++this.sequenceCounter,
            event: 'CONNECTED',
            data: { connected: true, timestamp: getCurrentUtcIsoString() },
            timestamp: getCurrentUtcIsoString(),
          })
        );

        socket.on('message', (message) => {
          try {
            const parsed = JSON.parse(message.toString());

            if (parsed.action === 'SUBSCRIBE' && typeof parsed.topic === 'string') {
              assertRealtimeTopicAccess(subscription.actor, parsed.topic);
              subscription.topics.add(parsed.topic);
              socket.send(
                JSON.stringify({
                  topic: parsed.topic,
                  sequence: ++this.sequenceCounter,
                  event: 'SUBSCRIBED',
                  data: { topic: parsed.topic },
                  timestamp: getCurrentUtcIsoString(),
                })
              );
              return;
            }

            if (parsed.action === 'UNSUBSCRIBE' && typeof parsed.topic === 'string') {
              subscription.topics.delete(parsed.topic);
              return;
            }

            if (parsed.action === 'PING') {
              socket.send(
                JSON.stringify({ action: 'PONG', timestamp: getCurrentUtcIsoString() })
              );
            }
          } catch (err) {
            logger.warn(`Rejected realtime subscription message: ${err instanceof Error ? err.message : String(err)}`);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  topic: 'system',
                  sequence: ++this.sequenceCounter,
                  event: 'SUBSCRIPTION_DENIED',
                  data: { message: 'Realtime topic is not authorized' },
                  timestamp: getCurrentUtcIsoString(),
                })
              );
            }
          }
        });

        socket.on('close', () => {
          this.wsClients.delete(socket);
        });

        socket.on('error', (err) => {
          logger.warn(`WebSocket error: ${err.message}`);
          this.wsClients.delete(socket);
        });
      } catch (err) {
        logger.warn(`Realtime authentication failed: ${err instanceof Error ? err.message : String(err)}`);
        socket.close(4403, 'Realtime access denied');
      }
    });

    logger.info('Authenticated real-time WebSocket server initialized on /api/v1/dispatch/ws');
  }

  registerSseClient(
    clientId: string,
    res: Response,
    topics: string[],
    actor: AuthenticatedActorContext
  ): void {
    for (const topic of topics) {
      assertRealtimeTopicAccess(actor, topic);
    }

    const subscription: ClientSubscription = {
      sseResponse: res,
      topics: new Set(topics),
      actor,
    };

    this.sseClients.set(clientId, subscription);
    res.write(
      `event: connected\ndata: ${JSON.stringify({ connected: true, clientId })}\n\n`
    );

    res.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  private refreshWsActor(subscription: ClientSubscription): AuthenticatedActorContext | null {
    if (!subscription.sessionToken) return subscription.actor;
    try {
      const actor = authService.authenticateSession(
        subscription.sessionToken,
        subscription.organizationId
      );
      if (!actor) return null;
      subscription.actor = actor;
      return actor;
    } catch {
      return null;
    }
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

    for (const [socket, subscription] of this.wsClients.entries()) {
      if (
        socket.readyState !== WebSocket.OPEN ||
        (!subscription.topics.has(topic) && !subscription.topics.has('*'))
      ) {
        continue;
      }

      const actor = this.refreshWsActor(subscription);
      if (!actor) {
        socket.close(4401, 'Session expired');
        this.wsClients.delete(socket);
        continue;
      }

      try {
        assertRealtimeTopicAccess(actor, topic);
        socket.send(messageString);
      } catch {
        subscription.topics.delete(topic);
      }
    }

    for (const [clientId, subscription] of this.sseClients.entries()) {
      if (
        !subscription.sseResponse ||
        (!subscription.topics.has(topic) && !subscription.topics.has('*'))
      ) {
        continue;
      }

      try {
        assertRealtimeTopicAccess(subscription.actor, topic);
        subscription.sseResponse.write(`event: ${event}\ndata: ${messageString}\n\n`);
      } catch {
        subscription.topics.delete(topic);
        if (subscription.topics.size === 0) {
          subscription.sseResponse.end();
          this.sseClients.delete(clientId);
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
