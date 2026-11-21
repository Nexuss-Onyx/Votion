/**
 * `collections` & `collection_views` — database schemas and view projections.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type {
  CollectionSchema,
  CollectionViewFormat,
  CollectionViewQuery,
  RichText,
  ViewType,
} from '@votion/types';

import { collectionViewTypeEnum } from './enums.js';
import { workspaces } from './workspaces.js';

/** Database definition: metadata plus the JSONB property schema map. */
export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Block id of the owning `collection_view` block. */
    parentId: uuid('parent_id').notNull(),
    name: jsonb('name')
      .$type<RichText>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    description: jsonb('description')
      .$type<RichText>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Map of property id -> property definition. */
    schema: jsonb('schema')
      .$type<CollectionSchema>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    icon: text('icon'),
    cover: text('cover'),
    alive: boolean('alive').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_collections_space_id').on(table.spaceId),
    index('idx_collections_parent_id').on(table.parentId),
    index('idx_collections_schema_gin').using('gin', table.schema),
  ],
);

/** Saved projection (table/board/calendar/timeline/gallery/list) of a collection. */
export const collectionViews = pgTable(
  'collection_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    type: collectionViewTypeEnum('type').$type<ViewType>().notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    /** Column widths, card covers, board groupings, timeline scale. */
    format: jsonb('format')
      .$type<CollectionViewFormat>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Filters, sorts, groupings & aggregations. */
    query2: jsonb('query2')
      .$type<CollectionViewQuery>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    alive: boolean('alive').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_collection_views_coll_id').on(table.collectionId),
    index('idx_collection_views_space_id').on(table.spaceId),
    index('idx_collection_views_type').on(table.collectionId, table.type),
    index('idx_collection_views_query2_gin').using('gin', table.query2),
  ],
);

export type CollectionRow = typeof collections.$inferSelect;
export type NewCollectionRow = typeof collections.$inferInsert;
export type CollectionViewRow = typeof collectionViews.$inferSelect;
export type NewCollectionViewRow = typeof collectionViews.$inferInsert;
