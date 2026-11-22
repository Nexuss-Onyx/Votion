/**
 * `/v1/api-keys` — management of internal integration tokens.
 *
 * Requires the `manage` capability. The plaintext token is returned exactly
 * once, at creation time; afterwards only the safe prefix is exposed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { z } from 'zod';

import { capabilityGuard } from './auth.js';
import {
  apiTokenPrefix,
  generateApiToken,
  hashApiToken,
} from './auth.js';
import { parseBody, requireWorkspaceId, sendNotFound, sendUnauthorized } from './helpers.js';
import type { ApiKeyRecord } from '../../store/types.js';

interface IdParams {
  id: string;
}

const createApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(255),
  capabilities: z
    .array(z.enum(['read', 'write', 'manage', 'webhooks', 'automations']))
    .min(1)
    .max(10)
    .optional(),
  /** ISO-8601 expiry; omit for a token that never expires. */
  expires_at: z.string().datetime().optional(),
});

function toApiKeyResponse(record: ApiKeyRecord, secret?: string): Record<string, unknown> {
  return {
    object: 'api_key',
    id: record.id,
    name: record.name,
    token_prefix: record.tokenPrefix,
    capabilities: record.capabilities,
    last_used_at: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    expires_at: record.expiresAt ? record.expiresAt.toISOString() : null,
    revoked_at: record.revokedAt ? record.revokedAt.toISOString() : null,
    created_time: record.createdAt.toISOString(),
    ...(secret ? { secret } : {}),
  };
}

export async function apiKeyRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const manage = capabilityGuard('manage');

  fastify.post(
    '/api-keys',
    { preHandler: manage },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, createApiKeyRequestSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const token = generateApiToken();
      const record = await fastify.store.createApiKey({
        workspaceId,
        name: parsed.data.name,
        tokenHash: hashApiToken(token),
        tokenPrefix: apiTokenPrefix(token),
        capabilities: parsed.data.capabilities ?? ['read', 'write'],
        expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
      });
      return reply.code(201).send(toApiKeyResponse(record, token));
    },
  );

  fastify.get(
    '/api-keys',
    { preHandler: read },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const keys = await fastify.store.listApiKeys(workspaceId);
      return reply.send({
        object: 'list',
        results: keys.map((entry) => toApiKeyResponse(entry)),
        next_cursor: null,
        has_more: false,
        type: 'api_key',
        api_key: {},
      });
    },
  );

  fastify.delete<{ Params: IdParams }>(
    '/api-keys/:id',
    { preHandler: manage },
    async (request, reply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const key = await fastify.store.listApiKeys(workspaceId);
      const target = key.find((entry) => entry.id === request.params.id);
      if (!target) {
        return sendNotFound(reply, 'API key not found.');
      }
      const revoked = await fastify.store.revokeApiKey(target.id, workspaceId);
      if (!revoked) {
        return sendNotFound(reply, 'API key not found.');
      }
      return reply.send(toApiKeyResponse({ ...target, revokedAt: new Date() }));
    },
  );
}
