/**
 * `/v1/pages` — create, retrieve, update and archive pages.
 *
 * Pages are Votion `page` blocks; database rows are pages parented to a
 * collection, so their property map comes from the collection schema.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BlockFormat, BlockProperties, UUID } from '@votion/types';

import { capabilityGuard } from './auth.js';
import { toNotionPage, toVotionPropertyValue, resolvePropertiesToIds } from './mappers.js';
import { createPageSchema, updatePageSchema } from './schemas.js';
import {
  collectionForBlock,
  loadBlockInWorkspace,
  loadCollectionInWorkspace,
  parseBody,
  requireWorkspaceId,
  sendNotFound,
  sendUnauthorized,
} from './helpers.js';
import type { CollectionRecord } from '../../store/types.js';

interface IdParams {
  id: string;
}

/** Converts a Notion icon/cover payload into Votion `format` entries. */
function formatFromIconCover(
  icon: Record<string, unknown> | null | undefined,
  cover: Record<string, unknown> | null | undefined,
): BlockFormat {
  const format: BlockFormat = {};
  if (icon && typeof icon === 'object') {
    if (icon['type'] === 'emoji' && typeof icon['emoji'] === 'string') {
      format['page_icon'] = icon['emoji'];
    } else {
      const url =
        (icon['external'] as Record<string, unknown> | undefined)?.['url'] ??
        (icon['file'] as Record<string, unknown> | undefined)?.['url'];
      if (typeof url === 'string') {
        format['page_icon'] = url;
      }
    }
  }
  if (cover && typeof cover === 'object') {
    const url =
      (cover['external'] as Record<string, unknown> | undefined)?.['url'] ??
      (cover['file'] as Record<string, unknown> | undefined)?.['url'];
    if (typeof url === 'string') {
      format['page_cover'] = url;
    }
  }
  return format;
}

/** Maps a standalone (non-database) page property payload to Votion storage. */
function standalonePageProperties(properties: Record<string, unknown>): BlockProperties {
  const result: BlockProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'title' || key === 'Name' || key === 'Title') {
      result['title'] = toVotionPropertyValue('title', value) as BlockProperties['title'];
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Appends a block id to a parent block's ordered child list. */
async function appendToParent(
  fastify: FastifyInstance,
  parentId: UUID,
  childId: UUID,
): Promise<void> {
  const parent = await fastify.store.findBlockById(parentId);
  if (!parent || parent.parentTable === 'collection') {
    return;
  }
  await fastify.store.updateBlock(parentId, { content: [...parent.content, childId] });
}

/** Resolves the parent of a new page from a Notion parent payload. */
async function resolvePageParent(
  fastify: FastifyInstance,
  workspaceId: UUID,
  parent: { database_id?: UUID; page_id?: UUID; workspace?: boolean },
): Promise<{ parentId: UUID; parentTable: 'block' | 'collection' | 'space'; collection: CollectionRecord | null } | null> {
  if (parent.database_id) {
    const collection = await loadCollectionInWorkspace(
      fastify.store,
      workspaceId,
      parent.database_id,
    );
    if (!collection) {
      return null;
    }
    return { parentId: collection.id, parentTable: 'collection', collection };
  }
  if (parent.page_id) {
    const parentBlock = await loadBlockInWorkspace(fastify.store, workspaceId, parent.page_id);
    if (!parentBlock) {
      return null;
    }
    return { parentId: parentBlock.id, parentTable: 'block', collection: null };
  }
  return { parentId: workspaceId, parentTable: 'space', collection: null };
}

export async function pageRoutes(fastify: FastifyInstance): Promise<void> {
  const read = capabilityGuard('read');
  const write = capabilityGuard('write');

  fastify.post(
    '/pages',
    { preHandler: write },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const parsed = parseBody(reply, createPageSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const resolved = await resolvePageParent(fastify, workspaceId, parsed.data.parent);
      if (!resolved) {
        return sendNotFound(reply, 'Parent page or database not found.');
      }
      const properties = resolved.collection
        ? resolvePropertiesToIds(resolved.collection.schema, parsed.data.properties)
        : standalonePageProperties(parsed.data.properties);
      const icon = parsed.data.icon as Record<string, unknown> | null | undefined;
      const cover = parsed.data.cover as Record<string, unknown> | null | undefined;
      const block = await fastify.store.createBlock({
        spaceId: workspaceId,
        type: 'page',
        parentId: resolved.parentId,
        parentTable: resolved.parentTable,
        properties,
        format: formatFromIconCover(icon, cover),
      });
      if (resolved.parentTable !== 'space') {
        await appendToParent(fastify, resolved.parentId, block.id);
      }
      await fastify.v1Events.pageCreated(workspaceId, block, resolved.collection);
      return reply.send(toNotionPage(block, resolved.collection));
    },
  );

  fastify.get<{ Params: IdParams }>(
    '/pages/:id',
    { preHandler: read },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive || block.type !== 'page') {
        return sendNotFound(reply, 'Page not found.');
      }
      const collection = await collectionForBlock(fastify.store, block);
      return reply.send(toNotionPage(block, collection));
    },
  );

  fastify.patch<{ Params: IdParams }>(
    '/pages/:id',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive || block.type !== 'page') {
        return sendNotFound(reply, 'Page not found.');
      }
      const parsed = parseBody(reply, updatePageSchema, request.body);
      if (!parsed.success) {
        return reply;
      }
      const collection = await collectionForBlock(fastify.store, block);
      const before = (await fastify.store.findBlockById(block.id)) as typeof block;
      const properties = parsed.data.properties
        ? collection
          ? resolvePropertiesToIds(collection.schema, parsed.data.properties)
          : standalonePageProperties(parsed.data.properties)
        : undefined;
      const format = formatFromIconCover(
        parsed.data.icon as Record<string, unknown> | null | undefined,
        parsed.data.cover as Record<string, unknown> | null | undefined,
      );
      const updated = await fastify.store.updateBlock(block.id, {
        ...(properties === undefined ? {} : { properties }),
        ...(Object.keys(format).length > 0 ? { format } : {}),
        ...(parsed.data.archived === undefined ? {} : { alive: !parsed.data.archived }),
      });
      if (!updated) {
        return sendNotFound(reply);
      }
      await fastify.v1Events.pageUpdated(workspaceId, updated, before, collection);
      return reply.send(toNotionPage(updated, collection));
    },
  );

  fastify.delete<{ Params: IdParams }>(
    '/pages/:id',
    { preHandler: write },
    async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const workspaceId = requireWorkspaceId(request);
      if (!workspaceId) {
        return sendUnauthorized(reply);
      }
      const block = await loadBlockInWorkspace(fastify.store, workspaceId, request.params.id);
      if (!block || !block.alive || block.type !== 'page') {
        return sendNotFound(reply, 'Page not found.');
      }
      const collection = await collectionForBlock(fastify.store, block);
      const updated = await fastify.store.updateBlock(block.id, { alive: false });
      if (!updated) {
        return sendNotFound(reply);
      }
      await fastify.v1Events.pageDeleted(workspaceId, updated, collection);
      return reply.send(toNotionPage(updated, collection));
    },
  );
}
