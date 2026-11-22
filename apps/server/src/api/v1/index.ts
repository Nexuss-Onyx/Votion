/**
 * Developer API (`/v1`) — a Notion-compatible REST surface.
 *
 * All routes require `Authorization: Bearer secret_...` and an optional
 * `Notion-Version` header (default `2022-06-28`).
 */

import type { FastifyInstance } from 'fastify';

import { apiKeyRoutes } from './apiKeys.js';
import { automationRoutes } from './automations/routes.js';
import { createApiKeyAuth } from './auth.js';
import { blockRoutes } from './blocks.js';
import { databaseRoutes } from './databases.js';
import { sendNotionError } from './errors.js';
import { pageRoutes } from './pages.js';
import { searchRoutes } from './search.js';
import { webhookRoutes } from './webhooks/routes.js';

/** Notion API version used when the client omits the header. */
export const DEFAULT_NOTION_VERSION = '2022-06-28';

/** Notion API versions this implementation is compatible with. */
export const SUPPORTED_NOTION_VERSIONS: readonly string[] = [
  '2022-06-28',
  '2022-02-22',
];

/** Registers every `/v1` resource under the plugin's prefix. */
export async function v1Routes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preValidation', async (request, reply) => {
    const raw = request.headers['notion-version'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (header !== undefined && !SUPPORTED_NOTION_VERSIONS.includes(header)) {
      await sendNotionError(
        reply,
        400,
        'invalid_request',
        `Unsupported Notion-Version "${header}". Use ${DEFAULT_NOTION_VERSION}.`,
      );
      return;
    }
    request.notionVersion = header ?? DEFAULT_NOTION_VERSION;
  });

  fastify.addHook('preHandler', createApiKeyAuth(fastify.store));

  await fastify.register(apiKeyRoutes);
  await fastify.register(blockRoutes);
  await fastify.register(pageRoutes);
  await fastify.register(databaseRoutes);
  await fastify.register(searchRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(automationRoutes);
}

export { DEFAULT_NOTION_VERSION as NOTION_VERSION };
