/**
 * PostgreSQL enum types shared by the Votion schema.
 *
 * The value tuples are `as const` so the emitted Drizzle column types stay in
 * sync with the canonical unions declared in `@votion/types`.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

import type {
  ParentTable,
  PermissionRole,
  PrincipalType,
  ViewType,
  WorkspaceRole,
} from '@votion/types';

/** Workspace membership roles (`owner`, `admin`, `member`, `guest`). */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;

/** Entity-level permission roles (`read`, `comment`, `write`, `admin`). */
export const PERMISSION_ROLES = ['read', 'comment', 'write', 'admin'] as const;

/** Principal kinds an ACL override may target. */
export const PRINCIPAL_TYPES = ['user', 'teamspace', 'public'] as const;

/** Tables a block may be parented to. */
export const PARENT_TABLES = ['block', 'collection', 'space'] as const;

/** The six database projection modes. */
export const VIEW_TYPES = [
  'table',
  'board',
  'calendar',
  'timeline',
  'gallery',
  'list',
] as const;

export const workspaceRoleEnum = pgEnum('workspace_role', WORKSPACE_ROLES);
export const permissionRoleEnum = pgEnum('permission_role', PERMISSION_ROLES);
export const principalTypeEnum = pgEnum('principal_type', PRINCIPAL_TYPES);
export const blockParentTableEnum = pgEnum('block_parent_table', PARENT_TABLES);
export const collectionViewTypeEnum = pgEnum('collection_view_type', VIEW_TYPES);

/**
 * Compile-time contract guards: every enum tuple must remain assignable to the
 * canonical `@votion/types` union it mirrors.
 */
export type WorkspaceRoleValue = (typeof WORKSPACE_ROLES)[number] & WorkspaceRole;
export type PermissionRoleValue = (typeof PERMISSION_ROLES)[number] & PermissionRole;
export type PrincipalTypeValue = (typeof PRINCIPAL_TYPES)[number] & PrincipalType;
export type ParentTableValue = (typeof PARENT_TABLES)[number] & ParentTable;
export type ViewTypeValue = (typeof VIEW_TYPES)[number] & ViewType;
