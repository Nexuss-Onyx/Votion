/**
 * Recursive upward hierarchy graph traverser for Votion permissions.
 *
 * Walks `block -> parent block / collection -> ... -> space (workspace)` to
 * resolve the effective entity permission for a user (or anonymous visitor),
 * applying security-by-default semantics (DENY on any unresolved, deleted,
 * cyclic, or cross-workspace path).
 */

import { PERMISSION_ROLE_RANK, type PermissionRole, type UUID } from '@votion/types';

import type { InheritanceCache } from './InheritanceCache.js';
import { isPermissionGrantActive, workspaceRoleToPermission } from './roles.js';
import type {
  AclBlockNode,
  AclEntityTable,
  AclPermissionRule,
  AclStore,
  PermissionResolution,
  PermissionResolutionReason,
  PermissionResolutionSource,
  TraversalStep,
  TraverseOptions,
} from './types.js';

/** Default maximum number of upward hops before failing closed. */
export const DEFAULT_MAX_TRAVERSAL_DEPTH = 64;

/** Configuration accepted by {@link Traverser}. */
export interface TraverserOptions {
  store: AclStore;
  cache?: InheritanceCache;
  maxDepth?: number;
  /** Injectable clock for deterministic grant-expiration checks. */
  now?: () => Date;
}

interface PublicFallbackMatch {
  ruleId: UUID;
  entityTable: AclEntityTable;
  entityId: UUID;
}

function pickHighestPrivilegeRule(
  rules: readonly AclPermissionRule[],
): AclPermissionRule | null {
  let best: AclPermissionRule | null = null;
  for (const rule of rules) {
    if (
      best === null ||
      PERMISSION_ROLE_RANK[rule.role] > PERMISSION_ROLE_RANK[best.role]
    ) {
      best = rule;
    }
  }
  return best;
}

function buildDeniedResolution(
  spaceId: UUID | null,
  reason: PermissionResolutionReason,
  path: readonly TraversalStep[],
  source: PermissionResolutionSource = 'denied',
  resolvedAtEntityTable: AclEntityTable | null = null,
  resolvedAtEntityId: UUID | null = null,
): PermissionResolution {
  return {
    role: null,
    allowed: false,
    spaceId,
    source,
    reason,
    resolvedAtEntityTable,
    resolvedAtEntityId,
    path,
    fromCache: false,
  };
}

function buildGrantedResolution(
  role: PermissionRole,
  spaceId: UUID,
  source: PermissionResolutionSource,
  resolvedAtEntityTable: AclEntityTable,
  resolvedAtEntityId: UUID,
  path: readonly TraversalStep[],
): PermissionResolution {
  return {
    role,
    allowed: true,
    spaceId,
    source,
    reason: 'granted',
    resolvedAtEntityTable,
    resolvedAtEntityId,
    path,
    fromCache: false,
  };
}

/**
 * Resolves effective entity permissions by climbing parent pointers from blocks
 * (and collections) up to the owning workspace root.
 */
export class Traverser {
  private readonly store: AclStore;
  private readonly cache: InheritanceCache | undefined;
  private readonly maxDepth: number;
  private readonly now: () => Date;

  constructor(options: TraverserOptions) {
    this.store = options.store;
    this.cache = options.cache;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_TRAVERSAL_DEPTH;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Resolves the effective permission of `userId` (or `null` for anonymous
   * access) on `blockId`.
   */
  async resolveBlockPermission(
    userId: UUID | null,
    blockId: UUID,
    options: TraverseOptions = {},
  ): Promise<PermissionResolution> {
    const rootBlock = await this.store.getBlock(blockId);
    if (!rootBlock) {
      return buildDeniedResolution(null, 'entity_not_found', []);
    }
    if (!rootBlock.alive) {
      return buildDeniedResolution(rootBlock.spaceId, 'entity_deleted', [
        { entityTable: 'block', entityId: blockId, depth: 0 },
      ]);
    }

    return this.resolveWithCache(
      rootBlock.spaceId,
      userId,
      'block',
      blockId,
      options,
      rootBlock,
    );
  }

  /** Resolves the effective permission of `userId` on a `collection`. */
  async resolveCollectionPermission(
    userId: UUID | null,
    collectionId: UUID,
    options: TraverseOptions = {},
  ): Promise<PermissionResolution> {
    const collection = await this.store.getCollection(collectionId);
    if (!collection) {
      return buildDeniedResolution(null, 'entity_not_found', []);
    }
    if (!collection.alive) {
      return buildDeniedResolution(collection.spaceId, 'entity_deleted', [
        { entityTable: 'collection', entityId: collectionId, depth: 0 },
      ]);
    }

    return this.resolveWithCache(
      collection.spaceId,
      userId,
      'collection',
      collectionId,
      options,
    );
  }

  /** Resolves the effective permission of `userId` on a workspace (`space`). */
  async resolveSpacePermission(
    userId: UUID | null,
    spaceId: UUID,
    options: TraverseOptions = {},
  ): Promise<PermissionResolution> {
    const workspace = await this.store.getWorkspace(spaceId);
    if (!workspace) {
      return buildDeniedResolution(null, 'entity_not_found', []);
    }

    return this.resolveWithCache(spaceId, userId, 'space', spaceId, options);
  }

  /** Generic entry point dispatching by `entityTable`. */
  async resolvePermission(
    userId: UUID | null,
    entityTable: AclEntityTable,
    entityId: UUID,
    options: TraverseOptions = {},
  ): Promise<PermissionResolution> {
    switch (entityTable) {
      case 'block':
        return this.resolveBlockPermission(userId, entityId, options);
      case 'collection':
        return this.resolveCollectionPermission(userId, entityId, options);
      case 'space':
        return this.resolveSpacePermission(userId, entityId, options);
    }
  }

  private async resolveWithCache(
    spaceId: UUID,
    userId: UUID | null,
    entityTable: AclEntityTable,
    entityId: UUID,
    options: TraverseOptions,
    prefetchedBlock?: AclBlockNode,
  ): Promise<PermissionResolution> {
    if (this.cache && !options.bypassCache) {
      const cached = await this.cache.get(spaceId, userId, entityId);
      if (cached !== null) {
        return {
          role: cached.role,
          allowed: cached.role !== null,
          spaceId,
          source: cached.source,
          reason: cached.reason,
          resolvedAtEntityTable: cached.resolvedAtEntityTable,
          resolvedAtEntityId: cached.resolvedAtEntityId,
          path: [],
          fromCache: true,
        };
      }
    }

    const teamspaceIds =
      userId === null
        ? []
        : (options.teamspaceIds ??
          (this.store.getUserTeamspaceIds
            ? await this.store.getUserTeamspaceIds(spaceId, userId)
            : []));

    const resolution = await this.traverseUpward({
      spaceId,
      userId,
      startTable: entityTable,
      startId: entityId,
      prefetchedBlock,
      teamspaceSet: new Set(teamspaceIds),
      includePublicFallback: options.includePublicFallback ?? true,
    });

    if (this.cache && !options.bypassCache) {
      await this.cache.set(spaceId, userId, entityId, {
        role: resolution.role,
        source: resolution.source,
        reason: resolution.reason,
        resolvedAtEntityTable: resolution.resolvedAtEntityTable,
        resolvedAtEntityId: resolution.resolvedAtEntityId,
      });
    }

    return resolution;
  }

  private async isPublicSharingAllowed(spaceId: UUID): Promise<boolean> {
    const workspace = await this.store.getWorkspace(spaceId);
    if (!workspace) {
      return false;
    }
    return workspace.settings?.disable_public_sharing !== true;
  }

  private async traverseUpward(params: {
    spaceId: UUID;
    userId: UUID | null;
    startTable: AclEntityTable;
    startId: UUID;
    prefetchedBlock?: AclBlockNode;
    teamspaceSet: ReadonlySet<UUID>;
    includePublicFallback: boolean;
  }): Promise<PermissionResolution> {
    const {
      spaceId,
      userId,
      startTable,
      startId,
      prefetchedBlock,
      teamspaceSet,
      includePublicFallback,
    } = params;

    const visited = new Set<string>();
    const path: TraversalStep[] = [];
    const currentNow = this.now();
    let publicFallback: PublicFallbackMatch | null = null;

    const climb = async (
      currentTable: AclEntityTable,
      currentId: UUID,
      depth: number,
      loadedBlock?: AclBlockNode,
    ): Promise<PermissionResolution> => {
      if (depth > this.maxDepth) {
        return buildDeniedResolution(spaceId, 'max_depth_exceeded', path);
      }

      const visitKey = `${currentTable}:${currentId}`;
      if (visited.has(visitKey)) {
        return buildDeniedResolution(spaceId, 'cycle_detected', path);
      }
      visited.add(visitKey);

      const step: TraversalStep = {
        entityTable: currentTable,
        entityId: currentId,
        depth,
      };
      path.push(step);

      // 1. Evaluate explicit rows in `permissions` for this entity.
      const rawRules = await this.store.getPermissionsForEntity(
        spaceId,
        currentTable,
        currentId,
      );
      const activeRules = rawRules.filter((rule) =>
        isPermissionGrantActive(rule, currentNow),
      );

      if (userId !== null) {
        // 1a. Direct user override (highest precedence at this node).
        const userRules = activeRules.filter(
          (rule) =>
            rule.principalType === 'user' && rule.principalId === userId,
        );
        if (userRules.length > 0) {
          const explicitDeny = userRules.find(
            (rule) => rule.metadata?.deny === true,
          );
          if (explicitDeny) {
            step.matchedRuleId = explicitDeny.id;
            step.matchedPrincipalType = 'user';
            step.matchedRole = null;
            return buildDeniedResolution(
              spaceId,
              'explicit_deny',
              path,
              'explicit_deny',
              currentTable,
              currentId,
            );
          }

          const bestUserRule = pickHighestPrivilegeRule(userRules);
          if (bestUserRule) {
            step.matchedRuleId = bestUserRule.id;
            step.matchedPrincipalType = 'user';
            step.matchedRole = bestUserRule.role;
            return buildGrantedResolution(
              bestUserRule.role,
              spaceId,
              'explicit_user',
              currentTable,
              currentId,
              path,
            );
          }
        }

        // 1b. Teamspace override.
        if (teamspaceSet.size > 0) {
          const teamspaceRules = activeRules.filter(
            (rule) =>
              rule.principalType === 'teamspace' &&
              rule.principalId !== null &&
              teamspaceSet.has(rule.principalId),
          );
          if (teamspaceRules.length > 0) {
            const explicitDeny = teamspaceRules.find(
              (rule) => rule.metadata?.deny === true,
            );
            if (explicitDeny) {
              step.matchedRuleId = explicitDeny.id;
              step.matchedPrincipalType = 'teamspace';
              step.matchedRole = null;
              return buildDeniedResolution(
                spaceId,
                'explicit_deny',
                path,
                'explicit_deny',
                currentTable,
                currentId,
              );
            }

            const bestTeamspaceRule = pickHighestPrivilegeRule(teamspaceRules);
            if (bestTeamspaceRule) {
              step.matchedRuleId = bestTeamspaceRule.id;
              step.matchedPrincipalType = 'teamspace';
              step.matchedRole = bestTeamspaceRule.role;
              return buildGrantedResolution(
                bestTeamspaceRule.role,
                spaceId,
                'explicit_teamspace',
                currentTable,
                currentId,
                path,
              );
            }
          }
        }

        // 1c. Remember closest public rule as fallback (never downgrades a workspace/user grant).
        if (publicFallback === null) {
          const publicRule = activeRules.find(
            (rule) =>
              rule.principalType === 'public' &&
              rule.principalId === null &&
              rule.metadata?.deny !== true,
          );
          if (publicRule) {
            publicFallback = {
              ruleId: publicRule.id,
              entityTable: currentTable,
              entityId: currentId,
            };
          }
        }
      } else {
        // Anonymous visitor: only explicit `public` rules can grant access (always read-only).
        const publicRules = activeRules.filter(
          (rule) => rule.principalType === 'public' && rule.principalId === null,
        );
        if (publicRules.length > 0) {
          const explicitDeny = publicRules.find(
            (rule) => rule.metadata?.deny === true,
          );
          if (explicitDeny) {
            step.matchedRuleId = explicitDeny.id;
            step.matchedPrincipalType = 'public';
            step.matchedRole = null;
            return buildDeniedResolution(
              spaceId,
              'explicit_deny',
              path,
              'explicit_deny',
              currentTable,
              currentId,
            );
          }

          if (!(await this.isPublicSharingAllowed(spaceId))) {
            return buildDeniedResolution(
              spaceId,
              'public_sharing_disabled',
              path,
              'denied',
              currentTable,
              currentId,
            );
          }

          const matchedRule = publicRules[0];
          if (matchedRule) {
            step.matchedRuleId = matchedRule.id;
            step.matchedPrincipalType = 'public';
            step.matchedRole = 'read';
            return buildGrantedResolution(
              'read',
              spaceId,
              'public',
              currentTable,
              currentId,
              path,
            );
          }
        }
      }

      // 2. No terminating rule at current node — climb to parent.
      if (currentTable === 'block') {
        const block = loadedBlock ?? (await this.store.getBlock(currentId));
        if (!block) {
          return buildDeniedResolution(spaceId, 'parent_not_found', path);
        }
        if (!block.alive) {
          return buildDeniedResolution(spaceId, 'parent_deleted', path);
        }
        if (block.spaceId !== spaceId) {
          return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
        }

        switch (block.parentTable) {
          case 'block': {
            const parentBlock = await this.store.getBlock(block.parentId);
            if (!parentBlock) {
              return buildDeniedResolution(spaceId, 'parent_not_found', path);
            }
            if (!parentBlock.alive) {
              return buildDeniedResolution(spaceId, 'parent_deleted', path);
            }
            if (parentBlock.spaceId !== spaceId) {
              return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
            }
            return climb('block', parentBlock.id, depth + 1, parentBlock);
          }

          case 'collection': {
            const collection = await this.store.getCollection(block.parentId);
            if (!collection) {
              return buildDeniedResolution(spaceId, 'parent_not_found', path);
            }
            if (!collection.alive) {
              return buildDeniedResolution(spaceId, 'parent_deleted', path);
            }
            if (collection.spaceId !== spaceId) {
              return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
            }
            return climb('collection', collection.id, depth + 1);
          }

          case 'space': {
            if (block.parentId !== spaceId) {
              return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
            }
            return climb('space', block.parentId, depth + 1);
          }
        }
      }

      if (currentTable === 'collection') {
        const collection = await this.store.getCollection(currentId);
        if (!collection) {
          return buildDeniedResolution(spaceId, 'parent_not_found', path);
        }
        if (!collection.alive) {
          return buildDeniedResolution(spaceId, 'parent_deleted', path);
        }
        if (collection.spaceId !== spaceId) {
          return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
        }

        // Collections are typically parented to a `collection_view` block, or directly to the workspace.
        const parentBlock = await this.store.getBlock(collection.parentId);
        if (parentBlock) {
          if (!parentBlock.alive) {
            return buildDeniedResolution(spaceId, 'parent_deleted', path);
          }
          if (parentBlock.spaceId !== spaceId) {
            return buildDeniedResolution(spaceId, 'workspace_mismatch', path);
          }
          return climb('block', parentBlock.id, depth + 1, parentBlock);
        }

        if (collection.parentId === spaceId) {
          return climb('space', spaceId, depth + 1);
        }

        return buildDeniedResolution(spaceId, 'parent_not_found', path);
      }

      // currentTable === 'space': evaluate workspace membership.
      if (userId === null) {
        return buildDeniedResolution(
          spaceId,
          'anonymous_no_public_grant',
          path,
        );
      }

      const member = await this.store.getWorkspaceMember(spaceId, userId);
      if (member) {
        const defaultRole = workspaceRoleToPermission(member.role);
        if (defaultRole !== null) {
          step.matchedRole = defaultRole;
          return buildGrantedResolution(
            defaultRole,
            spaceId,
            'workspace_member',
            'space',
            spaceId,
            path,
          );
        }
      }

      // Authenticated non-member or guest: fall back to ancestor public grant (read-only) if allowed.
      if (includePublicFallback && publicFallback !== null) {
        if (!(await this.isPublicSharingAllowed(spaceId))) {
          return buildDeniedResolution(
            spaceId,
            'public_sharing_disabled',
            path,
            'denied',
            publicFallback.entityTable,
            publicFallback.entityId,
          );
        }
        return buildGrantedResolution(
          'read',
          spaceId,
          'public',
          publicFallback.entityTable,
          publicFallback.entityId,
          path,
        );
      }

      return buildDeniedResolution(
        spaceId,
        member ? 'guest_no_explicit_grant' : 'not_a_member',
        path,
      );
    };

    return climb(startTable, startId, 0, prefetchedBlock);
  }
}
