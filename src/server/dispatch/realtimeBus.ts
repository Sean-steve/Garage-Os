/**
 * Garage OS — Sprint 14: Real-Time Event Bus & WebSocket/SSE Infrastructure (GAR-016)
 * Server-authoritative real-time streaming for dispatch, location, and operations.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { Response } from 'express';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

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
  userId?: string;
  role?: string;
  providerId?: string;
}

export class RealtimeBus {
  private wss: WebSocketServer | null = null;
  private wsClients = new Map<WebSocket, ClientSubscription>();
  private sseClients = new Map<string, ClientSubscription>();
  private sequenceCounter = 0;

  /**
   * Initializes the WebSocket server attached to the existing HTTP server
   */
  init(server: HttpServer) {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      server,
      path: '/api/v1/dispatch/ws',
    });

    this.wss.on('connection', (socket: WebSocket, req) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId') || undefined;
      const role = url.searchParams.get('role') || 'CUSTOMER';
      const providerId = url.searchParams.get('providerId') || undefined;
      const initialTopic = url.searchParams.get('topic');

      const subscription: ClientSubscription = {
        socket,
        topics: new Set<string>(),
        userId,
        role,
        providerId,
      };

      if (initialTopic) {
        subscription.topics.add(initialTopic);
      }

      this.wsClients.set(socket, subscription);
      logger.info(`WebSocket client connected: userId=${userId}, role=${role}`);

      // Send greeting & initial connection state
      socket.send(
        JSON.stringify({
          topic: 'system',
          sequence: ++this.sequenceCounter,
          event: 'CONNECTED',
          data: { connected: true, timestamp: getCurrentUtcIsoString() },
          timestamp: getCurrentUtcIsoString(),
        })
      );

      socket.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message.toString());
          if (parsed.action === 'SUBSCRIBE' && parsed.topic) {
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
          } else if (parsed.action === 'UNSUBSCRIBE' && parsed.topic) {
            subscription.topics.delete(parsed.topic);
          } else if (parsed.action === 'PING') {
            socket.send(JSON.stringify({ action: 'PONG', timestamp: getCurrentUtcIsoString() }));
          }
        } catch (err) {
          logger.warn(`Failed to parse WebSocket message: ${err}`);
        }
      });

      socket.on('close', () => {
        this.wsClients.delete(socket);
        logger.info(`WebSocket client disconnected: userId=${userId}`);
      });

      socket.on('error', (err) => {
        logger.warn(`WebSocket error: ${err.message}`);
        this.wsClients.delete(socket);
      });
    });

    logger.info('Real-Time WebSocket Server initialized on /api/v1/dispatch/ws');
  }

  /**
   * Registers a Server-Sent Events (SSE) client
   */
  registerSseClient(
    clientId: string,
    res: Response,
    topics: string[],
    userContext?: { userId?: string; role?: string; providerId?: string }
  ) {
    const subscription: ClientSubscription = {
      sseResponse: res,
      topics: new Set(topics),
      userId: userContext?.userId,
      role: userContext?.role,
      providerId: userContext?.providerId,
    };

    this.sseClients.set(clientId, subscription);

    // Initial SSE connected message
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, clientId })}\n\n`);

    res.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  /**
   * Broadcasts an event to all clients subscribed to the topic (both WebSocket and SSE)
   */
  publish<T>(topic: string, event: string, data: T): DispatchRealtimeEvent<T> {
    const payload: DispatchRealtimeEvent<T> = {
      topic,
      sequence: ++this.sequenceCounter,
      event,
      data,
      timestamp: getCurrentUtcIsoString(),
    };

    const messageString = JSON.stringify(payload);

    // 1. Deliver to WebSocket subscribers
    for (const [socket, sub] of this.wsClients.entries()) {
      if (socket.readyState === WebSocket.OPEN && (sub.topics.has(topic) || sub.topics.has('*'))) {
        try {
          socket.send(messageString);
        } catch (err) {
          logger.warn(`Error sending WebSocket message: ${err}`);
        }
      }
    }

    // 2. Deliver to SSE subscribers
    for (const [, sub] of this.sseClients.entries()) {
      if (sub.sseResponse && (sub.topics.has(topic) || sub.topics.has('*'))) {
        try {
          sub.sseResponse.write(`event: ${event}\ndata: ${messageString}\n\n`);
        } catch (err) {
          // Client disconnected
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
