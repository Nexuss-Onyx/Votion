/**
 * Workspace RBAC and entity-level permission capability matrices.
 *
 * Security by default: every helper returns `false` / `null` when no role is
 * granted or when a grant is expired or explicitly denied.
 */

import type { WorkspaceSettings } from '@votion/db';
import {
  PERMISSION_ROLE_RANK,
  WORKSPACE_ROLE_RANK,
  permissionSatisfies,
  roleSatisfies,
  type PermissionRole,
  type WorkspaceRole,
} from '@votion/types';

import type { AclPermissionRule } from './types.js';

/** Granular operations governed by entity-level permission roles. */
export type EntityCapability =
  | 'read'
  | 'export'
  | 'comment'
  | 'write'
  | 'create_child'
  | 'delete'
  | 'manage_permissions';

/** Workspace-level administrative and membership capabilities. */
export type WorkspaceCapability =
  | 'view_workspace'
  | 'create_root_page'
  | 'invite_guests'
  | 'manage_teamspaces'
  | 'manage_settings'
  | 'manage_members'
  | 'manage_admins'
  | 'manage_billing'
  | 'delete_workspace';

/**
 * Canonical capability matrix for entity-level permission roles:
 * - `admin`: modify permissions, delete page, write, create child, comment, read, export.
 * - `write`: edit block content, create child blocks, comment, read, export.
 * - `comment`: view content, export, add inline/page comments.
 * - `read`: view content and export.
 */
export const ROLE_CAPABILITIES: Readonly<
  Record<PermissionRole, ReadonlySet<EntityCapability>>
> = {
  read: new Set<EntityCapability>(['read', 'export']),
  comment: new Set<EntityCapability>(['read', 'export', 'comment']),
  write: new Set<EntityCapability>([
    'read',
    'export',
    'comment',
    'write',
    'create_child',
  ]),
  admin: new Set<EntityCapability>([
    'read',
    'export',
    'comment',
    'write',
    'create_child',
    'delete',
    'manage_permissions',
  ]),
};

/**
 * Canonical capability matrix for workspace membership roles (`owner`, `admin`,
 * `member`, `guest`).
 */
export const WORKSPACE_ROLE_CAPABILITIES: Readonly<
  Record<WorkspaceRole, ReadonlySet<WorkspaceCapability>>
> = {
  guest: new Set<WorkspaceCapability>(['view_workspace']),
  member: new Set<WorkspaceCapability>([
    'view_workspace',
    'create_root_page',
    'invite_guests',
  ]),
  admin: new Set<WorkspaceCapability>([
    'view_workspace',
    'create_root_page',
    'invite_guests',
    'manage_teamspaces',
    'manage_settings',
    'manage_members',
  ]),
  owner: new Set<WorkspaceCapability>([
    'view_workspace',
    'create_root_page',
    'invite_guests',
    'manage_teamspaces',
    'manage_settings',
    'manage_members',
    'manage_admins',
    'manage_billing',
    'delete_workspace',
  ]),
};

/**
 * Default entity-level permission inherited when upward traversal reaches the
 * workspace (`space`) root with no closer explicit override.
 *
 * Guests receive `null` (DENY) at the workspace root — they may only access
 * pages/blocks explicitly shared with them or their teamspace.
 */
export const WORKSPACE_ROLE_DEFAULT_PERMISSION: Readonly<
  Record<WorkspaceRole, PermissionRole | null>
> = {
  owner: 'admin',
  admin: 'admin',
  member: 'write',
  guest: null,
};

/** Maps a workspace membership role to its default inherited entity permission. */
export function workspaceRoleToPermission(
  role: WorkspaceRole,
): PermissionRole | null {
  return WORKSPACE_ROLE_DEFAULT_PERMISSION[role];
}

/** Returns `true` iff `role` grants `capability` on an entity (fails closed on `null`). */
export function hasEntityCapability(
  role: PermissionRole | null,
  capability: EntityCapability,
): boolean {
  if (role === null) {
    return false;
  }
  return ROLE_CAPABILITIES[role].has(capability);
}

/**
 * Returns `true` iff a workspace member with `role` may perform `capability`,
 * taking workspace-level policy settings (such as `guests_can_invite`) into account.
 */
export function hasWorkspaceCapability(
  role: WorkspaceRole | null,
  capability: WorkspaceCapability,
  settings?: WorkspaceSettings,
): boolean {
  if (role === null) {
    return false;
  }
  if (
    role === 'guest' &&
    capability === 'invite_guests' &&
    settings?.guests_can_invite === true
  ) {
    return true;
  }
  return WORKSPACE_ROLE_CAPABILITIES[role].has(capability);
}

/** Returns the higher-privilege entity role, or `null` when both inputs are `null`. */
export function maxPermissionRole(
  a: PermissionRole | null,
  b: PermissionRole | null,
): PermissionRole | null {
  if (a === null) return b;
  if (b === null) return a;
  return PERMISSION_ROLE_RANK[a] >= PERMISSION_ROLE_RANK[b] ? a : b;
}

/** Returns the lower-privilege entity role (useful for capping public/anonymous access). */
export function minPermissionRole(
  a: PermissionRole,
  b: PermissionRole,
): PermissionRole {
  return PERMISSION_ROLE_RANK[a] <= PERMISSION_ROLE_RANK[b] ? a : b;
}

/**
 * Evaluates whether a permission rule is currently active (not expired).
 * Unparseable `expires_at` values fail closed (`false`).
 */
export function isPermissionGrantActive(
  rule: AclPermissionRule,
  now: Date = new Date(),
): boolean {
  const expiresAt = rule.metadata?.expires_at;
  if (expiresAt === undefined || expiresAt === null) {
    return true;
  }
  const expiryMs =
    typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) {
    return false;
  }
  return expiryMs > now.getTime();
}

export {
  PERMISSION_ROLE_RANK,
  WORKSPACE_ROLE_RANK,
  permissionSatisfies,
  roleSatisfies,
};
