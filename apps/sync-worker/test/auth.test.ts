/**
 * V-02 — connection handshake & JWT authentication.
 *
 * Unauthenticated connections must be rejected during the handshake and
 * connections carrying a valid JWT must be accepted and registered with the
 * gateway.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  TEST_JWT_SECRET,
  connectClient,
  connectExpectingRejection,
  signToken,
  startRig,
  waitForMessage,
  type TestRig,
} from './helpers.js';

describe('WebSocket gateway authentication handshake', () => {
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

  it('rejects connections without a token', async () => {
    rig = await startRig();
    const error = await connectExpectingRejection(rig.port);
    expect(error.message).toMatch(/401/);
  });

  it('rejects connections with an invalid signature', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-1' }, 'not-the-server-secret');
    const error = await connectExpectingRejection(rig.port, { token });
    expect(error.message).toMatch(/401/);
  });

  it('rejects expired tokens', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-1' }, TEST_JWT_SECRET, { expiresIn: '-1s' });
    const error = await connectExpectingRejection(rig.port, { token });
    expect(error.message).toMatch(/401/);
  });

  it('rejects tokens without a subject claim', async () => {
    rig = await startRig();
    const token = signToken({ sub: undefined, spaceIds: [] });
    const error = await connectExpectingRejection(rig.port, { token });
    expect(error.message).toMatch(/401/);
  });

  it('accepts a valid token passed as a query parameter', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-auth-query' });
    const client = await connectClient(rig.port, { token });
    clients.push(client);
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(rig.gateway.clientCount).toBe(1);
  });

  it('accepts a valid token passed as an Authorization header', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-auth-header' });
    const client = await connectClient(rig.port, { token, useAuthorizationHeader: true });
    clients.push(client);
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(rig.gateway.clientCount).toBe(1);
  });

  it('acks subscriptions for authorized spaces after the handshake', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-auth-ack', spaceIds: ['space-1'] });
    const client = await connectClient(rig.port, { token });
    clients.push(client);
    client.send(
      JSON.stringify({ action: 'subscribe', subscriptions: [{ table: 'space', id: 'space-1' }] }),
    );
    const ack = await waitForMessage(client, (message) => message.type === 'subscribed');
    expect(ack.subscriptions).toEqual([{ table: 'space', id: 'space-1' }]);
  });

  it('refuses subscriptions to spaces outside the token allow-list', async () => {
    rig = await startRig();
    const token = signToken({ sub: 'user-auth-forbidden', spaceIds: ['space-1'] });
    const client = await connectClient(rig.port, { token });
    clients.push(client);
    client.send(
      JSON.stringify({ action: 'subscribe', subscriptions: [{ table: 'space', id: 'space-2' }] }),
    );
    const error = await waitForMessage(client, (message) => message.type === 'error');
    expect(error.code).toBe('forbidden_space');
  });
});
