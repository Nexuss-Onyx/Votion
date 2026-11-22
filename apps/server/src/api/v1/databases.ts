/**
 * `/v1/databases` — create databases, retrieve their schema, and query rows.
 *
 * Query bodies accept Notion's filter/sort grammar and are translated onto the
 * shared Votion collection query engine.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  FilterClause,
  FilterComparator,
  FilterGroup,
  FilterNode,
  RichText,
  SortClause,
} from '@votion/types';
import { plainTextToRichText } from '@votion/types';

import { capabilityGuard } from './auth.js';
import { executeCollectionQuery } from '../../lib/query.js';
import {
  notionDatabaseSchemaToVotion,
  resolvePropertyId,
  toNotionDatabase,
  toNotionPage,
  toVotionRichText,
} from './mappers.js';
import {
  createDatabaseSchema,
  queryDatabaseSchema,
  updateDatabaseSchema,
} from './schemas.js';
import {
  loadBlockInWorkspace,
  loadCollectionInWorkspace,
  parseBody,
  requireWorkspaceId,
  sendNotFound,
  sendUnauthorized,
} from './helpers.js';
import { decodeCursor, normalizePageSize, paginate } from './pagination.js';
import { sendNotionError } from './errors.js';
import type { CollectionRecord } from '../../store/types.js';

interface IdParams {
  id: string;
}

/** Notion comparator → Votion comparator. */
const COMPARATOR_MAP: Record<string, FilterComparator> = {
  equals: 'equals',
  does_not_equal: 'not_equals',
  contains: 'contains',
  does_not_contain: 'does_not_contain',
  starts_with: 'starts_with',
  ends_with: 'ends_with',
  is_empty: 'is_empty',
  is_not_empty: 'is_not_empty',
  greater_than: 'greater_than',
  greater_than_or_equal: 'greater_than_or_equal',
  less_than: 'less_than',
  less_than_or_equal: 'less_than_or_equal',
  before: 'before',
  on_or_before: 'on_or_before',
  after: 'after',
  on_or_after: 'on_or_after',
  is_checked: 'is_checked',
  is_not_checked: 'is_not_checked',
  is_within: 'is_within',
  is_relative_to_today: 'is_relative_to_today',
};

const NON_FILTER_KEYS = new Set(['property', 'timestamp', 'id', 'selector']);

function convertClause(raw: unknown, schema: CollectionRecord['schema']): FilterClause | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const propertyKey = record['property'] ?? record['timestamp'];
  if (typeof propertyKey !== 'string') {
    return null;
  }
  const resolved = resolvePropertyId(schema, propertyKey);
  const typeKey = Object.keys(record).find((key) => !NON_FILTER_KEYS.has(key));
  if (!typeKey) {
    return null;
  }
  const comparatorPayload = record[typeKey];
  if (!comparatorPayload || typeof comparatorPayload !== 'object') {
    return null;
  }
  const entries = Object.entries(comparatorPayload as Record<string, unknown>);
  const first = entries[0];
  if (!first) {
    return null;
  }
  const [comparatorKey, value] = first;
  const comparator = COMPARATOR_MAP[comparatorKey];
  if (!comparator) {
    return null;
  }
  return {
    property: resolved?.propertyId ?? propertyKey,
    comparator,
    value: comparator === 'is_empty' || comparator === 'is_not_empty' ? undefined : value,
  };
}

function convertFilterNode(
  raw: unknown,
  schema: CollectionRecord['schema'],
): FilterNode | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record['and']) || Array.isArray(record['or'])) {
    const operator = Array.isArray(record['and']) ? 'and' : 'or';
    const clauses = (record[operator] as unknown[])
      .map((entry) => convertFilterNode(entry, schema))
      .filter((entry): entry is FilterNode => entry !== null);
    if (clauses.length === 0) {
      return null;
    }
    const group: FilterGroup = { operator, clauses };
    return group;
  }
  return convertClause(record, schema);
}

/** Converts a Notion filter payload into a Votion filter tree. */
export function notionFilterToVotion(
  raw: unknown,
  schema: CollectionRecord['schema'],
): FilterGroup | undefined {
  const node = convertFilterNode(raw, schema);
  if (!node) {
    return undefined;
  }
  if ('operator' in node && 'clauses' in node) {
    return node;
  }
  return { operator: 'and', clauses: [node] };
}

/** Converts Notion sort entries into Votion sort clauses. */
export function notionSortsToVotion(
  raw: unknown,
  schema: CollectionRecord['schema'],
): SortClause[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const sorts: SortClause[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const direction = record['direction'] === 'descending' ? 'descending' : 'ascending';
    if (record['timestamp'] === 'last_edited_time') {
      sorts.push({ property: 'last_edited_time', direction });
      continue;
    }
    const propertyKey = record['property'];
    if (typeof propertyKey !== 'string') {
      continue;
    }
    const resolved = resolvePropertyId(schema, propertyKey);
    sorts.push({ property: resolved?.propertyId ?? propertyKey, direction });
  }
  return sorts;
}

/** Converts a title input (rich text array or plain string) to rich text. */
function toRichText(value: unknown): RichText {
  if (typeof value === 'string') {
    return plainTextToRichText(value);
  }
  return toVotionRichText(value);
}

/** Resolves the page that embeds a database via its `collection_view` block. */
async function resolveDatabaseParentPageId(
  fastify: FastifyInstance,
  collection: CollectionRecord,
): Promise<string> {
  const viewBlock = await fastify.store.findBlockById(collection.parentId);
  return viewBlock?.parentId ?? collection.parentId;
}

export async function databaseRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const write = capabilityGuard('write');

  fastify.post(
    '/databases',
    { preHandler: write },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, createDatabaseSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const parentBlock = await loadBlockInWorkspace(
        fastify.store,
        workspaceId,
        parsed.data.parent.page_id,
      );
      if (!parentBlock) {
        return sendNotFound(reply, 'Parent page not found.');
      }
      const { schema } = notionDatabaseSchemaToVotion(parsed.data.properties);
      const blockId = randomUUID();
      const collection = await fastify.store.createCollection({
        spaceId: workspaceId,
        parentId: blockId,
        name: toRichText(parsed.data.title ?? []),
        description: toRichText(parsed.data.description ?? []),
        schema,
      });
      const viewBlock = await fastify.store.createBlock({
        id: blockId,
        spaceId: workspaceId,
        type: 'collection_view',
        parentId: parentBlock.id,
        parentTable: 'block',
        properties: { collection_id: collection.id },
      });
      await fastify.store.updateBlock(parentBlock.id, {
        content: [...parentBlock.content, viewBlock.id],
      });
      await fastify.v1Events.databaseCreated(workspaceId, collection);
      return reply.send(toNotionDatabase(collection, { parentPageId: parentBlock.id }));
    },
  );

  fastify.get<{ Params: IdParams }>(
    '/databases/:id',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const collection = await loadCollectionInWorkspace(
        fastify.store,
        workspaceId,
        request.params.id,
      );
      if (!collection || !collection.alive) {
        return sendNotFound(reply, 'Database not found.');
      }
      const parentPageId = await resolveDatabaseParentPageId(fastify, collection);
      return reply.send(toNotionDatabase(collection, { parentPageId }));
    },
  );

  fastify.patch<{ Params: IdParams }>(
    '/databases/:id',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const collection = await loadCollectionInWorkspace(
        fastify.store,
        workspaceId,
        request.params.id,
      );
      if (!collection || !collection.alive) {
        return sendNotFound(reply, 'Database not found.');
      }
      const parsed = parseBody(reply, updateDatabaseSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const patch: {
        name?: RichText;
        description?: RichText;
        schema?: CollectionRecord['schema'];
      } = {};
      if (parsed.data.title !== undefined) {
        patch.name = toRichText(parsed.data.title);
      }
      if (parsed.data.description !== undefined) {
        patch.description = toRichText(parsed.data.description);
      }
      if (parsed.data.properties !== undefined) {
        const converted = notionDatabaseSchemaToVotion(parsed.data.properties);
        patch.schema = { ...collection.schema, ...converted.schema };
      }
      const updated = await fastify.store.updateCollection(collection.id, patch);
      if (!updated) {
        return sendNotFound(reply);
      }
      await fastify.v1Events.databaseUpdated(workspaceId, updated);
      const parentPageId = await resolveDatabaseParentPageId(fastify, updated);
      return reply.send(toNotionDatabase(updated, { parentPageId }));
    },
  );

  fastify.post<{ Params: IdParams; Body: Record<string, unknown> }>(
    '/databases/:id/query',
    { preHandler: read },
    async (
      request: FastifyRequest<{ Params: IdParams; Body: Record<string, unknown> }>,
      reply: FastifyReply,
    ) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const collection = await loadCollectionInWorkspace(
        fastify.store,
        workspaceId,
        request.params.id,
      );
      if (!collection || !collection.alive) {
        return sendNotFound(reply, 'Database not found.');
      }
      const parsed = parseBody(reply, queryDatabaseSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const offset = decodeCursor(parsed.data.start_cursor);
      if (offset === null) {
        return sendNotionError(reply, 400, 'invalid_request', 'Invalid start_cursor.');
      }
      const pageSize = normalizePageSize(parsed.data.page_size);
      const rows = await fastify.store.listCollectionRows(collection.id);
      const result = executeCollectionQuery(rows, {
        filter: notionFilterToVotion(parsed.data.filter, collection.schema),
        sort: notionSortsToVotion(parsed.data.sorts, collection.schema),
      });
      return reply.send(
        paginate(
          result.results.map((row) => toNotionPage(row, collection)),
          offset,
          pageSize,
          'page',
        ),
      );
    },
  );
}
