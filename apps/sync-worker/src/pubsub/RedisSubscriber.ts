/**
 * RedisSubscriber — pub/sub bridge between the write path and live clients.
 *
 * The API/transaction server publishes mutation events to `space:<space_id>:events`.
 * This module subscribes with a dedicated Redis connection to the pattern
 * `space:*:events`, parses the `record_updated` payload and fans it out to
 * every client subscribed to the `space:<space_id>` room.
 *
 * The fan-out path is synchronous JSON → `ws.send`; measured end-to-end in
 * the pubsub integration test well under the 100ms budget.
 */

import type {
  OperationTable,
  RecordPatch,
  RecordUpdatedEnvelope,
} from '@votion/types';
import type { RedisSubscriberClient } from '../redis.js';
import { spaceRoom, type SubscriptionManager } from '../rooms/SubscriptionManager.js';

const OPERATION_TABLES: ReadonlySet<string> = new Set([
  'block',
  'collection',
  'collection_view',
  'space',
]);

const CHANNEL_PATTERN = /^space:([^:]+):events$/;

export interface RedisSubscriberOptions {
  /** Channel pattern to psubscribe. Defaults to `space:*:events`. */
  pattern?: string;
}

export class RedisSubscriber {
  private readonly pattern: string;
  private started = false;

  constructor(
    private readonly redis: RedisSubscriberClient,
    private readonly rooms: SubscriptionManager,
    options: RedisSubscriberOptions = {},
  ) {
    this.pattern = options.pattern ?? 'space:*:events';
  }

  /** Subscribes to the pattern channel and routes pmessage events. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    await this.redis.psubscribe(this.pattern);
    this.redis.on('pmessage', (_pattern: unknown, channel: unknown, message: unknown) => {
      this.handleMessage(String(channel), String(message));
    });
    this.started = true;
  }

  /**
   * Parses a raw pub/sub frame and broadcasts the corresponding
   * `record_updated` envelope to the owning space room. Returns true when
   * the frame was understood and relayed (or at least routed), false when it
   * was dropped as malformed.
   */
  handleMessage(channel: string, raw: string): boolean {
    const match = CHANNEL_PATTERN.exec(channel);
    if (!match) {
      return false;
    }
    const spaceId = match[1];
    if (!spaceId) {
      return false;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error('[pubsub] dropping non-JSON payload on', channel);
      return false;
    }
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const candidate = payload as Record<string, unknown>;
    if (candidate.type !== 'record_updated') {
      return false;
    }
    const table = candidate.table;
    const id = candidate.id;
    if (typeof table !== 'string' || !OPERATION_TABLES.has(table)) {
      console.error('[pubsub] dropping payload with unknown table:', table);
      return false;
    }
    if (typeof id !== 'string' || id.length === 0) {
      console.error('[pubsub] dropping payload with missing record id');
      return false;
    }

    const version =
      typeof candidate.version === 'number' && Number.isFinite(candidate.version)
        ? candidate.version
        : 0;
    const patch =
      typeof candidate.patch === 'object' && candidate.patch !== null && !Array.isArray(candidate.patch)
        ? (candidate.patch as RecordPatch)
        : {};

    const envelope: RecordUpdatedEnvelope = {
      type: 'record_updated',
      table: table as OperationTable,
      id,
      version,
      patch,
      spaceId,
      ...(typeof candidate.lastEditedTime === 'number'
        ? { lastEditedTime: candidate.lastEditedTime }
        : {}),
      ...(typeof candidate.lastEditedById === 'string'
        ? { lastEditedById: candidate.lastEditedById }
        : {}),
    };

    this.rooms.broadcastToRoom(spaceRoom(spaceId), envelope);
    return true;
  }
}
