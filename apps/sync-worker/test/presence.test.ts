/**
 * V-04 — ephemeral presence engine.
 *
 * Covers the cursor/focus relay between peers, the userId merge from the
 * authenticated socket (client-sent ids are ignored), the 10s Redis TTL on
 * presence keys, TTL expiry, and leave notifications on disconnect.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  connectClient,
  receivesMessage,
  signToken,
  startRig,
  waitForMessage,
  type TestRig,
} from './helpers.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('ephemeral presence', () => {
  let rig: TestRig | null = null;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      try {
        client.terminate();
      } catch {
        // already closed
      }
    }
    if (rig) {
      await rig.close();
      rig = null;
    }
  });

  async function connectAs(userId: string, spaceIds: string[] = ['space-1']): Promise<WebSocket> {
    if (!rig) throw new Error('rig not started');
    const token = signToken({ sub: userId, spaceIds });
    const client = await connectClient(rig.port, { token });
    clients.push(client);
    return client;
  }

  /** Subscribes a client to the `page:<pageId>` room (via its block record). */
  async function subscribeToPage(client: WebSocket, pageId: string): Promise<void> {
    client.send(
      JSON.stringify({ action: 'subscribe', subscriptions: [{ table: 'block', id: pageId }] }),
    );
    await waitForMessage(client, (message) => message.type === 'subscribed');
  }

  it('relays a presence frame to peers on the same page with the socket userId', async () => {
    rig = await startRig();
    const alice = await connectAs('user-a');
    const bob = await connectAs('user-b');
    await subscribeToPage(bob, 'page-1');

    const incoming = waitForMessage(bob, (message) => message.type === 'presence');
    alice.send(
      JSON.stringify({
        type: 'presence',
        pageId: 'page-1',
        // A spoofed userId must be ignored in favour of the JWT subject.
        userId: 'mallory',
        cursor: { x: 320, y: 485 },
        activeBlockId: 'block-5',
      }),
    );
    const message = await incoming;

    expect(message.pageId).toBe('page-1');
    expect(message.userId).toBe('user-a');
    expect(message.action).toBe('join');
    expect(message.cursor).toEqual({ x: 320, y: 485 });
    expect(message.activeBlockId).toBe('block-5');
    expect(typeof message.lastActiveTime).toBe('number');

    // The sender does not receive its own presence back.
    const echoed = await receivesMessage(
      alice,
      (m) => m.type === 'presence' && m.userId === 'user-a',
      300,
    );
    expect(echoed).toBe(false);
  });

  it('stores presence in Redis with a 10 second TTL', async () => {
    rig = await startRig();
    const alice = await connectAs('user-ttl');

    alice.send(
      JSON.stringify({
        type: 'presence',
        pageId: 'page-ttl',
        cursor: { x: 1, y: 2 },
      }),
    );

    // Wait until the relay has been processed server-side.
    let raw: string | null = null;
    for (let attempt = 0; attempt < 20 && raw === null; attempt += 1) {
      await sleep(50);
      raw = await rig.commandRedis.get('presence:page-ttl:user-ttl');
    }
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string);
    expect(stored.userId).toBe('user-ttl');
    expect(stored.pageId).toBe('page-ttl');

    const ttl = await rig.commandRedis.ttl('presence:page-ttl:user-ttl');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });

  it('emits join then move actions for successive frames', async () => {
    rig = await startRig();
    const alice = await connectAs('user-move');
    const bob = await connectAs('user-move-peer');
    await subscribeToPage(bob, 'page-move');

    const first = waitForMessage(bob, (m) => m.type === 'presence');
    alice.send(
      JSON.stringify({ type: 'presence', pageId: 'page-move', cursor: { x: 1, y: 1 } }),
    );
    expect((await first).action).toBe('join');

    const second = waitForMessage(bob, (m) => m.type === 'presence');
    alice.send(
      JSON.stringify({ type: 'presence', pageId: 'page-move', cursor: { x: 50, y: 60 } }),
    );
    const move = await second;
    expect(move.action).toBe('move');
    expect(move.cursor).toEqual({ x: 50, y: 60 });
  });

  it('drops presence keys once the TTL elapses', async () => {
    rig = await startRig({ presenceTtlSeconds: 1 });
    const alice = await connectAs('user-expiry');

    alice.send(
      JSON.stringify({ type: 'presence', pageId: 'page-expiry', cursor: { x: 9, y: 9 } }),
    );
    await sleep(150);
    expect(await rig.commandRedis.get('presence:page-expiry:user-expiry')).not.toBeNull();

    await sleep(1200);
    expect(await rig.commandRedis.get('presence:page-expiry:user-expiry')).toBeNull();
  });

  it('emits a peer leave and removes the presence key when the client disconnects', async () => {
    rig = await startRig();
    const alice = await connectAs('user-leave');
    const bob = await connectAs('user-leave-peer');
    await subscribeToPage(bob, 'page-leave');

    // Alice joins the page.
    const aliceJoined = waitForMessage(
      bob,
      (m) => m.type === 'presence' && m.userId === 'user-leave',
    );
    alice.send(
      JSON.stringify({ type: 'presence', pageId: 'page-leave', cursor: { x: 0, y: 0 } }),
    );
    await aliceJoined;
    expect(await rig.commandRedis.get('presence:page-leave:user-leave')).not.toBeNull();

    const leave = waitForMessage(
      bob,
      (m) => m.type === 'presence' && m.action === 'leave' && m.userId === 'user-leave',
    );
    alice.close();
    clients.splice(clients.indexOf(alice), 1);
    const message = await leave;
    expect(message.pageId).toBe('page-leave');

    await sleep(100);
    expect(await rig.commandRedis.get('presence:page-leave:user-leave')).toBeNull();
  });
});
