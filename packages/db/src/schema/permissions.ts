/**
 * `permissions` — explicit entity-level ACL overrides.
 *
 * Workspace membership answers "can this user see the workspace?"; this table
 * answers "and may they edit *this* block?". Absence of a row means the entity
 * inherits the role of its nearest ancestor with a grant.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { PermissionEntityTable } from '@votion/types';

import { permissionRoleEnum, principalTypeEnum } from './enums.js';
import { workspaces } from './workspaces.js';

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Entity kind the override applies to (`block` | `space`). */
    entityTable: varchar('entity_table', { length: 32 })
      .$type<PermissionEntityTable>()
      .notNull(),
    entityId: uuid('entity_id').notNull(),
    principalType: principalTypeEnum('principal_type').notNull(),
    /** `null` for `public` principals (anonymous share links). */
    principalId: uuid('principal_id'),
    role: permissionRoleEnum('role').notNull(),
    /** Extra grant metadata (expiry, share link token hash, ...). */
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_permissions_entity').on(table.entityTable, table.entityId),
    index('idx_permissions_principal').on(table.principalType, table.principalId),
    index('idx_permissions_workspace').on(table.workspaceId, table.entityTable),
  ],
);

export type PermissionRow = typeof permissions.$inferSelect;
export type NewPermissionRow = typeof permissions.$inferInsert;
