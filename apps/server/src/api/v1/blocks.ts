/**
 * `/v1/blocks` — retrieve, update, archive and traverse block trees.
 *
 * Payloads are Notion block objects (`{ type, <type>: {...} }`). Votion's
 * internal block types are translated by `mappers.ts`.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { UUID } from '@votion/types';

import {
  appendChildrenSchema,
  updateBlockSchema,
} from './schemas.js';
import {
  notionBlockInputToVotion,
  notionBlockTreeToVotion,
  toNotionBlock,
  type NotionBlockInput,
} from './mappers.js';
import { capabilityGuard } from './auth.js';
import {
  collectionForBlock,
  loadBlockInWorkspace,
  parseBody,
  requireWorkspaceId,
  sendNotFound,
  sendUnauthorized,
} from './helpers.js';
import { decodeCursor, normalizePageSize, paginate } from './pagination.js';
import { sendNotionError } from './errors.js';
import type { BlockRecord, DataStore } from '../../store/types.js';

interface IdParams {
  id: string;
}

/** Recursively materialises a Notion block tree into Votion rows. */
async function createBlockTree(
  store: DataStore,
  input: NotionBlockInput,
  parentId: UUID,
  parentTable: 'block' | 'collection' | 'space',
  spaceId: UUID,
): Promise<BlockRecord | null> {
  const converted = notionBlockTreeToVotion(input);
  if (!converted) {
    return null;
  }
  const created = await store.createBlock({
    spaceId,
    type: converted.type,
    parentId,
    parentTable,
    properties: converted.properties,
    format: converted.format,
  });
  if (converted.children.length > 0) {
    const childIds: UUID[] = [];
    for (const child of converted.children) {
      const childBlock = await createBlockTree(store, child, created.id, 'block', spaceId);
      if (childBlock) {
        childIds.push(childBlock.id);
      }
    }
    if (childIds.length > 0) {
      return store.updateBlock(created.id, { content: childIds });
    }
  }
  return created;
}

/** Builds a Votion patch from a Notion `PATCH /blocks/:id` body. */
function blockPatchFromBody(body: Record<string, unknown>): {
  properties: Record<string, unknown>;
  format: Record<string, unknown>;
  alive?: boolean;
} {
  const properties: Record<string, unknown> = {};
  const format: Record<string, unknown> = {};
  let alive: boolean | undefined;

  if (typeof body['archived'] === 'boolean') {
    alive = !body['archived'];
  }
  if ('icon' in body) {
    const icon = body['icon'];
    if (icon && typeof icon === 'object') {
      const record = icon as Record<string, unknown>;
      if (record['type'] === 'emoji' && typeof record['emoji'] === 'string') {
        format['page_icon'] = record['emoji'];
      } else if (
        record['type'] === 'external' &&
        record['external'] &&
        typeof (record['external'] as Record<string, unknown>)['url'] === 'string'
      ) {
        format['page_icon'] = (record['external'] as Record<string, unknown>)['url'];
      }
    } else if (icon === null) {
      format['page_icon'] = null;
    }
  }
  if ('cover' in body && body['cover'] && typeof body['cover'] === 'object') {
    const cover = body['cover'] as Record<string, unknown>;
    const url =
      (cover['external'] as Record<string, unknown> | undefined)?.['url'] ??
      (cover['file'] as Record<string, unknown> | undefined)?.['url'];
    if (typeof url === 'string') {
      format['page_cover'] = url;
    }
  }

  const typeKeys = [
    'paragraph',
    'child_page',
    'child_database',
    'heading_1',
    'heading_2',
    'heading_3',
    'bulleted_list_item',
    'numbered_list_item',
    'to_do',
    'toggle',
    'quote',
    'callout',
    'divider',
    'code',
    'image',
    'video',
    'audio',
    'file',
    'pdf',
    'bookmark',
    'embed',
    'synced_block',
  ];
  for (const key of typeKeys) {
    if (!(key in body)) {
      continue;
    }
    const converted = notionBlockInputToVotion({ type: key, [key]: body[key] });
    if (converted) {
      Object.assign(properties, converted.properties);
      Object.assign(format, converted.format);
    }
  }

  return { properties, format, alive };
}

export async function blockRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const write = capabilityGuard('write');

  fastify.get<{ Params: IdParams }>(
    '/blocks/:id',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive) {
        return sendNotFound(reply);
      }
      const collection = await collectionForBlock(fastify.store, block);
      return reply.send(toNotionBlock(block, { collection }));
    },
  );

  fastify.patch<{ Params: IdParams }>(
    '/blocks/:id',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive) {
        return sendNotFound(reply);
      }
      const parsed = parseBody(reply, updateBlockSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const before = (await fastify.store.findBlockById(block.id)) as BlockRecord;
      const patch = blockPatchFromBody(parsed.data as Record<string, unknown>);
      const updated = await fastify.store.updateBlock(block.id, {
        properties: patch.properties,
        format: patch.format,
        ...(patch.alive === undefined ? {} : { alive: patch.alive }),
      });
      if (!updated) {
        return sendNotFound(reply);
      }
      const collection = await collectionForBlock(fastify.store, updated);
      if (updated.type === 'page') {
        await fastify.v1Events.pageUpdated(workspaceId, updated, before, collection);
      } else {
        await fastify.v1Events.blockUpdated(workspaceId, updated);
      }
      return reply.send(toNotionBlock(updated, { collection }));
    },
  );

  fastify.delete<{ Params: IdParams }>(
    '/blocks/:id',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block) {
        return sendNotFound(reply);
      }
      const updated = await fastify.store.updateBlock(block.id, { alive: false });
      if (!updated) {
        return sendNotFound(reply);
      }
      const collection = await collectionForBlock(fastify.store, updated);
      if (updated.type === 'page') {
        await fastify.v1Events.pageDeleted(workspaceId, updated, collection);
      } else {
        await fastify.v1Events.blockUpdated(workspaceId, updated);
      }
      return reply.send(toNotionBlock(updated, { collection }));
    },
  );

  fastify.get<{ Params: IdParams; Querystring: { start_cursor?: string; page_size?: string } }>(
    '/blocks/:id/children',
    { preHandler: read },
    async (
      request: FastifyRequest<{ Params: IdParams; Querystring: { start_cursor?: string; page_size?: string } }>,
      reply: FastifyReply,
    ) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive) {
        return sendNotFound(reply);
      }
      const offset = decodeCursor(request.query['start_cursor']);
      if (offset === null) {
        return sendNotionError(reply, 400, 'invalid_request', 'Invalid start_cursor.');
      }
      const pageSize = normalizePageSize(
        request.query['page_size'] ? Number(request.query['page_size']) : undefined,
      );
      const children = await fastify.store.listBlocksByIds(block.content);
      const visible = children.filter(
        (child) => child.alive && child.spaceId === workspaceId,
      );
      return reply.send(
        paginate(
          visible.map((child) => toNotionBlock(child)),
          offset,
          pageSize,
          'block',
        ),
      );
    },
  );

  fastify.patch<{ Params: IdParams }>(
    '/blocks/:id/children',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive) {
        return sendNotFound(reply);
      }
      const parsed = parseBody(reply, appendChildrenSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const { children, after } = parsed.data;
      if (after !== undefined && !block.content.includes(after)) {
        return sendNotionError(
          reply,
          400,
          'invalid_request',
          'The `after` block does not belong to this parent.',
        );
      }
      const created: BlockRecord[] = [];
      for (const child of children) {
        const createdBlock = await createBlockTree(
          fastify.store,
          child as NotionBlockInput,
          block.id,
          'block',
          workspaceId,
        );
        if (createdBlock) {
          created.push(createdBlock);
        }
      }
      const content = [...block.content];
      if (after === undefined) {
        content.push(...created.map((entry) => entry.id));
      } else {
        const index = content.indexOf(after);
        content.splice(index + 1, 0, ...created.map((entry) => entry.id));
      }
      const updatedParent = await fastify.store.updateBlock(block.id, { content });
      await fastify.v1Events.blockUpdated(workspaceId, updatedParent ?? block);
      return reply.send(paginate(created.map((entry) => toNotionBlock(entry)), 0, created.length, 'block'));
    },
  );
}

/** Generates a block id (exposed for tests and internal callers). */
export function generateBlockId(): UUID {
  return randomUUID();
}
