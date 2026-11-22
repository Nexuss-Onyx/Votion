/**
 * Core type contracts for `@votion/acl`.
 *
 * Keeps the permission graph engine decoupled from any specific database driver
 * or Redis client while remaining structurally aligned with `@votion/types` and
 * `@votion/db`.
 */

import type { WorkspaceSettings } from '@votion/db';
import type {
  BlockType,
  ParentTable,
  PermissionEntityTable,
  PermissionRole,
  PrincipalType,
  UUID,
  WorkspaceRole,
} from '@votion/types';

/**
 * Tables that can be traversed or hold explicit ACL rules.
 * Extends `@votion/types`'s `PermissionEntityTable` with `'collection'` so
 * collection-level permission overrides are evaluated during upward traversal.
 */
export type AclEntityTable = PermissionEntityTable | 'collection';

/**
 * Minimal block record required to traverse the parent hierarchy and collect
 * descendants for cache invalidation.
 */
export interface AclBlockNode {
  id: UUID;
  spaceId: UUID;
  type: BlockType;
  parentId: UUID;
  parentTable: ParentTable;
  content: readonly UUID[];
  alive: boolean;
  format?: Record<string, unknown>;
}

/** Minimal collection record required when a block's parent is a collection. */
export interface AclCollectionNode {
  id: UUID;
  spaceId: UUID;
  /** Block ID of the owning `collection_view` block (or workspace ID for root collections). */
  parentId: UUID;
  alive: boolean;
}

/** Minimal workspace record required for tenancy, domain lookup, and sharing policy. */
export interface AclWorkspace {
  id: UUID;
  name: string;
  domain: string | null;
  settings: WorkspaceSettings;
}

/** Workspace membership record (`workspace_members` table). */
export interface AclWorkspaceMember {
  workspaceId: UUID;
  userId: UUID;
  role: WorkspaceRole;
}

/**
 * Extra metadata stored on a `permissions` row (`permissions.metadata` JSONB).
 */
export interface AclPermissionMetadata {
  /** When `true`, this rule acts as an explicit DENY override halting upward inheritance. */
  deny?: boolean;
  /** Optional grant expiration (ISO-8601 string or epoch milliseconds). */
  expires_at?: string | number | null;
  /** Custom public web slug for public page sharing (e.g. `"my-public-doc"`). */
  public_slug?: string;
  /** Whether search engines are allowed to index this public page (defaults to `false`). */
  allow_search_indexing?: boolean;
  /** Whether visitors can duplicate this public page as a template (defaults to `false`). */
  allow_duplicate_as_template?: boolean;
  /** Optional custom domain mapped to this public page (e.g. `"docs.acme.com"`). */
  custom_domain?: string;
  /** Optional share-link token hash. */
  share_token_hash?: string;
  [key: string]: unknown;
}

/** Explicit entity-level ACL rule (`permissions` table). */
export interface AclPermissionRule {
  id: UUID;
  workspaceId: UUID;
  entityTable: AclEntityTable;
  entityId: UUID;
  principalType: PrincipalType;
  /** `null` when `principalType === 'public'`. */
  principalId: UUID | null;
  role: PermissionRole;
  metadata?: AclPermissionMetadata;
  createdAt?: Date;
}

/** Single hop recorded while walking up the entity hierarchy. */
export interface TraversalStep {
  entityTable: AclEntityTable;
  entityId: UUID;
  depth: number;
  matchedRuleId?: UUID;
  matchedPrincipalType?: PrincipalType;
  matchedRole?: PermissionRole | null;
}

/** Where a resolved permission decision originated. */
export type PermissionResolutionSource =
  | 'explicit_user'
  | 'explicit_teamspace'
  | 'explicit_deny'
  | 'workspace_member'
  | 'public'
  | 'cache'
  | 'denied';

/** Machine-readable reason explaining why access was granted or denied. */
export type PermissionResolutionReason =
  | 'granted'
  | 'explicit_deny'
  | 'entity_not_found'
  | 'entity_deleted'
  | 'parent_not_found'
  | 'parent_deleted'
  | 'workspace_mismatch'
  | 'not_a_member'
  | 'guest_no_explicit_grant'
  | 'public_sharing_disabled'
  | 'cycle_detected'
  | 'max_depth_exceeded'
  | 'anonymous_no_public_grant';

/** Full audit result returned by the recursive permission traverser. */
export interface PermissionResolution {
  /** Resolved entity permission role, or `null` when denied (security by default). */
  role: PermissionRole | null;
  /** Convenience flag: `true` iff `role !== null`. */
  allowed: boolean;
  /** Workspace ID that owns the target entity, or `null` if entity was not found. */
  spaceId: UUID | null;
  source: PermissionResolutionSource;
  reason: PermissionResolutionReason;
  resolvedAtEntityTable: AclEntityTable | null;
  resolvedAtEntityId: UUID | null;
  /** Ordered hops visited from the target entity upward to the deciding ancestor. */
  path: readonly TraversalStep[];
  /** `true` when satisfied from the Redis inheritance cache. */
  fromCache: boolean;
}

/** Optional per-call controls for permission resolution. */
export interface TraverseOptions {
  /** Explicit teamspace IDs the user belongs to (avoids an extra store lookup when known). */
  teamspaceIds?: readonly UUID[];
  /** Skip reading from the inheritance cache and re-traverse the graph. */
  bypassCache?: boolean;
  /**
   * When `true` (default), an authenticated user with no workspace/user/teamspace
   * grant may fall back to an ancestor `public` grant as read-only (`'read'`).
   * Set to `false` to enforce strict workspace/explicit membership checks.
   */
  includePublicFallback?: boolean;
}

/**
 * Storage contract consumed by `Traverser`, `PermissionChecker`, `InheritanceCache`,
 * and `PublicAccessGateway`. Implemented by `DrizzleAclStore` (PostgreSQL) and
 * `InMemoryAclStore` (deterministic unit tests).
 */
export interface AclStore {
  getBlock(blockId: UUID): Promise<AclBlockNode | null>;
  getCollection(collectionId: UUID): Promise<AclCollectionNode | null>;
  getWorkspace(workspaceId: UUID): Promise<AclWorkspace | null>;
  getWorkspaceByDomain(domain: string): Promise<AclWorkspace | null>;
  getWorkspaceMember(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<AclWorkspaceMember | null>;
  getPermissionsForEntity(
    workspaceId: UUID,
    entityTable: AclEntityTable,
    entityId: UUID,
  ): Promise<readonly AclPermissionRule[]>;
  getPublicPermissionBySlug(
    workspaceId: UUID,
    slug: string,
  ): Promise<AclPermissionRule | null>;
  getPublicPermissionByCustomDomain?(
    customDomain: string,
    slug?: string,
  ): Promise<AclPermissionRule | null>;
  getChildBlockIds(spaceId: UUID, parentId: UUID): Promise<readonly UUID[]>;
  getUserTeamspaceIds?(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<readonly UUID[]>;
}

/**
 * Events that mutate the permission graph and require immediate cache invalidation.
 */
export type AclInvalidationEvent =
  | {
      type: 'permission_changed';
      spaceId: UUID;
      entityTable: AclEntityTable;
      entityId: UUID;
      principalType?: PrincipalType;
      principalId?: UUID | null;
    }
  | {
      type: 'block_moved';
      spaceId: UUID;
      blockId: UUID;
      previousParentId?: UUID;
      newParentId?: UUID;
    }
  | {
      type: 'membership_changed';
      spaceId: UUID;
      userId: UUID;
    }
  | {
      type: 'workspace_settings_changed';
      spaceId: UUID;
    };

/**
 * Minimal structural Redis contract satisfied by `ioredis` (`Redis`) and
 * `InMemoryRedisClient` for testing.
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string | number,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[cursor: string, keys: string[]]>;
}
