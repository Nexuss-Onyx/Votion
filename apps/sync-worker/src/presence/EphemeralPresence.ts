/**
 * EphemeralPresence — cursor & focus presence with Redis TTL expiry.
 *
 * Presence is strictly ephemeral: it is stored in Redis (never in persistent
 * SQL) under `presence:<page_id>:<user_id>` with a short TTL (default 10s),
 * so a user who closes their laptop simply disappears from the page.
 *
 * Flow for an incoming presence frame:
 *   1. Merge the authenticated socket's `userId` (client cannot spoof it).
 *   2. Write the frame to Redis with the configured TTL.
 *   3. Auto-join the socket to the `page:<page_id>` room on first sight.
 *   4. Fan the frame out to other peers on the page with `action` set to
 *      `join` (first frame) or `move` (subsequent frames).
 *
 * On disconnect every page the socket was present on gets a `leave` frame
 * and the Redis key is deleted eagerly (the TTL is the backstop).
 */

import type { CursorPosition, PresenceEnvelope, SelectionRange } from '@votion/types';
import { pageRoom, type SubscriptionManager } from '../rooms/SubscriptionManager.js';
import type { RedisCommandClient } from '../redis.js';
import type { SyncWebSocket } from '../socket.js';
import { sendSocketError } from '../envelope.js';

export interface PresenceOptions {
  /** Redis TTL for presence keys, in seconds. Defaults to 10. */
  ttlSeconds?: number;
  /** Wall clock, injectable for tests. */
  now?: () => number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validates an optional `{x, y}` cursor payload. */
function parseCursor(value: unknown): CursorPosition | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const { x, y } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  return { x, y };
}

/** Validates an optional `{start, end}` selection range payload. */
function parseSelectionRange(value: unknown): SelectionRange | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const { start, end } = value as Record<string, unknown>;
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return undefined;
  return { start, end };
}

export class EphemeralPresence {
  private readonly ttlSeconds: number;
  private readonly now: () => number;
  /** socket -> set of page ids the socket is present on */
  private readonly socketPages = new Map<SyncWebSocket, Set<string>>();

  constructor(
    private readonly redis: RedisCommandClient,
    private readonly rooms: SubscriptionManager,
    options: PresenceOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? 10;
    this.now = options.now ?? Date.now;
  }

  /** TTL in seconds used for presence keys (observability & tests). */
  get presenceTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /** Redis key for a user's presence on a page. */
  static key(pageId: string, userId: string): string {
    return `presence:${pageId}:${userId}`;
  }

  /**
   * Handles a client presence frame: validates it, refreshes the Redis TTL
   * and fans the delta out to the other peers on the page.
   */
  async handlePresence(socket: SyncWebSocket, message: PresenceEnvelope): Promise<void> {
    const userId = socket.context?.userId;
    if (!userId) {
      sendSocketError(socket, 'unauthenticated', 'Socket has no authenticated context.');
      return;
    }

    const pageId = message.pageId;
    if (typeof pageId !== 'string' || pageId.length === 0) {
      sendSocketError(socket, 'invalid_presence', 'Presence frame requires a non-empty pageId.');
      return;
    }

    const cursor = parseCursor(message.cursor);
    if (message.cursor !== undefined && cursor === undefined) {
      sendSocketError(socket, 'invalid_presence', 'cursor must be an object with finite x and y.');
      return;
    }
    const selectedRange = parseSelectionRange(message.selectedRange);
    if (message.selectedRange !== undefined && selectedRange === undefined) {
      sendSocketError(socket, 'invalid_presence', 'selectedRange must carry finite start and end.');
      return;
    }
    const activeBlockId =
      typeof message.activeBlockId === 'string' && message.activeBlockId.length > 0
        ? message.activeBlockId
        : undefined;

    let joined = this.socketPages.get(socket);
    const firstOnPage = !joined?.has(pageId);

    const envelope: PresenceEnvelope = {
      type: 'presence',
      pageId,
      userId,
      action: firstOnPage ? 'join' : 'move',
      ...(cursor ? { cursor } : {}),
      ...(activeBlockId ? { activeBlockId } : {}),
      ...(selectedRange ? { selectedRange } : {}),
      lastActiveTime: this.now(),
    };

    // Refresh the ephemeral key. Failures are logged, not fatal: the fan-out
    // should still happen so peers stay responsive.
    try {
      await this.redis.set(
        EphemeralPresence.key(pageId, userId),
        JSON.stringify(envelope),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      console.error('[presence] failed to persist ephemeral presence:', error);
    }

    if (firstOnPage) {
      this.rooms.subscribe(socket, pageRoom(pageId));
      if (!joined) {
        joined = new Set();
        this.socketPages.set(socket, joined);
      }
      joined.add(pageId);
    }

    this.rooms.broadcastToRoom(pageRoom(pageId), envelope, socket);
  }

  /**
   * Emits a `leave` frame to the page room and deletes the Redis presence
   * keys for every page the socket was present on. Ordered ahead of the
   * room manager's disconnect purge by the gateway.
   */
  async handleDisconnect(socket: SyncWebSocket): Promise<void> {
    const joined = this.socketPages.get(socket);
    if (!joined || joined.size === 0) {
      this.socketPages.delete(socket);
      return;
    }
    const userId = socket.context?.userId;
    for (const pageId of [...joined]) {
      if (userId) {
        try {
          await this.redis.del(EphemeralPresence.key(pageId, userId));
        } catch (error) {
          console.error('[presence] failed to delete presence key:', error);
        }
        const leave: PresenceEnvelope = {
          type: 'presence',
          pageId,
          userId,
          action: 'leave',
          lastActiveTime: this.now(),
        };
        this.rooms.broadcastToRoom(pageRoom(pageId), leave, socket);
      }
      this.rooms.unsubscribe(socket, pageRoom(pageId));
    }
    this.socketPages.delete(socket);
  }

  /** Pages the socket is currently present on (observability & tests). */
  pagesOf(socket: SyncWebSocket): string[] {
    return [...(this.socketPages.get(socket) ?? [])];
  }
}
