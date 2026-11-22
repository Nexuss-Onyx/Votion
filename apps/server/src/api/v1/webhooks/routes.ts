/**
 * `/v1/webhooks` — webhook subscription management.
 *
 * Notion has no public webhook API, so these endpoints follow the same
 * envelope conventions as the rest of the Developer API.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { capabilityGuard } from '../auth.js';
import { createWebhookSchema } from '../schemas.js';
import {
  parseBody,
  requireWorkspaceId,
  sendNotFound,
  sendUnauthorized,
} from '../helpers.js';
import { sendNotionError } from '../errors.js';

interface IdParams {
  id: string;
}

function toWebhookResponse(subscription: {
  id: string;
  url: string;
  events: string[];
  alive: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}, secret?: string): Record<string, unknown> {
  return {
    object: 'webhook',
    id: subscription.id,
    url: subscription.url,
    events: subscription.events,
    alive: subscription.alive,
    created_by: { object: 'user', id: subscription.createdById ?? '' },
    created_time: subscription.createdAt.toISOString(),
    last_updated_time: subscription.updatedAt.toISOString(),
    ...(secret ? { secret } : {}),
  };
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const manage = capabilityGuard('webhooks');

  fastify.post(
    '/webhooks',
    { preHandler: manage },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, createWebhookSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const secret = randomBytes(32).toString('hex');
      const subscription = await fastify.store.createWebhookSubscription({
        workspaceId,
        url: parsed.data.url,
        secret,
        events: parsed.data.events ?? ['page.created', 'page.updated', 'page.deleted'],
      });
      return reply.code(201).send(toWebhookResponse(subscription, secret));
    },
  );

  fastify.get(
    '/webhooks',
    { preHandler: read },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const subscriptions = await fastify.store.listWebhookSubscriptions(workspaceId);
      return reply.send({
        object: 'list',
        results: subscriptions.map((entry) => toWebhookResponse(entry)),
        next_cursor: null,
        has_more: false,
        type: 'webhook',
        webhook: {},
      });
    },
  );

  fastify.get<{ Params: IdParams }>(
    '/webhooks/:id',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const subscription = await fastify.store.findWebhookSubscriptionById(request.params.id);
      if (!subscription || subscription.workspaceId !== workspaceId) {
        return sendNotFound(reply, 'Webhook not found.');
      }
      return reply.send(toWebhookResponse(subscription));
    },
  );

  fastify.get<{ Params: IdParams }>(
    '/webhooks/:id/deliveries',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const subscription = await fastify.store.findWebhookSubscriptionById(request.params.id);
      if (!subscription || subscription.workspaceId !== workspaceId) {
        return sendNotFound(reply, 'Webhook not found.');
      }
      const deliveries = await fastify.store.listWebhookDeliveries(subscription.id);
      return reply.send({
        object: 'list',
        results: deliveries.map((entry) => ({
          object: 'webhook_delivery',
          id: entry.id,
          event: entry.event,
          signature: entry.signature,
          attempts: entry.attempts,
          response_status: entry.responseStatus,
          error: entry.error,
          created_time: entry.createdAt.toISOString(),
        })),
        next_cursor: null,
        has_more: false,
        type: 'webhook_delivery',
        webhook_delivery: {},
      });
    },
  );

  fastify.delete<{ Params: IdParams }>(
    '/webhooks/:id',
    { preHandler: manage },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const subscription = await fastify.store.findWebhookSubscriptionById(request.params.id);
      if (!subscription || subscription.workspaceId !== workspaceId) {
        return sendNotFound(reply, 'Webhook not found.');
      }
      const deleted = await fastify.store.deleteWebhookSubscription(subscription.id, workspaceId);
      if (!deleted) {
        return sendNotionError(reply, 400, 'invalid_request', 'Webhook already deleted.');
      }
      return reply.send(toWebhookResponse({ ...subscription, alive: false }));
    },
  );
}
