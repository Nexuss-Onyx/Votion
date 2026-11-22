/**
 * PresenceClient: 20 Hz throttling, coalescing and ephemeral peer state.
 *
 * Timing is driven by injected clock/scheduler fakes so the throttle window is
 * asserted deterministically (no real timers, no flaky sleeps).
 */

import { describe, expect, it, vi } from 'vitest';
import type { PresenceEnvelope } from '@votion/types';

import { PresenceClient, createPresenceClient } from '../src/index.js';
import { PAGE_ID, USER_ID, id } from './factories.js';

const PEER_ID = id(7777);
const OTHER_PAGE = id(7778);

/** Deterministic clock + timer harness. */
function createHarness() {
  let clock = 0;
  const timers: { id: number; at: number; callback: () => void }[] = [];
  let nextTimerId = 1;

  const setTimeoutFn = ((callback: () => void, delay = 0) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.push({ id: timerId, at: clock + delay, callback });
    return timerId as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  const clearTimeoutFn = ((timerId: ReturnType<typeof setTimeout>) => {
    const index = timers.findIndex(
      (timer) => timer.id === (timerId as unknown as number),
    );
    if (index >= 0) {
      timers.splice(index, 1);
    }
  }) as unknown as typeof clearTimeout;

  return {
    now: () => clock,
    setTimeoutFn,
    clearTimeoutFn,
    advance(ms: number) {
      clock += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= clock) {
          const index = timers.indexOf(timer);
          if (index >= 0) {
            timers.splice(index, 1);
          }
          timer.callback();
        }
      }
    },
    get pendingTimers() {
      return timers.length;
    },
  };
}

function createClient(harness: ReturnType<typeof createHarness>) {
  const sent: PresenceEnvelope[] = [];
  const client = new PresenceClient({
    pageId: PAGE_ID,
    userId: USER_ID,
    send: (message) => sent.push(message),
    now: harness.now,
    setTimeoutFn: harness.setTimeoutFn,
    clearTimeoutFn: harness.clearTimeoutFn,
  });
  return { client, sent };
}

describe('PresenceClient — emission', () => {
  it('emits the first cursor position immediately (leading edge)', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 1, y: 2 });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'presence',
      pageId: PAGE_ID,
      userId: USER_ID,
      cursor: { x: 1, y: 2 },
    });
  });

  it('throttles subsequent movement to 20 Hz', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    // 100 rapid moves inside one 50 ms window.
    for (let x = 0; x < 100; x += 1) {
      client.setCursor({ x, y: x });
      harness.advance(0);
    }
    expect(sent).toHaveLength(1);

    harness.advance(50);
    // Exactly one trailing emission carries the *latest* coordinates.
    expect(sent).toHaveLength(2);
    expect(sent[1]?.cursor).toEqual({ x: 99, y: 99 });
  });

  it('coalesces (never queues) intermediate samples', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 0, y: 0 });
    harness.advance(10);
    client.setCursor({ x: 10, y: 10 });
    harness.advance(10);
    client.setCursor({ x: 20, y: 20 });
    harness.advance(10);
    client.setCursor({ x: 30, y: 30 });
    harness.advance(1000);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.cursor).toEqual({ x: 30, y: 30 });
  });

  it('respects a custom maxHz', () => {
    const harness = createHarness();
    const sent: PresenceEnvelope[] = [];
    const client = new PresenceClient({
      pageId: PAGE_ID,
      userId: USER_ID,
      maxHz: 5,
      send: (message) => sent.push(message),
      now: harness.now,
      setTimeoutFn: harness.setTimeoutFn,
      clearTimeoutFn: harness.clearTimeoutFn,
    });

    client.setCursor({ x: 0, y: 0 });
    client.setCursor({ x: 1, y: 1 });
    harness.advance(199);
    expect(sent).toHaveLength(1);
    harness.advance(1);
    expect(sent).toHaveLength(2);
  });

  it('emits active block + selection immediately (bypasses throttle)', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 5, y: 5 });
    client.setActiveBlock('block-1', { start: 0, end: 14 });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      activeBlockId: 'block-1',
      selectedRange: { start: 0, end: 14 },
    });
  });

  it('omits absent fields from the envelope', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 1, y: 1 });
    expect(sent[0]).not.toHaveProperty('activeBlockId');
    expect(sent[0]).not.toHaveProperty('selectedRange');
    expect(sent[0]).toHaveProperty('lastActiveTime');
  });

  it('clears a selection when the block changes', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setActiveBlock('a', { start: 1, end: 2 });
    client.setActiveBlock('b');

    expect(sent[1]).toMatchObject({ activeBlockId: 'b' });
    expect(sent[1]).not.toHaveProperty('selectedRange');
  });

  it('counts emissions', () => {
    const harness = createHarness();
    const { client } = createClient(harness);
    client.setCursor({ x: 0, y: 0 });
    client.setActiveBlock('a');
    expect(client.emittedCount).toBe(2);
  });
});

describe('PresenceClient — peer tracking', () => {
  it('stores incoming peer presence', () => {
    const harness = createHarness();
    const { client } = createClient(harness);

    const peer = client.receive({
      type: 'presence',
      pageId: PAGE_ID,
      userId: PEER_ID,
      cursor: { x: 9, y: 9 },
      activeBlockId: 'block-2',
      lastActiveTime: harness.now(),
    });

    expect(peer?.userId).toBe(PEER_ID);
    expect(client.getPeer(PEER_ID)?.cursor).toEqual({ x: 9, y: 9 });
    expect(client.peerCount).toBe(1);
  });

  it('ignores its own presence echo and other pages', () => {
    const harness = createHarness();
    const { client } = createClient(harness);

    expect(
      client.receive({ type: 'presence', pageId: PAGE_ID, userId: USER_ID }),
    ).toBeUndefined();
    expect(
      client.receive({ type: 'presence', pageId: OTHER_PAGE, userId: PEER_ID }),
    ).toBeUndefined();
    expect(client.peerCount).toBe(0);
  });

  it('expires peers after the TTL (10 s default)', () => {
    const harness = createHarness();
    const { client } = createClient(harness);

    client.receive({
      type: 'presence',
      pageId: PAGE_ID,
      userId: PEER_ID,
      lastActiveTime: harness.now(),
    });
    expect(client.peerCount).toBe(1);

    harness.advance(9_999);
    expect(client.peerCount).toBe(1);

    harness.advance(2);
    expect(client.peerCount).toBe(0);
    expect(client.getPeer(PEER_ID)).toBeUndefined();
  });

  it('keeps a peer alive while it keeps moving', () => {
    const harness = createHarness();
    const { client } = createClient(harness);

    for (let index = 0; index < 5; index += 1) {
      client.receive({
        type: 'presence',
        pageId: PAGE_ID,
        userId: PEER_ID,
        cursor: { x: index, y: index },
        lastActiveTime: harness.now(),
      });
      harness.advance(5_000);
    }
    expect(client.peerCount).toBe(1);
    expect(client.getPeer(PEER_ID)?.cursor).toEqual({ x: 4, y: 4 });
  });

  it('sorts peers by most recent activity and supports removal', () => {
    const harness = createHarness();
    const { client } = createClient(harness);
    const quiet = id(7800);

    client.receive({
      type: 'presence',
      pageId: PAGE_ID,
      userId: quiet,
      lastActiveTime: harness.now(),
    });
    harness.advance(100);
    client.receive({
      type: 'presence',
      pageId: PAGE_ID,
      userId: PEER_ID,
      lastActiveTime: harness.now(),
    });

    expect(client.getPeers().map((peer) => peer.userId)).toEqual([
      PEER_ID,
      quiet,
    ]);
    expect(client.removePeer(PEER_ID)).toBe(true);
    expect(client.removePeer('ghost')).toBe(false);
    expect(client.peerCount).toBe(1);

    client.clearPeers();
    expect(client.peerCount).toBe(0);
  });
});

describe('PresenceClient — lifecycle', () => {
  it('leave() broadcasts a final envelope and cancels pending timers', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 0, y: 0 });
    client.setCursor({ x: 1, y: 1 }); // throttled -> pending timer
    expect(client.hasPendingEmission).toBe(true);

    client.leave();

    expect(sent).toHaveLength(2);
    expect(client.hasPendingEmission).toBe(false);
    expect(harness.pendingTimers).toBe(0);
  });

  it('destroy() stops further emissions', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);

    client.setCursor({ x: 0, y: 0 });
    client.destroy();
    client.setCursor({ x: 5, y: 5 });

    expect(sent).toHaveLength(1);
  });

  it('can swap its transport (socket reconnect)', () => {
    const harness = createHarness();
    const { client, sent } = createClient(harness);
    const second: PresenceEnvelope[] = [];

    client.setSender((message) => second.push(message));
    client.setActiveBlock('block-1');

    expect(sent).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it('works without a transport (headless / SSR)', () => {
    const client = createPresenceClient({ pageId: PAGE_ID, userId: USER_ID });
    expect(() => client.setCursor({ x: 1, y: 1 })).not.toThrow();
    expect(client.toEnvelope()).toMatchObject({
      type: 'presence',
      pageId: PAGE_ID,
      userId: USER_ID,
    });
    client.destroy();
  });

  it('real timers: 20 Hz throttle holds under a burst', async () => {
    const sent: PresenceEnvelope[] = [];
    const client = new PresenceClient({
      pageId: PAGE_ID,
      userId: USER_ID,
      send: (message) => sent.push(message),
    });

    const started = Date.now();
    for (let index = 0; index < 200; index += 1) {
      client.setCursor({ x: index, y: index });
    }
    await vi.waitFor(() => expect(sent.length).toBeLessThanOrEqual(2), {
      timeout: 1000,
    });
    const elapsed = Date.now() - started;

    // 200 synchronous moves must collapse to <= 2 emissions, not 200.
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(elapsed).toBeLessThan(500);
    client.destroy();
  });
});
