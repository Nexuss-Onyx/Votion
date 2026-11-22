/**
 * SubscriptionManager — room membership tracking for the sync gateway.
 *
 * Rooms are keyed by the canonical room keys used across the collaboration
 * subsystem:
 *
 *   space:<space_id>   broadcast `record_updated` deltas for a workspace
 *   page:<page_id>     relay cursor/focus presence for a page
 *
 * Membership is tracked in memory only; when a socket disconnects every room
 * it joined is purged automatically via {@link SubscriptionManager.handleDisconnect}.
 */

import { WebSocket } from 'ws';
import type { ServerSocketMessage } from '@votion/types';
import type { SyncWebSocket } from '../socket.js';

/** Canonical room key for a space. */
export function spaceRoom(spaceId: string): string {
  return `space:${spaceId}`;
}

/** Canonical room key for a page. */
export function pageRoom(pageId: string): string {
  return `page:${pageId}`;
}

/** Canonical room key for a subscription table target. */
export function roomKeyForTarget(table: string, id: string): string {
  return table === 'space' ? spaceRoom(id) : pageRoom(id);
}

export class SubscriptionManager {
  /** room key -> member sockets */
  private readonly rooms = new Map<string, Set<SyncWebSocket>>();
  /** socket -> set of room keys it has joined */
  private readonly socketRooms = new Map<SyncWebSocket, Set<string>>();

  /** Adds a socket to a room. Returns true when the membership is new. */
  subscribe(socket: SyncWebSocket, roomKey: string): boolean {
    let members = this.rooms.get(roomKey);
    if (!members) {
      members = new Set();
      this.rooms.set(roomKey, members);
    }
    const added = !members.has(socket);
    members.add(socket);

    let joined = this.socketRooms.get(socket);
    if (!joined) {
      joined = new Set();
      this.socketRooms.set(socket, joined);
    }
    joined.add(roomKey);
    return added;
  }

  /** Removes a socket from a room. Empty rooms are discarded. */
  unsubscribe(socket: SyncWebSocket, roomKey: string): boolean {
    const members = this.rooms.get(roomKey);
    let removed = false;
    if (members) {
      removed = members.delete(socket);
      if (members.size === 0) {
        this.rooms.delete(roomKey);
      }
    }
    const joined = this.socketRooms.get(socket);
    if (joined) {
      joined.delete(roomKey);
      if (joined.size === 0) {
        this.socketRooms.delete(socket);
      }
    }
    return removed;
  }

  /**
   * Serializes `message` once and fans it out to every OPEN socket in the
   * room. Returns the number of sockets the message was handed to.
   */
  broadcastToRoom(
    roomKey: string,
    message: ServerSocketMessage,
    excludeSocket?: SyncWebSocket,
  ): number {
    const members = this.rooms.get(roomKey);
    if (!members || members.size === 0) {
      return 0;
    }
    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const member of members) {
      if (member === excludeSocket) {
        continue;
      }
      if (member.readyState !== WebSocket.OPEN) {
        continue;
      }
      member.send(payload);
      delivered += 1;
    }
    return delivered;
  }

  /**
   * Purges a disconnected socket from every room it joined. Called by the
   * gateway on socket close; presence leave notifications are emitted by the
   * presence hub *before* this runs so peers are notified first.
   */
  handleDisconnect(socket: SyncWebSocket): void {
    const joined = this.socketRooms.get(socket);
    if (joined) {
      for (const roomKey of [...joined]) {
        this.unsubscribe(socket, roomKey);
      }
      return;
    }
    // Defensive fallback: scan all rooms for the socket.
    for (const roomKey of [...this.rooms.keys()]) {
      this.unsubscribe(socket, roomKey);
    }
  }

  /** Number of members in a room (observability & tests). */
  roomSize(roomKey: string): number {
    return this.rooms.get(roomKey)?.size ?? 0;
  }

  /** Room keys the socket has joined (observability & tests). */
  roomsOf(socket: SyncWebSocket): string[] {
    return [...(this.socketRooms.get(socket) ?? [])];
  }
}
