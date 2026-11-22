/**
 * `automation_rules` — in-database event-driven automations (Phase 11).
 *
 * A rule couples a trigger (`page_added`, `property_edited`) to an ordered
 * list of actions (`update_property`, `create_page`, `dispatch_webhook`).
 * Trigger and action payloads are JSONB so new action types can ship without a
 * schema migration; the server validates them with Zod before persisting.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { workspaces } from './workspaces.js';

/** Trigger kinds understood by the automation engine. */
export const AUTOMATION_TRIGGER_TYPES = ['page_added', 'property_edited'] as const;

/** Action kinds understood by the automation engine. */
export const AUTOMATION_ACTION_TYPES = [
  'update_property',
  'create_page',
  'dispatch_webhook',
] as const;

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    /** `{ type: 'page_added' }` or `{ type, property, value }`. */
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
    /** Ordered action payloads. */
    actions: jsonb('actions')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    alive: boolean('alive').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_automation_rules_space').on(table.workspaceId),
    index('idx_automation_rules_alive').on(table.workspaceId, table.alive),
  ],
);

export type AutomationRuleRow = typeof automationRules.$inferSelect;
export type NewAutomationRuleRow = typeof automationRules.$inferInsert;
