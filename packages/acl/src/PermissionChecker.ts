/**
 * Role capability checker & workspace RBAC enforcement engine.
 *
 * Exposes ergonomic boolean checks (`canRead`, `canComment`, `canWrite`,
 * `canAdmin`) plus granular capability checks and workspace RBAC evaluation.
 * All checks fail closed (`false`) whenever access cannot be positively verified.
 */

import {
  permissionSatisfies,
  roleSatisfies,
  type PermissionRole,
  type PrincipalType,
  type UUID,
  type WorkspaceRole,
} from '@votion/types';

import type { InheritanceCache } from './InheritanceCache.js';
import {
  ROLE_CAPABILITIES,
  hasEntityCapability,
  hasWorkspaceCapability,
  type EntityCapability,
  type WorkspaceCapability,
} from './roles.js';
import { Traverser } from './Traverser.js';
import type {
  AclEntityTable,
  AclInvalidationEvent,
  AclStore,
  PermissionResolution,
  TraverseOptions,
} from './types.js';

/** Typed authorization error raised by {@link PermissionChecker.assertPermission}. */
export class PermissionDeniedError extends Error {
  readonly statusCode = 403;
  readonly userId: UUID | null;
  readonly blockId: UUID;
  readonly requiredRole: PermissionRole;
  readonly resolution: PermissionResolution;

  constructor(
    userId: UUID | null,
    blockId: UUID,
    requiredRole: PermissionRole,
    resolution: PermissionResolution,
  ) {
    super(
      `Permission denied: requires "${requiredRole}" on block "${blockId}" (actual: ${resolution.role ?? 'none'}, reason: ${resolution.reason})`,
    );
    this.name = 'PermissionDeniedError';
    this.userId = userId;
    this.blockId = blockId;
    this.requiredRole = requiredRole;
    this.resolution = resolution;
  }
}

/** Configuration accepted by {@link PermissionChecker}. */
export interface PermissionCheckerOptions {
  store: AclStore;
  traverser?: Traverser;
  cache?: InheritanceCache;
  maxDepth?: number;
  now?: () => Date;
}

/**
 * Evaluates entity-level permissions (`read`, `comment`, `write`, `admin`) and
 * workspace-level RBAC (`owner`, `admin`, `member`, `guest`).
 */
export class PermissionChecker {
  readonly store: AclStore;
  readonly traverser: Traverser;
  readonly cache: InheritanceCache | undefined;

  constructor(options: PermissionCheckerOptions) {
    this.store = options.store;
    this.cache = options.cache;
    this.traverser =
      options.traverser ??
      new Traverser({
        store: options.store,
        cache: options.cache,
        maxDepth: options.maxDepth,
        now: options.now,
      });
  }

  /** Returns the full permission resolution audit trail for `(userId, blockId)`. */
  async resolve(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<PermissionResolution> {
    return this.traverser.resolveBlockPermission(userId, blockId, options);
  }

  /** Returns the resolved {@link PermissionRole} or `null` when denied. */
  async getEffectivePermission(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<PermissionRole | null> {
    const resolution = await this.resolve(userId, blockId, options);
    return resolution.role;
  }

  /** Returns `true` iff `userId` has at least `read` access to `blockId`. */
  async canRead(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<boolean> {
    const role = await this.getEffectivePermission(userId, blockId, options);
    return hasEntityCapability(role, 'read');
  }

  /** Returns `true` iff `userId` has at least `comment` access to `blockId`. */
  async canComment(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<boolean> {
    const role = await this.getEffectivePermission(userId, blockId, options);
    return hasEntityCapability(role, 'comment');
  }

  /** Returns `true` iff `userId` has at least `write` access to `blockId`. */
  async canWrite(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<boolean> {
    const role = await this.getEffectivePermission(userId, blockId, options);
    return hasEntityCapability(role, 'write');
  }

  /** Returns `true` iff `userId` has `admin` access to `blockId`. */
  async canAdmin(
    userId: UUID | null,
    blockId: UUID,
    options?: TraverseOptions,
  ): Promise<boolean> {
    const role = await this.getEffectivePermission(userId, blockId, options);
    return hasEntityCapability(role, 'manage_permissions');
  }

  /** Checks any granular entity capability (`read`, `export`, `comment`, `write`, `create_child`, `delete`, `manage_permissions`). */
  async hasCapability(
    userId: UUID | null,
    blockId: UUID,
    capability: EntityCapability,
    options?: TraverseOptions,
  ): Promise<boolean> {
    const role = await this.getEffectivePermission(userId, blockId, options);
    return hasEntityCapability(role, capability);
  }

  /**
   * Asserts that `userId` holds at least `requiredRole` on `blockId`, throwing
   * {@link PermissionDeniedError} (HTTP 403) otherwise.
   */
  async assertPermission(
    userId: UUID | null,
    blockId: UUID,
    requiredRole: PermissionRole,
    options?: TraverseOptions,
  ): Promise<PermissionResolution> {
    const resolution = await this.resolve(userId, blockId, options);
    if (
      resolution.role === null ||
      !permissionSatisfies(resolution.role, requiredRole)
    ) {
      throw new PermissionDeniedError(
        userId,
        blockId,
        requiredRole,
        resolution,
      );
    }
    return resolution;
  }

  /** Returns the user's role in `workspaceId`, or `null` if not a member. */
  async getWorkspaceRole(
    userId: UUID,
    workspaceId: UUID,
  ): Promise<WorkspaceRole | null> {
    const member = await this.store.getWorkspaceMember(workspaceId, userId);
    return member ? member.role : null;
  }

  /** Returns `true` iff the user's workspace role satisfies `minimumRole` (fails closed). */
  async hasWorkspaceRole(
    userId: UUID,
    workspaceId: UUID,
    minimumRole: WorkspaceRole,
  ): Promise<boolean> {
    const actualRole = await this.getWorkspaceRole(userId, workspaceId);
    if (actualRole === null) {
      return false;
    }
    return roleSatisfies(actualRole, minimumRole);
  }

  /** Evaluates a workspace-level RBAC capability taking workspace settings into account. */
  async canPerformWorkspaceAction(
    userId: UUID,
    workspaceId: UUID,
    capability: WorkspaceCapability,
  ): Promise<boolean> {
    const [member, workspace] = await Promise.all([
      this.store.getWorkspaceMember(workspaceId, userId),
      this.store.getWorkspace(workspaceId),
    ]);
    if (!member || !workspace) {
      return false;
    }
    return hasWorkspaceCapability(member.role, capability, workspace.settings);
  }

  /** Invalidates cached permissions in response to a graph or policy mutation. */
  async invalidateOnEvent(event: AclInvalidationEvent): Promise<number> {
    if (!this.cache) {
      return 0;
    }
    return this.cache.handleInvalidationEvent(event, this.store);
  }

  /** Convenience hook for permission row insert/update/delete mutations. */
  async onPermissionChanged(params: {
    spaceId: UUID;
    entityTable: AclEntityTable;
    entityId: UUID;
    principalType?: PrincipalType;
    principalId?: UUID | null;
  }): Promise<number> {
    return this.invalidateOnEvent({
      type: 'permission_changed',
      ...params,
    });
  }

  /** Convenience hook when a block is reparented/moved within a workspace. */
  async onBlockMoved(params: {
    spaceId: UUID;
    blockId: UUID;
    previousParentId?: UUID;
    newParentId?: UUID;
  }): Promise<number> {
    return this.invalidateOnEvent({
      type: 'block_moved',
      ...params,
    });
  }

  /** Convenience hook when a user's workspace membership role changes or is revoked. */
  async onMembershipChanged(spaceId: UUID, userId: UUID): Promise<number> {
    return this.invalidateOnEvent({
      type: 'membership_changed',
      spaceId,
      userId,
    });
  }

  /** Convenience hook when workspace-wide settings (e.g. public sharing toggle) change. */
  async onWorkspaceSettingsChanged(spaceId: UUID): Promise<number> {
    return this.invalidateOnEvent({
      type: 'workspace_settings_changed',
      spaceId,
    });
  }
}

export { ROLE_CAPABILITIES };
