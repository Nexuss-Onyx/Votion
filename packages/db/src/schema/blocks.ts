/**
 * `blocks` — the unified block table.
 *
 * Every page, paragraph, database row and canvas container is a row here.
 * Content and presentation payloads live in JSONB columns (`properties`,
 * `format`); hierarchy is a doubly-linked structure (`content` UUID[] downwards,
 * `parent_id` + `parent_table` upwards).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { BlockFormat, BlockProperties, BlockType } from '@votion/types';

import { blockParentTableEnum } from './enums.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Optimistic-concurrency counter, incremented on every mutation. */
    version: integer('version').notNull().default(1),
    type: varchar('type', { length: 64 }).$type<BlockType>().notNull(),

    /** Rich text, checkbox state, code language, media source, row values. */
    properties: jsonb('properties')
      .$type<BlockProperties>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Cover, icon, colors, column ratios, media sizing. */
    format: jsonb('format')
      .$type<BlockFormat>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Ordered array of child block ids. */
    content: uuid('content').array().notNull().default(sql`ARRAY[]::uuid[]`),

    /** Parent record id (a block, collection or space). */
    parentId: uuid('parent_id').notNull(),
    parentTable: blockParentTableEnum('parent_table').notNull(),

    /** Soft-deletion flag: Votion never hard-deletes user content. */
    alive: boolean('alive').notNull().default(true),

    createdTime: timestamp('created_time', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastEditedTime: timestamp('last_edited_time', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastEditedById: uuid('last_edited_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('idx_blocks_space_id').on(table.spaceId),
    index('idx_blocks_parent_id').on(table.parentId),
    index('idx_blocks_alive').on(table.alive),
    index('idx_blocks_type').on(table.type),
    index('idx_blocks_space_parent').on(
      table.spaceId,
      table.parentTable,
      table.parentId,
    ),
    index('idx_blocks_last_edited').on(table.spaceId, table.lastEditedTime),
    index('idx_blocks_properties_gin').using('gin', table.properties),
    index('idx_blocks_format_gin').using('gin', table.format),
  ],
);

export type BlockRow = typeof blocks.$inferSelect;
export type NewBlockRow = typeof blocks.$inferInsert;
