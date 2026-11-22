/**
 * Shared test harness for the sync-worker integration tests.
 *
 * Tests run an in-process gateway bound to an ephemeral port and inject
 * `ioredis-mock` instances in place of a real Redis, so the full
 * WebSocket + pub/sub + TTL path is exercised without external services.
 */

import jwt from 'jsonwebtoken';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import type { IncomingHttpHeaders } from 'node:http';
import { WebSocketGateway } from '../src/gateway/WebSocketGateway.js';
import { SubscriptionManager } from '../src/rooms/SubscriptionManager.js';
import { EphemeralPresence } from '../src/presence/EphemeralPresence.js';
import { RedisSubscriber } from '../src/pubsub/RedisSubscriber.js';
import type { RedisCommandClient, RedisSubscriberClient } from '../src/redis.js';

export const TEST_JWT_SECRET = 'sync-worker-test-secret';

export interface TestRigOptions {
  presenceTtlSeconds?: number;
  heartbeatIntervalMs?: number;
}

export interface TestRig {
  gateway: WebSocketGateway;
  rooms: SubscriptionManager;
  presence: EphemeralPresence;
  commandRedis: Redis;
  subscriberRedis: Redis;
  subscriber: RedisSubscriber;
  port: number;
  close: () => Promise<void>;
}

export async function startRig(options: TestRigOptions = {}): Promise<TestRig> {
  const commandRedis = new RedisMock();
  const subscriberRedis = new RedisMock();
  const rooms = new SubscriptionManager();
  const presence = new EphemeralPresence(
    commandRedis as unknown as RedisCommandClient,
    rooms,
    { ttlSeconds: options.presenceTtlSeconds ?? 10 },
  );
  const gateway = new WebSocketGateway(
    {
      port: 0,
      host: '127.0.0.1',
      jwtSecret: TEST_JWT_SECRET,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    },
    { subscriptionManager: rooms, presence },
  );
  await gateway.start();
  const subscriber = new RedisSubscriber(
    subscriberRedis as unknown as RedisSubscriberClient,
    rooms,
  );
  await subscriber.start();

  return {
    gateway,
    rooms,
    presence,
    commandRedis,
    subscriberRedis,
    subscriber,
    port: gateway.boundPort,
    close: async () => {
      await gateway.close();
      commandRedis.disconnect();
      subscriberRedis.disconnect();
    },
  };
}

export interface ConnectOptions {
  token?: string;
  /** Send the token as an Authorization header instead of a query parameter. */
  useAuthorizationHeader?: boolean;
  headers?: IncomingHttpHeaders;
}

/** Opens a client that is expected to connect successfully. */
export function connectClient(port: number, options: ConnectOptions = {}): Promise<WebSocket> {
  const headers: IncomingHttpHeaders = { ...(options.headers ?? {}) };
  let query = '';
  if (options.token !== undefined) {
    if (options.useAuthorizationHeader) {
      headers['authorization'] = `Bearer ${options.token}`;
    } else {
      query = `?token=${encodeURIComponent(options.token)}`;
    }
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${query}`, { headers });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Attempts a connection expected to be rejected during the HTTP handshake. */
export function connectExpectingRejection(
  port: number,
  options: ConnectOptions = {},
): Promise<Error> {
  return new Promise((resolve, reject) => {
    const headers: IncomingHttpHeaders = { ...(options.headers ?? {}) };
    let query = '';
    if (options.token !== undefined) {
      if (options.useAuthorizationHeader) {
        headers['authorization'] = `Bearer ${options.token}`;
      } else {
        query = `?token=${encodeURIComponent(options.token)}`;
      }
    }
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${query}`, { headers });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('connection unexpectedly succeeded'));
    });
    socket.once('error', (error) => resolve(error));
    socket.once('unexpected-response', (_request, response) => {
      resolve(new Error(`unexpected server response: ${response.statusCode}`));
    });
  });
}

export function signToken(
  claims: Record<string, unknown> = {},
  secret: string = TEST_JWT_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign({ sub: 'user-1', spaceIds: ['space-1'], ...claims }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
    ...options,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ParsedMessage = Record<string, any>;

/** Waits for the first incoming message matching `predicate`. */
export function waitForMessage(
  socket: WebSocket,
  predicate: (message: ParsedMessage) => boolean,
  timeoutMs = 2000,
): Promise<ParsedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for a matching message'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      let parsed: ParsedMessage;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
    };
    socket.on('message', onMessage);
  });
}

/** Resolves to true when a matching message arrives within `windowMs`, false otherwise. */
export async function receivesMessage(
  socket: WebSocket,
  predicate: (message: ParsedMessage) => boolean,
  windowMs = 400,
): Promise<boolean> {
  try {
    await waitForMessage(socket, predicate, windowMs);
    return true;
  } catch {
    return false;
  }
}

/** Resolves with the close code once the socket closes. */
export function waitForClose(socket: WebSocket, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve(1005);
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
