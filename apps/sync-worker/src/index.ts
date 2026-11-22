/**
 * Sync worker entrypoint.
 *
 * Boots a persistent WebSocket gateway that multiplexes client connections,
 * joins them to `space:<space_id>` / `page:<page_id>` rooms, relays Redis
 * pub/sub mutation events to subscribed rooms, and maintains ephemeral
 * presence in Redis with a short TTL.
 */

import { Redis } from 'ioredis';
import { loadConfig, DEFAULT_DEV_JWT_SECRET } from './config.js';
import type { RedisCommandClient, RedisSubscriberClient } from './redis.js';
import { SubscriptionManager } from './rooms/SubscriptionManager.js';
import { EphemeralPresence } from './presence/EphemeralPresence.js';
import { RedisSubscriber } from './pubsub/RedisSubscriber.js';
import { WebSocketGateway } from './gateway/WebSocketGateway.js';

/** Waits for both Redis connections to become ready, with a hard timeout. */
async function waitForRedis(
  clients: Array<{ status: string; once: (event: string, listener: () => void) => unknown }>,
  timeoutMs = 5_000,
): Promise<void> {
  const pending = clients.map(
    (client) =>
      new Promise<void>((resolve) => {
        if (client.status === 'ready') {
          resolve();
          return;
        }
        client.once('ready', () => resolve());
      }),
  );
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.all(pending).then(() => undefined),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timed out waiting for Redis')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.jwtSecret === DEFAULT_DEV_JWT_SECRET) {
    console.warn(
      '[sync-worker] WS_JWT_SECRET is not set — using the built-in development secret. ' +
        'Set WS_JWT_SECRET before exposing this service.',
    );
  }

  const commandRedis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  const subscriberRedis = new Redis(config.redisUrl, {
    // A subscribing connection must not enforce per-request retry limits.
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  const subscriptionManager = new SubscriptionManager();
  const presence = new EphemeralPresence(
    commandRedis as unknown as RedisCommandClient,
    subscriptionManager,
    { ttlSeconds: config.presenceTtlSeconds },
  );
  const gateway = new WebSocketGateway(
    {
      port: config.port,
      host: config.host,
      jwtSecret: config.jwtSecret,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    },
    { subscriptionManager, presence },
  );
  const subscriber = new RedisSubscriber(
    subscriberRedis as unknown as RedisSubscriberClient,
    subscriptionManager,
  );

  commandRedis.on('error', (error) => console.error('[sync-worker] redis(command) error:', error));
  subscriberRedis.on('error', (error) =>
    console.error('[sync-worker] redis(subscriber) error:', error),
  );

  await waitForRedis([commandRedis, subscriberRedis]);
  await gateway.start();
  await subscriber.start();
  console.log(
    `[sync-worker] WebSocket gateway listening on ${config.host}:${gateway.boundPort} ` +
      `(heartbeat=${config.heartbeatIntervalMs}ms, presence TTL=${config.presenceTtlSeconds}s)`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[sync-worker] received ${signal}, shutting down…`);
    try {
      await gateway.close();
    } finally {
      commandRedis.disconnect();
      subscriberRedis.disconnect();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[sync-worker] fatal startup error:', error);
  process.exit(1);
});
