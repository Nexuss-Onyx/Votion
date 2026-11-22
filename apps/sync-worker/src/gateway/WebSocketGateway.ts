/**
 * WebSocketGateway — connection lifecycle, auth handshake and message router.
 *
 * Handshake:
 *   The JWT is extracted from either the `?token=` query parameter or the
 *   `Authorization: Bearer <token>` header. Validation happens in
 *   `verifyClient`, so unauthenticated connections are rejected with an
 *   HTTP 401 before the WebSocket upgrade completes. On success the
 *   authenticated `userId` and `spaceIds` claims are attached to the socket
 *   context; clients cannot spoof them afterwards.
 *
 * Heartbeat:
 *   A server-side ping is sent every `heartbeatIntervalMs` (default 30s).
 *   Sockets that fail to pong between two pings are terminated.
 *
 * Disconnect:
 *   On close the presence hub emits `leave` frames and deletes ephemeral
 *   keys, then the subscription manager purges the socket from all rooms.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import type {
  PresenceEnvelope,
  ServerSocketMessage,
  SocketEnvelope,
  SubscribeEnvelope,
  SubscriptionTarget,
} from '@votion/types';
import { isPresenceEnvelope, isSubscribeEnvelope } from '@votion/types';
import { SubscriptionManager, roomKeyForTarget } from '../rooms/SubscriptionManager.js';
import type { EphemeralPresence } from '../presence/EphemeralPresence.js';
import type { SocketContext, SyncWebSocket } from '../socket.js';
import { sendEnvelope, sendSocketError } from '../envelope.js';

export interface WebSocketGatewayOptions {
  /** Port to bind; pass 0 for an ephemeral port (tests). */
  port: number;
  /** Host to bind. Defaults to 0.0.0.0 so the gateway is reachable in containers. */
  host?: string;
  /** Secret used to verify client JWTs. */
  jwtSecret: string;
  /** Ping interval for the heartbeat cycle. Defaults to 30_000 ms. */
  heartbeatIntervalMs?: number;
}

export interface WebSocketGatewayDeps {
  subscriptionManager: SubscriptionManager;
  presence: EphemeralPresence;
}

type AuthedIncomingMessage = IncomingMessage & { auth?: SocketContext };

const OPERATION_TABLES: ReadonlySet<string> = new Set([
  'block',
  'collection',
  'collection_view',
  'space',
]);

/** Extracts the bearer token from the query string or Authorization header. */
export function extractToken(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      return queryToken;
    }
  } catch {
    // fall through to header parsing
  }
  const header = req.headers['authorization'];
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/** Verifies a JWT and maps it onto the socket context, or null when invalid. */
export function verifySocketToken(token: string, secret: string): SocketContext | null {
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, secret);
  } catch {
    return null;
  }
  if (typeof decoded === 'string') {
    return null;
  }
  const rawUserId = decoded.sub ?? decoded['userId'] ?? decoded['user_id'];
  if (typeof rawUserId !== 'string' || rawUserId.length === 0) {
    return null;
  }
  const rawSpaces = decoded['spaceIds'] ?? decoded['space_ids'] ?? decoded['spaces'];
  const spaceIds = Array.isArray(rawSpaces)
    ? rawSpaces.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
  return { userId: rawUserId, spaceIds };
}

export class WebSocketGateway {
  private readonly subscriptionManager: SubscriptionManager;
  private readonly presence: EphemeralPresence;
  private readonly jwtSecret: string;
  private readonly heartbeatIntervalMs: number;
  private readonly host: string;
  private readonly port: number;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WebSocketGatewayOptions, deps: WebSocketGatewayDeps) {
    this.port = options.port;
    this.host = options.host ?? '0.0.0.0';
    this.jwtSecret = options.jwtSecret;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.subscriptionManager = deps.subscriptionManager;
    this.presence = deps.presence;
  }

  /** Bound port (available after {@link start}). */
  get boundPort(): number {
    const address = this.wss?.address();
    if (address && typeof address === 'object') {
      return (address as AddressInfo).port;
    }
    return this.port;
  }

  /** Number of connected clients (observability & tests). */
  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  /** Starts the server and resolves once it is listening. */
  start(): Promise<void> {
    if (this.wss) {
      return Promise.resolve();
    }
    const secret = this.jwtSecret;
    const wss = new WebSocketServer({
      port: this.port,
      host: this.host,
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => {
        const token = extractToken(info.req);
        if (!token) {
          return false;
        }
        const context = verifySocketToken(token, secret);
        if (!context) {
          return false;
        }
        (info.req as AuthedIncomingMessage).auth = context;
        return true;
      },
    });
    this.wss = wss;

    wss.on('connection', (socket: SyncWebSocket, req: AuthedIncomingMessage) => {
      this.handleConnection(socket, req);
    });
    wss.on('error', (error) => {
      console.error('[gateway] server error:', error);
    });

    this.startHeartbeat();

    return new Promise<void>((resolve, reject) => {
      wss.once('listening', () => resolve());
      wss.once('error', reject);
    });
  }

  /** Gracefully tears down: stops the heartbeat, terminates sockets, closes the server. */
  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const wss = this.wss;
    if (!wss) {
      return;
    }
    this.wss = null;
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  private handleConnection(socket: SyncWebSocket, req: AuthedIncomingMessage): void {
    const auth = req.auth;
    if (!auth) {
      // Defensive: verifyClient should have rejected this upgrade already.
      socket.close(4401, 'unauthenticated');
      return;
    }
    socket.context = auth;
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw) => {
      void this.handleMessage(socket, raw).catch((error) => {
        console.error('[gateway] unhandled message error:', error);
        sendSocketError(socket, 'internal_error', 'Unexpected gateway error.');
      });
    });

    socket.on('close', () => {
      void (async () => {
        try {
          await this.presence.handleDisconnect(socket);
        } catch (error) {
          console.error('[gateway] presence disconnect failed:', error);
        } finally {
          this.subscriptionManager.handleDisconnect(socket);
        }
      })();
    });

    socket.on('error', (error) => {
      console.error('[gateway] socket error:', error);
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const wss = this.wss;
      if (!wss) {
        return;
      }
      for (const client of wss.clients) {
        const socket = client as SyncWebSocket;
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, this.heartbeatIntervalMs);
  }

  private async handleMessage(
    socket: SyncWebSocket,
    raw: WebSocket.RawData,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      sendSocketError(socket, 'invalid_json', 'Frame is not valid JSON.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      sendSocketError(socket, 'invalid_json', 'Frame must be a JSON object.');
      return;
    }

    if (isSubscribeEnvelope(parsed as SocketEnvelope)) {
      this.handleSubscribe(socket, parsed as SubscribeEnvelope);
      return;
    }
    const action = (parsed as Record<string, unknown>)['action'];
    if (action === 'unsubscribe') {
      this.handleUnsubscribe(socket, parsed as SubscribeEnvelope);
      return;
    }
    if (isPresenceEnvelope(parsed as SocketEnvelope)) {
      await this.presence.handlePresence(socket, parsed as PresenceEnvelope);
      return;
    }
    sendSocketError(socket, 'unsupported_message', 'Unrecognized envelope.');
  }

  private handleSubscribe(socket: SyncWebSocket, envelope: SubscribeEnvelope): void {
    const targets = envelope.subscriptions;
    if (!Array.isArray(targets) || targets.length === 0) {
      sendSocketError(socket, 'invalid_subscription', 'Provide a non-empty subscriptions array.');
      return;
    }

    const validated: SubscriptionTarget[] = [];
    for (const target of targets) {
      if (
        !target ||
        typeof target !== 'object' ||
        typeof target.table !== 'string' ||
        !OPERATION_TABLES.has(target.table) ||
        typeof target.id !== 'string' ||
        target.id.length === 0
      ) {
        sendSocketError(
          socket,
          'invalid_subscription',
          'Each subscription requires a known table and a non-empty id.',
        );
        return;
      }
      validated.push(target);
    }

    // Authorization: when the token carries an explicit space allow-list,
    // space subscriptions outside of it are refused.
    const allowedSpaces = socket.context?.spaceIds ?? [];
    for (const target of validated) {
      if (
        target.table === 'space' &&
        allowedSpaces.length > 0 &&
        !allowedSpaces.includes(target.id)
      ) {
        sendSocketError(
          socket,
          'forbidden_space',
          `Not authorized to subscribe to space ${target.id}.`,
        );
        return;
      }
    }

    for (const target of validated) {
      this.subscriptionManager.subscribe(socket, roomKeyForTarget(target.table, target.id));
    }

    const ack: ServerSocketMessage = { type: 'subscribed', subscriptions: validated };
    sendEnvelope(socket, ack);
  }

  private handleUnsubscribe(socket: SyncWebSocket, envelope: SubscribeEnvelope): void {
    const targets = envelope.subscriptions;
    if (!Array.isArray(targets)) {
      return;
    }
    for (const target of targets) {
      if (
        target &&
        typeof target.table === 'string' &&
        OPERATION_TABLES.has(target.table) &&
        typeof target.id === 'string' &&
        target.id.length > 0
      ) {
        this.subscriptionManager.unsubscribe(socket, roomKeyForTarget(target.table, target.id));
      }
    }
  }
}
