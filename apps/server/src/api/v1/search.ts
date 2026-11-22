/**
 * `POST /v1/search` — workspace-wide search across pages and databases.
 *
 * Mirrors Notion's search endpoint: `query`, `filter` (object type), `sort`,
 * and cursor pagination over a combined page/database result list.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { RichText } from '@votion/types';
import { richTextToPlainText } from '@votion/types';

import { capabilityGuard } from './auth.js';
import { toNotionDatabase, toNotionPage } from './mappers.js';
import { searchSchema } from './schemas.js';
import { parseBody, requireWorkspaceId, sendUnauthorized } from './helpers.js';
import { decodeCursor, normalizePageSize, paginate } from './pagination.js';
import { sendNotionError } from './errors.js';
import type { NotionDatabaseObject, NotionPageObject } from './mappers.js';

interface SearchHit {
  object: NotionPageObject | NotionDatabaseObject;
  kind: 'page' | 'database';
  lastEdited: number;
  text: string;
}

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/search',
    { preHandler: capabilityGuard('read') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, searchSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const offset = decodeCursor(parsed.data.start_cursor);
      if (offset === null) {
        return sendNotionError(reply, 400, 'invalid_request', 'Invalid start_cursor.');
      }
      const pageSize = normalizePageSize(parsed.data.page_size);

      const [blocks, collections] = await Promise.all([
        fastify.store.listBlocksBySpace(workspaceId),
        fastify.store.listCollectionsBySpace(workspaceId),
      ]);
      const collectionById = new Map(collections.map((entry) => [entry.id, entry]));

      const hits: SearchHit[] = [];
      for (const block of blocks) {
        if (block.type !== 'page' || !block.alive) {
          continue;
        }
        const collection =
          block.parentTable === 'collection'
            ? (collectionById.get(block.parentId) ?? null)
            : null;
        const text = collection
          ? richTextToPlainText(collection.name)
          : richTextToPlainText(block.properties['title'] as RichText);
        hits.push({
          object: toNotionPage(block, collection),
          kind: 'page',
          lastEdited: block.lastEditedTime.getTime(),
          text,
        });
      }
      for (const collection of collections) {
        hits.push({
          object: toNotionDatabase(collection),
          kind: 'database',
          lastEdited: collection.updatedAt.getTime(),
          text: richTextToPlainText(collection.name),
        });
      }

      let filtered = hits;
      if (parsed.data.filter?.value) {
        filtered = filtered.filter((hit) => hit.kind === parsed.data.filter?.value);
      }
      if (parsed.data.query && parsed.data.query.trim().length > 0) {
        const needle = parsed.data.query.toLowerCase();
        filtered = filtered.filter((hit) => hit.text.toLowerCase().includes(needle));
      }

      const direction = parsed.data.sort?.direction === 'ascending' ? 1 : -1;
      filtered = [...filtered].sort((a, b) => (a.lastEdited - b.lastEdited) * direction);

      return reply.send(
        paginate(
          filtered.map((hit) => hit.object),
          offset,
          pageSize,
          'page_or_database',
        ),
      );
    },
  );
}
