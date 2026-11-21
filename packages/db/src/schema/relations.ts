/**
 * Drizzle relational mappings (`db.query.*`) for every Votion table.
 *
 * Centralised in a single module so table modules never import each other in a
 * cycle, and so `drizzle-kit check` can validate the whole relationship graph.
 */

import { relations } from 'drizzle-orm';

import { blocks } from './blocks.js';
import { collectionViews, collections } from './collections.js';
import { permissions } from './permissions.js';
import { transactionRecords } from './transactions.js';
import { accounts, users } from './users.js';
import { workspaceMembers, workspaces } from './workspaces.js';

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  memberships: many(workspaceMembers),
  createdBlocks: many(blocks, { relationName: 'block_created_by' }),
  editedBlocks: many(blocks, { relationName: 'block_edited_by' }),
  transactions: many(transactionRecords),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  blocks: many(blocks),
  collections: many(collections),
  collectionViews: many(collectionViews),
  permissions: many(permissions),
  transactions: many(transactionRecords),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  space: one(workspaces, {
    fields: [blocks.spaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [blocks.createdById],
    references: [users.id],
    relationName: 'block_created_by',
  }),
  lastEditedBy: one(users, {
    fields: [blocks.lastEditedById],
    references: [users.id],
    relationName: 'block_edited_by',
  }),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  space: one(workspaces, {
    fields: [collections.spaceId],
    references: [workspaces.id],
  }),
  views: many(collectionViews),
}));

export const collectionViewsRelations = relations(collectionViews, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionViews.collectionId],
    references: [collections.id],
  }),
  space: one(workspaces, {
    fields: [collectionViews.spaceId],
    references: [workspaces.id],
  }),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [permissions.workspaceId],
    references: [workspaces.id],
  }),
}));

export const transactionRecordsRelations = relations(
  transactionRecords,
  ({ one }) => ({
    space: one(workspaces, {
      fields: [transactionRecords.spaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [transactionRecords.userId],
      references: [users.id],
    }),
  }),
);
