/**
 * Phase 11 — webhook signature & dispatcher tests.
 *
 * Exercises HMAC-SHA256 signature computation/verification, exponential
 * retry backoff, event filtering, delivery persistence, and the end-to-end
 * `/v1` mutation → signed POST flow against a local HTTP endpoint.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { randomUUID } from 'node:crypto';

import { WebhookDispatcher } from '../src/api/v1/webhooks/dispatcher.js';
import {
  signPayload,
  verifyWebhookSignature,
} from '../src/api/v1/webhooks/signature.js';
import { InMemoryStore } from '../src/store/memory.js';
import { registerUser } from './helpers.js';
import { authHeaders, createIntegration, makeV1App } from './v1-helpers.js';

const apps: FastifyInstance[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

interface CapturedRequest {
  method: string;
  headers: IncomingMessage['headers'];
  body: string;
}

async function startEndpoint(
  handler: (request: CapturedRequest, response: ServerResponse, call: number) => void,
): Promise<{ url: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? '',
        headers: req.headers,
        body: raw,
      };
      requests.push(captured);
      handler(captured, res, requests.length);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, requests };
}

describe('webhook HMAC signatures', () => {
  it('signs payloads deterministically and verifies them in constant time', () => {
    const secret = 'whsec_super_secret';
    const payload = JSON.stringify({ event: 'page.updated', data: { id: 'abc' } });
    const signature = signPayload(payload, secret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(payload, secret, signature)).toBe(true);
    expect(verifyWebhookSignature(payload, secret, `sha256=${signature}`)).toBe(true);
  });

  it('rejects tampered payloads and wrong secrets', () => {
    const secret = 'whsec_super_secret';
    const payload = JSON.stringify({ event: 'page.updated', data: { id: 'abc' } });
    const signature = signPayload(payload, secret);
    expect(verifyWebhookSignature(payload.replace('abc', 'abd'), secret, signature)).toBe(false);
    expect(verifyWebhookSignature(payload, 'whsec_wrong', signature)).toBe(false);
    expect(verifyWebhookSignature(payload, secret, '')).toBe(false);
  });
});

describe('webhook dispatcher', () => {
  it('retries with backoff and records the delivery', async () => {
    const store = new InMemoryStore();
    const spaceId = randomUUID();
    const secret = 'whsec_retry';
    const subscription = await store.createWebhookSubscription({
      workspaceId: spaceId,
      url: 'http://127.0.0.1:1/hook',
      secret,
      events: ['page.updated'],
    });
    const sleeps: number[] = [];
    const dispatcher = new WebhookDispatcher(store, {
      initialDelayMs: 5,
      maxDelayMs: 20,
      maxRetries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const { url, requests } = await startEndpoint((_request, response, call) => {
      if (call < 3) {
        response.writeHead(500).end('nope');
      } else {
        response.writeHead(200).end('ok');
      }
    });
    const target = { ...subscription, url };

    const result = await dispatcher.dispatchTo(target, 'page.updated', { id: 'row-1' });
    expect(result.attempts).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([5, 10]);

    const expected = signPayload(result.body, secret);
    expect(result.signature).toBe(expected);
    for (const request of requests) {
      expect(request.headers['x-votion-signature']).toBe(expected);
      expect(request.headers['x-votion-event']).toBe('page.updated');
      expect(request.headers['content-type']).toBe('application/json');
    }
    const payload = JSON.parse(requests[0]?.body ?? '{}') as {
      event: string;
      data: unknown;
      timestamp: string;
    };
    expect(payload.event).toBe('page.updated');
    expect(payload.data).toEqual({ id: 'row-1' });
    expect(typeof payload.timestamp).toBe('string');

    const deliveries = await store.listWebhookDeliveries(subscription.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.attempts).toBe(3);
    expect(deliveries[0]?.responseStatus).toBe(200);
    expect(deliveries[0]?.signature).toBe(expected);
  });

  it('gives up after the configured retry budget', async () => {
    const store = new InMemoryStore();
    const spaceId = randomUUID();
    const { url } = await startEndpoint((_request, response) => {
      response.writeHead(503).end('unavailable');
    });
    const subscription = await store.createWebhookSubscription({
      workspaceId: spaceId,
      url,
      secret: 'whsec_exhaust',
      events: ['page.created'],
    });
    const dispatcher = new WebhookDispatcher(store, {
      maxRetries: 2,
      initialDelayMs: 1,
      maxDelayMs: 2,
      sleep: async () => undefined,
    });
    const result = await dispatcher.dispatchTo(subscription, 'page.created', { id: 'x' });
    expect(result.attempts).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
    const deliveries = await store.listWebhookDeliveries(subscription.id);
    expect(deliveries[0]?.attempts).toBe(3);
    expect(deliveries[0]?.responseStatus).toBe(503);
  });

  it('only notifies subscriptions matching the event', async () => {
    const store = new InMemoryStore();
    const spaceId = randomUUID();
    const first = await startEndpoint((_request, response) => response.writeHead(200).end('ok'));
    const second = await startEndpoint((_request, response) => response.writeHead(200).end('ok'));
    await store.createWebhookSubscription({
      workspaceId: spaceId,
      url: first.url,
      secret: 'whsec_a',
      events: ['page.created'],
    });
    await store.createWebhookSubscription({
      workspaceId: spaceId,
      url: second.url,
      secret: 'whsec_b',
      events: ['page.updated'],
    });
    const dispatcher = new WebhookDispatcher(store, { sleep: async () => undefined });
    const results = await dispatcher.dispatch(spaceId, 'page.created', { id: 'x' });
    expect(results).toHaveLength(1);
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(0);
  });
});

describe('v1 webhook end-to-end', () => {
  it('dispatches a signed page.created webhook on POST /v1/pages', async () => {
    const store = new InMemoryStore();
    const app = await makeV1App(store);
    apps.push(app);
    const { body: user } = await registerUser(app);
    const key = await createIntegration(store, user.workspace.id);

    const { url, requests } = await startEndpoint((_request, response) =>
      response.writeHead(200).end('ok'),
    );
    const subscribed = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: authHeaders(key.token),
      payload: { url, events: ['page.created'] },
    });
    expect(subscribed.statusCode).toBe(201);
    const subscription = subscribed.json() as { id: string; secret: string };

    const created = await app.inject({
      method: 'POST',
      url: '/v1/pages',
      headers: authHeaders(key.token),
      payload: { parent: { workspace: true }, properties: { title: { title: [{ text: { content: 'Hooked' } }] } } },
    });
    expect(created.statusCode).toBe(200);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.headers['x-votion-event']).toBe('page.created');
    const expected = signPayload(request?.body ?? '', subscription.secret);
    expect(request?.headers['x-votion-signature']).toBe(expected);
    const payload = JSON.parse(request?.body ?? '{}') as { event: string; data: { object: string } };
    expect(payload.event).toBe('page.created');
    expect(payload.data.object).toBe('page');

    const deliveries = await app.inject({
      method: 'GET',
      url: `/v1/webhooks/${subscription.id}/deliveries`,
      headers: authHeaders(key.token),
    });
    expect(deliveries.statusCode).toBe(200);
    expect((deliveries.json() as { results: unknown[] }).results).toHaveLength(1);
  });
});
