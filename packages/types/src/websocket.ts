/**
 * Real-time gateway envelopes (`apps/sync-worker`).
 *
 * Clients subscribe to individual records, stream ephemeral presence, and
 * receive `record_updated` invalidation patches that are merged into local state.
 */

import type { OperationTable, Timestamp, UUID } from './common.js';

/** Record subscription target. */
export interface SubscriptionTarget {
  table: OperationTable;
  id: UUID;
}

/** Client -> server: subscribe to record invalidation events. */
export interface SubscribeEnvelope {
  action: 'subscribe';
  subscriptions: SubscriptionTarget[];
}

/** Client -> server: stop receiving events for records. */
export interface UnsubscribeEnvelope {
  action: 'unsubscribe';
  subscriptions: SubscriptionTarget[];
}

/** Pointer coordinates within the page canvas. */
export interface CursorPosition {
  x: number;
  y: number;
}

/** Inline text selection range (character offsets). */
export interface SelectionRange {
  start: number;
  end: number;
}

/** Ephemeral collaboration presence broadcast. */
export interface PresenceEnvelope {
  type: 'presence';
  pageId: UUID;
  userId: UUID;
  cursor?: CursorPosition;
  activeBlockId?: UUID;
  selectedRange?: SelectionRange;
  lastActiveTime?: Timestamp;
}

/** Coarse JSONB patch of the fields that changed on a record. */
export type RecordPatch = Record<string, unknown>;

/** Server -> client: a subscribed record was mutated. */
export interface RecordUpdatedEnvelope {
  type: 'record_updated';
  table: OperationTable;
  id: UUID;
  version: number;
  patch: RecordPatch;
  spaceId?: UUID;
  lastEditedTime?: Timestamp;
  lastEditedById?: UUID;
}

/** Server -> client: subscription acknowledgement. */
export interface SubscriptionAckEnvelope {
  type: 'subscribed';
  subscriptions: SubscriptionTarget[];
}

/** Server -> client: recoverable gateway error. */
export interface SocketErrorEnvelope {
  type: 'error';
  code: string;
  message: string;
}

/** Server -> client: periodic heartbeat. */
export interface HeartbeatEnvelope {
  type: 'heartbeat';
  timestamp: Timestamp;
}

/** Every envelope a client may send to the gateway. */
export type ClientSocketMessage =
  | SubscribeEnvelope
  | UnsubscribeEnvelope
  | PresenceEnvelope;

/** Every envelope the gateway may send to a client. */
export type ServerSocketMessage =
  | SubscriptionAckEnvelope
  | PresenceEnvelope
  | RecordUpdatedEnvelope
  | SocketErrorEnvelope
  | HeartbeatEnvelope;

/** Every websocket envelope on the wire. */
export type SocketEnvelope = ClientSocketMessage | ServerSocketMessage;

/** Narrows an envelope to a {@link RecordUpdatedEnvelope}. */
export function isRecordUpdatedEnvelope(
  message: SocketEnvelope,
): message is RecordUpdatedEnvelope {
  return 'type' in message && message.type === 'record_updated';
}

/** Narrows an envelope to a {@link PresenceEnvelope}. */
export function isPresenceEnvelope(
  message: SocketEnvelope,
): message is PresenceEnvelope {
  return 'type' in message && message.type === 'presence';
}

/** Narrows an envelope to a {@link SubscribeEnvelope}. */
export function isSubscribeEnvelope(
  message: SocketEnvelope,
): message is SubscribeEnvelope {
  return 'action' in message && message.action === 'subscribe';
}

/** Human-readable error text of a socket error envelope. */
export function formatSocketError(message: SocketErrorEnvelope): string {
  return `${message.code}: ${message.message}`;
}
