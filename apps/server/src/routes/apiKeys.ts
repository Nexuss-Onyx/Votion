/**
 * Internal (JWT-authenticated) API-key management for the web UI.
 *
 * Workspace owners/admins provision the first integration token here; after
 * that, tokens can be managed programmatically through `/v1/api-keys`.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { apiTokenPrefix, generateApiToken, hashApiToken } from '../api/v1/auth.js';

const capabilityEnum = z.enum([
  'read',
  'write',
  'manage',
  'webhooks',
  'automations',
]);

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  capabilities: z.array(capabilityEnum).min(1).max(10).optional(),
});

const deleteSchema = z.object({ workspaceId: z.string().uuid() });

function canManage(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export async function apiKeyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/api-keys',
    {
      preHandler: fastify.authenticate,
      config: {
        rateLimit: {
          max: fastify.config.API_KEY_RATE_LIMIT_MAX,
          timeWindow: fastify.config.RATE_LIMIT_WINDOW,
        },
      },
    },
    async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    const member = await fastify.store.findMember(parsed.data.workspaceId, request.userId);
    if (!member || !canManage(member.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const token = generateApiToken();
    const record = await fastify.store.createApiKey({
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      tokenHash: hashApiToken(token),
      tokenPrefix: apiTokenPrefix(token),
      capabilities: parsed.data.capabilities ?? ['read', 'write'],
      createdById: request.userId,
    });
    return reply.code(201).send({ record, token });
    },
  );

  fastify.get('/api/api-keys', { preHandler: fastify.authenticate }, async (request, reply) => {
    const workspaceId = (request.query as { workspaceId?: string }).workspaceId;
    if (!workspaceId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'workspaceId is required.' });
    }
    const member = await fastify.store.findMember(workspaceId, request.userId);
    if (!member) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const keys = await fastify.store.listApiKeys(workspaceId);
    return reply.send({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        tokenPrefix: key.tokenPrefix,
        capabilities: key.capabilities,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        createdAt: key.createdAt,
      })),
    });
  });

  fastify.delete(
    '/api/api-keys/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = deleteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      const member = await fastify.store.findMember(parsed.data.workspaceId, request.userId);
      if (!member || !canManage(member.role)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const revoked = await fastify.store.revokeApiKey(params.id, parsed.data.workspaceId);
      if (!revoked) {
        return reply.code(404).send({ error: 'Not Found', message: 'API key not found.' });
      }
      return reply.send({ ok: true });
    },
  );
}
