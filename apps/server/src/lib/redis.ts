/**
 * Redis Pub/Sub invalidation publishing.
 *
 * After a transaction batch commits, the server publishes a `record_updated`
 * envelope to `space:<space_id>:events`. The Phase-6 sync gateway subscribes
 * to `space:*:events` and fans the patch out to connected clients.
 *
 * When no `REDIS_URL` is configured (tests, local dev), an in-memory
 * publisher records messages so routes can still be exercised end-to-end.
 */

import { createHash } from 'node:crypto';

import type { RecordUpdatedEnvelope } from '@votion/types';
import { Redis } from 'ioredis';

import { hasRedis, type ServerConfig } from '../config.js';

/** Channel prefix for per-space event streams. */
export const SPACE_EVENTS_PREFIX = 'space:';
export const SPACE_EVENTS_SUFFIX = ':events';

/** Returns the Redis channel for a space. */
export function spaceEventsChannel(spaceId: string): string {
  return `${SPACE_EVENTS_PREFIX}${spaceId}${SPACE_EVENTS_SUFFIX}`;
}

/** Canonical per-record envelope published on `space:<space_id>:events`. */
export type SpaceEventMessage = RecordUpdatedEnvelope;

/** Minimal publisher contract used by routes. */
export interface EventPublisher {
  publish(channel: string, message: string): Promise<void>;
  close(): Promise<void>;
}

/** In-memory publisher that records every message (tests / local dev). */
export class MemoryPublisher implements EventPublisher {
  readonly published: { channel: string; message: string }[] = [];

  async publish(channel: string, message: string): Promise<void> {
    this.published.push({ channel, message });
  }

  /** All messages published to a channel, parsed as JSON. */
  messagesFor(channel: string): SpaceEventMessage[] {
    return this.published
      .filter((entry) => entry.channel === channel)
      .map((entry) => JSON.parse(entry.message) as SpaceEventMessage);
  }

  async close(): Promise<void> {
    /* No resources to release. */
  }
}

/** Upstash Redis publisher backed by ioredis. */
export class RedisPublisher implements EventPublisher {
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    // Never crash the API process on a transient Redis error.
    this.client.on('error', () => {
      /* Swallowed: publishing is best-effort; the WAL is the source of truth. */
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.client.publish(channel, message);
    } catch {
      /* Best-effort: the transaction is already committed and WAL-logged. */
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

/** Creates the publisher selected by the server configuration. */
export function createPublisher(config: ServerConfig): EventPublisher {
  if (hasRedis(config) && config.REDIS_URL) {
    return new RedisPublisher(config.REDIS_URL);
  }
  return new MemoryPublisher();
}

/** SHA-256 hex digest — used for refresh-token storage. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
