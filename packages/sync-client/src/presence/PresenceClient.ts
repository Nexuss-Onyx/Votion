/**
 * Ephemeral multi-cursor presence.
 *
 * Presence is the one class of data Votion never persists. Cursor coordinates,
 * the focused block and the text selection are throttled to at most 20 Hz,
 * coalesced to the *latest* value (only the newest pointer position matters —
 * intermediate samples are dropped, not queued), and broadcast over the realtime
 * gateway. Peer state lives in a local map with a TTL so a closed tab's cursor
 * disappears without waiting for a `leave` frame.
 *
 * ```ts
 * const presence = new PresenceClient({ pageId, userId, send: (m) => socket.send(m) });
 * presence.setCursor({ x: 320, y: 485 });   // throttled to 20 Hz
 * presence.setActiveBlock(blockId, { start: 0, end: 14 });
 * presence.getPeers();                     // live peers, current user excluded
 * ```
 */

import type {
  CursorPosition,
  PresenceEnvelope,
  SelectionRange,
  Timestamp,
  UUID,
} from '@votion/types';

/** Transport used to broadcast presence envelopes. */
export type PresenceSender = (message: PresenceEnvelope) => void;

/** Options accepted by {@link PresenceClient}. */
export interface PresenceClientOptions {
  /** Page the user is viewing. */
  pageId: UUID;
  /** Signed-in user id (their emails are never broadcast). */
  userId: UUID;
  /** Broadcast transport (usually `socket.send`). */
  send?: PresenceSender;
  /** Maximum emissions per second (defaults to 20 Hz per the spec). */
  maxHz?: number;
  /** Peer expiry window in milliseconds (defaults to 10 s, matching the Redis TTL). */
  peerTtlMs?: number;
  /** Clock (injectable for deterministic tests). */
  now?: () => number;
  /** Scheduler used for throttling (injectable for fake timers). */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/** Local ephemeral state broadcast for the signed-in user. */
export interface LocalPresence {
  pageId: UUID;
  userId: UUID;
  cursor?: CursorPosition;
  activeBlockId?: UUID;
  selectedRange?: SelectionRange;
  lastActiveTime: Timestamp;
}

/** Peer presence as observed locally, including arrival metadata. */
export interface PeerPresence extends PresenceEnvelope {
  /** Local receive timestamp (epoch ms). */
  receivedAt: Timestamp;
}

/** Presence payload accepted from the user, before throttling. */
export interface PresenceOptions {
  /** Broadcast immediately, bypassing the throttle (used for focus changes). */
  immediate?: boolean;
}

/**
 * Throttles and broadcasts local presence while tracking peers.
 *
 * The throttle is *leading-edge + trailing-coalesce*: the first movement of a
 * gesture emits instantly (so the remote cursor jumps without lag), subsequent
 * movement inside the window is collapsed into one trailing emission carrying
 * the newest coordinates. That is 20 Hz of traffic at most, with no visible
 * stutter and no queue growth.
 */
export class PresenceClient {
  private readonly intervalMs: number;
  private readonly peerTtlMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private local: LocalPresence;
  private sender?: PresenceSender;
  private peers = new Map<UUID, PeerPresence>();
  private lastSentAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  /** True when a trailing (coalesced) emission is armed. */
  private pendingDirty = false;
  private pendingImmediate = false;
  private destroyed = false;
  private sendCount = 0;

  constructor(options: PresenceClientOptions) {
    this.local = {
      pageId: options.pageId,
      userId: options.userId,
      lastActiveTime: 0,
    };
    this.sender = options.send;
    const maxHz = Math.max(1, options.maxHz ?? 20);
    this.intervalMs = Math.ceil(1000 / maxHz);
    this.peerTtlMs = options.peerTtlMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    // Seed the throttle window in the past so the very first movement is always
    // a leading-edge emission (otherwise a client created at t=0 would swallow
    // the first sample into the throttle window).
    this.lastSentAt = this.now() - this.intervalMs;
    this.local.lastActiveTime = this.now();
  }

  /** Page this client reports presence for. */
  get pageId(): UUID {
    return this.local.pageId;
  }

  /** Signed-in user id. */
  get userId(): UUID {
    return this.local.userId;
  }

  /** Local presence snapshot (what peers will see). */
  get localState(): LocalPresence {
    return { ...this.local };
  }

  /** Number of envelopes emitted through the sender. */
  get emittedCount(): number {
    return this.sendCount;
  }

  /** True while a trailing emission is scheduled. */
  get hasPendingEmission(): boolean {
    return this.pendingTimer !== undefined;
  }

  /** Number of live (non-expired) peers. */
  get peerCount(): number {
    return this.getPeers().length;
  }

  /** Replaces the broadcast transport (e.g. after a socket reconnect). */
  setSender(send: PresenceSender | undefined): void {
    this.sender = send;
  }

  /** Updates the pointer position; throttled to `maxHz`. */
  setCursor(cursor: CursorPosition, options: PresenceOptions = {}): void {
    this.local = { ...this.local, cursor, lastActiveTime: this.now() };
    this.emit(options);
  }

  /** Updates the focused block and (optionally) the inline selection range. */
  setActiveBlock(
    activeBlockId: UUID | undefined,
    selectedRange?: SelectionRange,
    options: PresenceOptions = {},
  ): void {
    this.local = {
      ...this.local,
      activeBlockId,
      ...(selectedRange === undefined
        ? { selectedRange: undefined }
        : { selectedRange }),
      lastActiveTime: this.now(),
    };
    this.emit({ immediate: options.immediate ?? true });
  }

  /** Updates only the text selection range of the active block. */
  setSelection(
    selectedRange: SelectionRange | undefined,
    options: PresenceOptions = {},
  ): void {
    this.local = { ...this.local, selectedRange, lastActiveTime: this.now() };
    this.emit(options);
  }

  /** Announces departure so peers can drop this cursor immediately. */
  leave(): void {
    this.flushPending(false);
    if (this.sender) {
      this.sender(this.toEnvelope());
    }
    this.destroy();
  }

  /** Handles an inbound presence envelope from a peer. */
  receive(envelope: PresenceEnvelope): PeerPresence | undefined {
    if (envelope.userId === this.local.userId) {
      return undefined;
    }
    if (envelope.pageId !== this.local.pageId) {
      return undefined;
    }
    const peer: PeerPresence = { ...envelope, receivedAt: this.now() };
    this.peers.set(envelope.userId, peer);
    return peer;
  }

  /** Returns every non-expired peer, newest activity first. */
  getPeers(): PeerPresence[] {
    const cutoff = this.now() - this.peerTtlMs;
    for (const [userId, peer] of this.peers) {
      const lastSeen = peer.lastActiveTime ?? peer.receivedAt;
      if (Math.max(lastSeen, peer.receivedAt) < cutoff) {
        this.peers.delete(userId);
      }
    }
    return [...this.peers.values()].sort(
      (a, b) =>
        (b.lastActiveTime ?? b.receivedAt) - (a.lastActiveTime ?? a.receivedAt),
    );
  }

  /** Returns one peer's presence, or `undefined` when absent/expired. */
  getPeer(userId: UUID): PeerPresence | undefined {
    return this.getPeers().find((peer) => peer.userId === userId);
  }

  /** Removes a peer explicitly (a `leave` frame or a socket close). */
  removePeer(userId: UUID): boolean {
    return this.peers.delete(userId);
  }

  /** Drops every peer record (page change / reconnect). */
  clearPeers(): void {
    this.peers.clear();
  }

  /** Builds the envelope for the current local state. */
  toEnvelope(): PresenceEnvelope {
    const envelope: PresenceEnvelope = {
      type: 'presence',
      pageId: this.local.pageId,
      userId: this.local.userId,
      lastActiveTime: this.local.lastActiveTime,
    };
    if (this.local.cursor) {
      envelope.cursor = { ...this.local.cursor };
    }
    if (this.local.activeBlockId) {
      envelope.activeBlockId = this.local.activeBlockId;
    }
    if (this.local.selectedRange) {
      envelope.selectedRange = { ...this.local.selectedRange };
    }
    return envelope;
  }

  /** Cancels timers and clears peers. */
  destroy(): void {
    this.destroyed = true;
    if (this.pendingTimer) {
      this.clearTimeoutFn(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    this.pendingDirty = false;
    this.pendingImmediate = false;
    this.peers.clear();
  }

  /** Emits now, or schedules a coalesced trailing emission. */
  private emit(options: PresenceOptions): void {
    if (this.destroyed) {
      return;
    }
    const now = this.now();
    const elapsed = now - this.lastSentAt;
    const immediate = options.immediate ?? false;

    if (immediate || elapsed >= this.intervalMs) {
      this.flushPending(false);
      this.dispatch(now);
      return;
    }

    this.pendingDirty = true;
    this.pendingImmediate = this.pendingImmediate || immediate;
    if (this.pendingTimer) {
      // Already waiting: the trailing emission reads `this.local`, so the newest
      // coordinates automatically replace the ones that were about to be sent.
      return;
    }
    const delay = Math.max(0, this.intervalMs - elapsed);
    this.pendingTimer = this.setTimeoutFn(() => {
      this.pendingTimer = undefined;
      this.flushPending(true);
    }, delay);
  }

  /** Sends (or discards) the coalesced trailing emission. */
  private flushPending(send: boolean): void {
    if (this.pendingTimer) {
      this.clearTimeoutFn(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    const hadPending = this.pendingDirty;
    this.pendingDirty = false;
    this.pendingImmediate = false;
    if (send && hadPending) {
      this.dispatch(this.now());
    }
  }

  /** Hands one envelope to the transport and records emission time. */
  private dispatch(now: number): void {
    this.lastSentAt = now;
    this.sendCount += 1;
    this.sender?.(this.toEnvelope());
  }
}

/** Convenience factory. */
export function createPresenceClient(
  options: PresenceClientOptions,
): PresenceClient {
  return new PresenceClient(options);
}
