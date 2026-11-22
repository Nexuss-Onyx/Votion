/**
 * Normalized `recordMap` construction for `loadPageChunk`.
 *
 * Internal store rows are camel-cased; public record values are serialized in
 * the canonical snake_case `@votion/types` format consumed by the client.
 */

import type { UUID } from '@votion/types';

import type {
  BlockRecord,
  CollectionRecord,
  CollectionViewRecord,
} from '../store/types.js';

/** One normalized record entry as served to the client. */
export interface RecordMapEntry<T = Record<string, unknown>> {
  value: T;
  version: number;
}

/** Wire-format normalized record payload of `loadPageChunk`. */
export interface RecordMap {
  block: Record<UUID, RecordMapEntry>;
  collection: Record<UUID, RecordMapEntry>;
  collection_view: Record<UUID, RecordMapEntry>;
}

function iso(date: Date): string {
  return date.toISOString();
}

function serializeBlock(block: BlockRecord): Record<string, unknown> {
  return {
    id: block.id,
    space_id: block.spaceId,
    version: block.version,
    type: block.type,
    properties: block.properties,
    format: block.format,
    content: block.content,
    parent_id: block.parentId,
    parent_table: block.parentTable,
    alive: block.alive,
    created_time: iso(block.createdTime),
    last_edited_time: iso(block.lastEditedTime),
    created_by_id: block.createdById,
    last_edited_by_id: block.lastEditedById,
  };
}

function serializeCollection(collection: CollectionRecord): Record<string, unknown> {
  return {
    id: collection.id,
    space_id: collection.spaceId,
    parent_id: collection.parentId,
    name: collection.name,
    description: collection.description,
    schema: collection.schema,
    icon: collection.icon,
    cover: collection.cover,
    alive: collection.alive,
    version: collection.version,
    created_time: iso(collection.createdAt),
    last_edited_time: iso(collection.updatedAt),
  };
}

function serializeCollectionView(view: CollectionViewRecord): Record<string, unknown> {
  return {
    id: view.id,
    space_id: view.spaceId,
    collection_id: view.collectionId,
    type: view.type,
    name: view.name,
    format: view.format,
    query2: view.query2,
    alive: view.alive,
    version: view.version,
    created_time: iso(view.createdAt),
    last_edited_time: iso(view.updatedAt),
  };
}

/** Creates an empty record map. */
export function emptyRecordMap(): RecordMap {
  return { block: {}, collection: {}, collection_view: {} };
}

/** Adds a block to the map (idempotent). */
export function addBlock(map: RecordMap, block: BlockRecord): void {
  if (!map.block[block.id]) map.block[block.id] = { value: serializeBlock(block), version: block.version };
}

/** Adds a collection to the map (idempotent). */
export function addCollection(map: RecordMap, collection: CollectionRecord): void {
  if (!map.collection[collection.id]) {
    map.collection[collection.id] = { value: serializeCollection(collection), version: collection.version };
  }
}

/** Adds a collection view to the map (idempotent). */
export function addCollectionView(map: RecordMap, view: CollectionViewRecord): void {
  if (!map.collection_view[view.id]) {
    map.collection_view[view.id] = { value: serializeCollectionView(view), version: view.version };
  }
}

/** Counts every record in the map. */
export function recordMapSize(map: RecordMap): number {
  return Object.keys(map.block).length + Object.keys(map.collection).length + Object.keys(map.collection_view).length;
}
