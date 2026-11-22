/**
 * V-03 — Redis pub/sub bridge.
 *
 * A `record_updated` event published to `space:<space_id>:events` must be
 * relayed to every client subscribed to the `space:<space_id>` room, with
 * end-to-end fan-out latency well under the 100ms budget.
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

describe('Redis pub/sub bridge', () => {
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

  async function subscribedSpaceClient(spaceId: string, userId: string): Promise<WebSocket> {
    if (!rig) throw new Error('rig not started');
    const token = signToken({ sub: userId, spaceIds: [spaceId] });
    const client = await connectClient(rig.port, { token });
    clients.push(client);
    client.send(
      JSON.stringify({ action: 'subscribe', subscriptions: [{ table: 'space', id: spaceId }] }),
    );
    await waitForMessage(client, (message) => message.type === 'subscribed');
    return client;
  }

  it('delivers a record_updated event to subscribed room clients', async () => {
    rig = await startRig();
    const client = await subscribedSpaceClient('space-1', 'user-pubsub');

    const incoming = waitForMessage(client, (message) => message.type === 'record_updated');
    const publishedAt = Date.now();
    await rig.commandRedis.publish(
      'space:space-1:events',
      JSON.stringify({
        type: 'record_updated',
        table: 'block',
        id: 'block-42',
        version: 43,
        patch: { properties: { title: [['Updated Document Title']] } },
        lastEditedTime: 1_716_300_050_000,
        lastEditedById: 'user-9',
      }),
    );
    const message = await incoming;
    const latencyMs = Date.now() - publishedAt;

    expect(message.table).toBe('block');
    expect(message.id).toBe('block-42');
    expect(message.version).toBe(43);
    expect(message.spaceId).toBe('space-1');
    expect(message.patch).toEqual({ properties: { title: [['Updated Document Title']] } });
    expect(message.lastEditedById).toBe('user-9');
    expect(latencyMs).toBeLessThan(100);
  });

  it('does not leak events into other space rooms', async () => {
    rig = await startRig();
    const client = await subscribedSpaceClient('space-1', 'user-pubsub-isolated');

    await rig.commandRedis.publish(
      'space:space-2:events',
      JSON.stringify({
        type: 'record_updated',
        table: 'block',
        id: 'block-99',
        version: 1,
        patch: {},
      }),
    );

    const received = await receivesMessage(
      client,
      (message) => message.type === 'record_updated',
      400,
    );
    expect(received).toBe(false);
  });

  it('drops malformed pub/sub payloads without disconnecting clients', async () => {
    rig = await startRig();
    const client = await subscribedSpaceClient('space-1', 'user-pubsub-robust');

    await rig.commandRedis.publish('space:space-1:events', 'this is not json');
    await rig.commandRedis.publish(
      'space:space-1:events',
      JSON.stringify({ type: 'record_updated', table: 'not_a_table', id: 'x', version: 1 }),
    );

    // The socket must still be usable afterwards.
    client.send(
      JSON.stringify({ action: 'subscribe', subscriptions: [{ table: 'space', id: 'space-1' }] }),
    );
    const ack = await waitForMessage(client, (message) => message.type === 'subscribed');
    expect(ack.subscriptions).toEqual([{ table: 'space', id: 'space-1' }]);
  });

  it('tracks room membership as clients subscribe and disconnect', async () => {
    rig = await startRig();
    expect(rig.rooms.roomSize('space:space-1')).toBe(0);
    const client = await subscribedSpaceClient('space-1', 'user-pubsub-rooms');
    expect(rig.rooms.roomSize('space:space-1')).toBe(1);
    client.terminate();
    clients.splice(clients.indexOf(client), 1);
    // Give the server a tick to process the close event.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rig.rooms.roomSize('space:space-1')).toBe(0);
  });
});
