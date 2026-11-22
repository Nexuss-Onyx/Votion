/**
 * Shared test fixtures: a collection, schema, blocks and database rows.
 */

import type {
  Block,
  Collection,
  CollectionProperty,
  CollectionSchema,
  CollectionView,
  UUID,
  ViewType,
} from '@votion/types';
import { blockToDatabaseRecord, resolveRecordTitle } from '../../src/types.js';
import type { DatabaseRecord } from '../../src/types.js';

export const SPACE_ID = 'space-0000-0000-0000-000000000001';
export const COLLECTION_ID = 'collection-0000-0000-0000-000000000001';

export interface TestSchema {
  schema: CollectionSchema;
  titleId: string;
  statusId: string;
  amountId: string;
  tagsId: string;
  dueId: string;
  doneId: string;
}

/** Builds a representative collection schema. */
export function makeTestSchema(): TestSchema {
  const titleId = 'prop_title';
  const statusId = 'prop_status';
  const amountId = 'prop_amount';
  const tagsId = 'prop_tags';
  const dueId = 'prop_due';
  const doneId = 'prop_done';
  const schema: CollectionSchema = {
    [titleId]: { name: 'Name', type: 'title' },
    [statusId]: {
      name: 'Status',
      type: 'select',
      options: [
        { id: 'opt_todo', value: 'Todo', color: 'gray' },
        { id: 'opt_doing', value: 'Doing', color: 'blue' },
        { id: 'opt_done', value: 'Done', color: 'green' },
      ],
    },
    [amountId]: { name: 'Amount', type: 'number', number_format: 'number' },
    [tagsId]: {
      name: 'Tags',
      type: 'multi_select',
      options: [
        { id: 'tag_red', value: 'red', color: 'red' },
        { id: 'tag_blue', value: 'blue', color: 'blue' },
      ],
    },
    [dueId]: { name: 'Due', type: 'date', date_format: 'year_month_day' },
    [doneId]: { name: 'Done', type: 'checkbox' },
  };
  return { schema, titleId, statusId, amountId, tagsId, dueId, doneId };
}

/** Builds a canonical collection record. */
export function makeCollection(
  schema: CollectionSchema,
  overrides: Partial<Collection> = {},
): Collection {
  return {
    id: COLLECTION_ID,
    space_id: SPACE_ID,
    parent_id: 'page-0000-0000-0000-000000000001',
    name: [['Tasks']],
    schema,
    alive: true,
    version: 1,
    created_time: 0,
    last_edited_time: 0,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...overrides,
  };
}

/** Builds a page block parented to a collection. */
export function makeBlock(
  collection: Collection,
  properties: Record<string, unknown>,
  overrides: Partial<Block> = {},
): Block {
  return {
    id: `block-${Math.random().toString(36).slice(2, 10)}`,
    space_id: collection.space_id,
    version: 1,
    type: 'page',
    properties,
    format: {},
    content: [],
    parent_id: collection.id,
    parent_table: 'collection',
    alive: true,
    created_time: 0,
    last_edited_time: 0,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...overrides,
  };
}

/** Builds a database row projection. */
export function makeRecord(
  collection: Collection,
  properties: Record<string, unknown>,
  overrides: Partial<DatabaseRecord> = {},
): DatabaseRecord {
  const block = makeBlock(collection, properties, {
    id: overrides.id ?? `record-${Math.random().toString(36).slice(2, 10)}`,
  });
  const base = blockToDatabaseRecord(collection, block);
  return {
    ...base,
    title: resolveRecordTitle(base, collection.schema),
    ...overrides,
    block: { ...base.block, ...(overrides.block ?? {}) },
    properties: { ...base.properties, ...(overrides.properties ?? {}) },
  };
}

/** Builds a collection view. */
export function makeView(
  type: ViewType,
  overrides: Partial<CollectionView> = {},
): CollectionView {
  return {
    id: `view-${type}-0000-0000-000000000001`,
    space_id: SPACE_ID,
    collection_id: COLLECTION_ID,
    type,
    name: `My ${type}`,
    format: {},
    query2: {},
    alive: true,
    version: 1,
    created_time: 0,
    last_edited_time: 0,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...overrides,
  };
}

/** Creates a record with a plain title string. */
export function titledRecord(
  collection: Collection,
  title: string,
  properties: Record<string, unknown> = {},
  overrides: Partial<DatabaseRecord> = {},
): DatabaseRecord {
  const schema = collection.schema;
  const titleId = Object.entries(schema).find(([, property]) => property.type === 'title')?.[0];
  return makeRecord(
    collection,
    { ...(titleId ? { [titleId]: [[title]] } : {}), ...properties },
    overrides,
  );
}

export type { CollectionProperty, UUID };
