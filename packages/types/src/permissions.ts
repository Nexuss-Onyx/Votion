/**
 * Access-control contracts (workspace membership + entity-level ACL overrides).
 *
 * These shapes mirror the `workspace_members` and `permissions` tables owned by
 * `@votion/db` and are consumed by `@votion/acl` (Phase 7).
 */

import type { Timestamp, UUID } from './common.js';

/** Workspace-level role granted through membership. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

/** Entity-level role granted through an explicit permission override. */
export type PermissionRole = 'read' | 'comment' | 'write' | 'admin';

/** Who the permission override applies to. */
export type PrincipalType = 'user' | 'teamspace' | 'public';

/** Tables that can receive entity-level ACL overrides. */
export type PermissionEntityTable = 'block' | 'space';

/** Workspace record (`workspaces` table). */
export interface Workspace {
  id: UUID;
  name: string;
  domain: string | null;
  icon: string | null;
  plan: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Workspace membership junction row (`workspace_members` table). */
export interface WorkspaceMember {
  workspace_id: UUID;
  user_id: UUID;
  role: WorkspaceRole;
  created_at: Timestamp;
}

/** Explicit permission override (`permissions` table). */
export interface Permission {
  id: UUID;
  workspace_id: UUID;
  entity_table: PermissionEntityTable;
  entity_id: UUID;
  principal_type: PrincipalType;
  principal_id: UUID | null;
  role: PermissionRole;
  created_at: Timestamp;
}

/** Numeric precedence used when multiple grants apply to one principal. */
export const WORKSPACE_ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = {
  owner: 4,
  admin: 3,
  member: 2,
  guest: 1,
};

/** Numeric precedence of entity-level permission roles. */
export const PERMISSION_ROLE_RANK: Readonly<Record<PermissionRole, number>> = {
  admin: 4,
  write: 3,
  comment: 2,
  read: 1,
};

/** Returns `true` when `actual` grants at least the authority of `required`. */
export function roleSatisfies(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_RANK[actual] >= WORKSPACE_ROLE_RANK[required];
}

/** Returns `true` when `actual` grants at least the authority of `required`. */
export function permissionSatisfies(
  actual: PermissionRole,
  required: PermissionRole,
): boolean {
  return PERMISSION_ROLE_RANK[actual] >= PERMISSION_ROLE_RANK[required];
}
