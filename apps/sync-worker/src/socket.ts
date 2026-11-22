/**
 * Shared socket typing helpers used across the gateway, room manager and
 * presence hub.
 */

import type { WebSocket } from 'ws';
import type { UUID } from '@votion/types';

/** Identity and authorization attached to a socket after the JWT handshake. */
export interface SocketContext {
  /** Authenticated user id (JWT `sub`). */
  userId: UUID;
  /** Space ids the user is authorized to subscribe to. */
  spaceIds: UUID[];
}

/**
 * A `ws` socket carrying the authentication context attached by the gateway.
 * Fields are optional on the type because sockets are plain `WebSocket`
 * instances under the hood; they are always set before the socket can
 * process application messages.
 */
export type SyncWebSocket = WebSocket & {
  context?: SocketContext;
  /** Heartbeat liveness flag flipped by ping/pong cycles. */
  isAlive?: boolean;
};
