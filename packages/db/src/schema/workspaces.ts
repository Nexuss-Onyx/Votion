/**
 * `workspaces` & `workspace_members` — tenancy and RBAC membership.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { workspaceRoleEnum } from './enums.js';

/** Workspace (Notion "space") — the tenancy root of all content. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    /** Unique vanity domain / slug used in URLs. */
    domain: varchar('domain', { length: 64 }),
    icon: text('icon'),
    plan: varchar('plan', { length: 32 }).notNull().default('free'),
    /** Workspace-level feature flags & settings. */
    settings: jsonb('settings')
      .$type<WorkspaceSettings>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_workspaces_domain').on(table.domain),
    index('idx_workspaces_created_at').on(table.createdAt),
  ],
);

/** Workspace-level feature flags & settings payload. */
export interface WorkspaceSettings {
  /** Whether guests can invite other guests. */
  guests_can_invite?: boolean;
  /** Restrict public page sharing for the whole workspace. */
  disable_public_sharing?: boolean;
  /** Default AI/model feature gates. */
  enabled_features?: string[];
  [key: string]: unknown;
}

/** Junction table granting a user a role inside a workspace. */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'pk_workspace_members',
      columns: [table.workspaceId, table.userId],
    }),
    index('idx_workspace_members_user_id').on(table.userId),
    index('idx_workspace_members_role').on(table.workspaceId, table.role),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;
