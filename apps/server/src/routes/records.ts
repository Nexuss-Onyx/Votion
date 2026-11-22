/** Page-tree retrieval and server-side collection query routes. */

import type { FastifyInstance } from 'fastify';
import type { FilterGroup, SortClause } from '@votion/types';

import { executeCollectionQuery } from '../lib/query.js';
import {
  addBlock,
  addCollection,
  addCollectionView,
  emptyRecordMap,
} from '../lib/recordmap.js';
import { loadPageChunkSchema, queryCollectionSchema } from '../schemas.js';

export async function recordRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/v3/loadPageChunk',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = loadPageChunkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      const { pageId, depth, limit, spaceId } = parsed.data;
      const root = await fastify.store.findBlockById(pageId);
      if (!root || !root.alive) {
        return reply.code(404).send({ error: 'Not Found', message: 'Page not found.' });
      }
      if (spaceId && root.spaceId !== spaceId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Page not found.' });
      }
      if (!(await fastify.store.findMember(root.spaceId, request.userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const recordMap = emptyRecordMap();
      const queue: { id: string; level: number }[] = [{ id: root.id, level: 0 }];
      const visited = new Set<string>();
      let truncated = false;
      while (queue.length > 0 && visited.size < limit) {
        const current = queue.shift();
        if (!current || visited.has(current.id)) continue;
        visited.add(current.id);
        const block = current.id === root.id ? root : await fastify.store.findBlockById(current.id);
        if (!block || !block.alive || block.spaceId !== root.spaceId) continue;
        addBlock(recordMap, block);
        if (block.parentTable === 'collection') {
          const collection = await fastify.store.findCollectionById(block.parentId);
          if (collection) addCollection(recordMap, collection);
        }
        if (current.level < depth) {
          for (const childId of block.content) {
            if (!visited.has(childId)) queue.push({ id: childId, level: current.level + 1 });
          }
        } else if (block.content.length > 0) {
          truncated = true;
        }
        const viewIds = block.properties['view_ids'];
        if (Array.isArray(viewIds)) {
          const views = await fastify.store.listCollectionViewsByIds(
            viewIds.filter((id): id is string => typeof id === 'string'),
          );
          for (const view of views) {
            addCollectionView(recordMap, view);
            const collection = await fastify.store.findCollectionById(view.collectionId);
            if (collection) addCollection(recordMap, collection);
          }
        }
      }
      return reply.send({ recordMap, cursor: null, hasMore: truncated || queue.length > 0 || visited.size >= limit });
    },
  );

  fastify.post(
    '/api/v3/queryCollection',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = queryCollectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      const { collectionId, spaceId } = parsed.data;
      const collection = await fastify.store.findCollectionById(collectionId);
      if (!collection || !collection.alive || (spaceId && collection.spaceId !== spaceId)) {
        return reply.code(404).send({ error: 'Not Found', message: 'Collection not found.' });
      }
      if (!(await fastify.store.findMember(collection.spaceId, request.userId))) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const rows = await fastify.store.listCollectionRows(collectionId);
      const result = executeCollectionQuery(rows, {
        filter: parsed.data.filter as FilterGroup | undefined,
        sort: parsed.data.sort as SortClause[] | undefined,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        search: parsed.data.search,
      });
      const recordMap = emptyRecordMap();
      addCollection(recordMap, collection);
      for (const block of result.results) addBlock(recordMap, block);
      const views = await fastify.store.listViewsForCollection(collectionId);
      for (const view of views) addCollectionView(recordMap, view);
      return reply.send({ recordMap, total: result.total, results: result.results.map((row) => row.id) });
    },
  );
}
