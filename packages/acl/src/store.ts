/**
 * Storage adapters implementing {@link AclStore}:
 *
 * 1. {@link DrizzleAclStore} — PostgreSQL-backed store powered by `@votion/db`.
 * 2. {@link InMemoryAclStore} — deterministic in-memory store with mutation
 *    helpers and cache invalidation hooks for tests and local prototyping.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  blocks,
  collections,
  permissions,
  workspaceMembers,
  workspaces,
  type VotionDatabase,
  type WorkspaceSettings,
} from '@votion/db';
import type { ParentTable, UUID, WorkspaceRole } from '@votion/types';

import type {
  AclBlockNode,
  AclCollectionNode,
  AclEntityTable,
  AclInvalidationEvent,
  AclPermissionMetadata,
  AclPermissionRule,
  AclStore,
  AclWorkspace,
  AclWorkspaceMember,
} from './types.js';

/** Optional hook resolving teamspace memberships for a user inside a workspace. */
export type TeamspaceResolver = (
  workspaceId: UUID,
  userId: UUID,
) => Promise<readonly UUID[]>;

/** Configuration accepted by {@link DrizzleAclStore}. */
export interface DrizzleAclStoreOptions {
  db: VotionDatabase;
  teamspaceResolver?: TeamspaceResolver;
}

/**
 * Production PostgreSQL {@link AclStore} backed by `@votion/db`'s Drizzle schema.
 */
export class DrizzleAclStore implements AclStore {
  private readonly db: VotionDatabase;
  private readonly teamspaceResolver: TeamspaceResolver | undefined;

  constructor(options: DrizzleAclStoreOptions) {
    this.db = options.db;
    this.teamspaceResolver = options.teamspaceResolver;
  }

  async getBlock(blockId: UUID): Promise<AclBlockNode | null> {
    const rows = await this.db
      .select({
        id: blocks.id,
        spaceId: blocks.spaceId,
        type: blocks.type,
        parentId: blocks.parentId,
        parentTable: blocks.parentTable,
        content: blocks.content,
        alive: blocks.alive,
        format: blocks.format,
      })
      .from(blocks)
      .where(eq(blocks.id, blockId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      spaceId: row.spaceId,
      type: row.type,
      parentId: row.parentId,
      parentTable: row.parentTable,
      content: row.content,
      alive: row.alive,
      format: row.format,
    };
  }

  async getCollection(collectionId: UUID): Promise<AclCollectionNode | null> {
    const rows = await this.db
      .select({
        id: collections.id,
        spaceId: collections.spaceId,
        parentId: collections.parentId,
        alive: collections.alive,
      })
      .from(collections)
      .where(eq(collections.id, collectionId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      spaceId: row.spaceId,
      parentId: row.parentId,
      alive: row.alive,
    };
  }

  async getWorkspace(workspaceId: UUID): Promise<AclWorkspace | null> {
    const rows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        domain: workspaces.domain,
        settings: workspaces.settings,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      settings: row.settings,
    };
  }

  async getWorkspaceByDomain(domain: string): Promise<AclWorkspace | null> {
    const normalized = domain.trim().toLowerCase();
    const rows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        domain: workspaces.domain,
        settings: workspaces.settings,
      })
      .from(workspaces)
      .where(sql`lower(${workspaces.domain}) = ${normalized}`)
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      settings: row.settings,
    };
  }

  async getWorkspaceMember(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<AclWorkspaceMember | null> {
    const rows = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role,
    };
  }

  async getPermissionsForEntity(
    workspaceId: UUID,
    entityTable: AclEntityTable,
    entityId: UUID,
  ): Promise<readonly AclPermissionRule[]> {
    const rows = await this.db
      .select({
        id: permissions.id,
        workspaceId: permissions.workspaceId,
        entityTable: permissions.entityTable,
        entityId: permissions.entityId,
        principalType: permissions.principalType,
        principalId: permissions.principalId,
        role: permissions.role,
        metadata: permissions.metadata,
        createdAt: permissions.createdAt,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.workspaceId, workspaceId),
          sql`${permissions.entityTable} = ${entityTable}`,
          eq(permissions.entityId, entityId),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      entityTable: row.entityTable as AclEntityTable,
      entityId: row.entityId,
      principalType: row.principalType,
      principalId: row.principalId,
      role: row.role,
      metadata: row.metadata as AclPermissionMetadata,
      createdAt: row.createdAt,
    }));
  }

  async getPublicPermissionBySlug(
    workspaceId: UUID,
    slug: string,
  ): Promise<AclPermissionRule | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    const rows = await this.db
      .select({
        id: permissions.id,
        workspaceId: permissions.workspaceId,
        entityTable: permissions.entityTable,
        entityId: permissions.entityId,
        principalType: permissions.principalType,
        principalId: permissions.principalId,
        role: permissions.role,
        metadata: permissions.metadata,
        createdAt: permissions.createdAt,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.workspaceId, workspaceId),
          eq(permissions.principalType, 'public'),
          isNull(permissions.principalId),
          sql`lower(${permissions.metadata}->>'public_slug') = ${normalizedSlug}`,
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      entityTable: row.entityTable as AclEntityTable,
      entityId: row.entityId,
      principalType: row.principalType,
      principalId: row.principalId,
      role: row.role,
      metadata: row.metadata as AclPermissionMetadata,
      createdAt: row.createdAt,
    };
  }

  async getPublicPermissionByCustomDomain(
    customDomain: string,
    slug?: string,
  ): Promise<AclPermissionRule | null> {
    const normalizedDomain = customDomain.trim().toLowerCase();
    const normalizedSlug = slug?.trim().toLowerCase();

    const condition =
      normalizedSlug && normalizedSlug.length > 0
        ? and(
            eq(permissions.principalType, 'public'),
            isNull(permissions.principalId),
            sql`lower(${permissions.metadata}->>'custom_domain') = ${normalizedDomain}`,
            sql`lower(${permissions.metadata}->>'public_slug') = ${normalizedSlug}`,
          )
        : and(
            eq(permissions.principalType, 'public'),
            isNull(permissions.principalId),
            sql`lower(${permissions.metadata}->>'custom_domain') = ${normalizedDomain}`,
          );

    const rows = await this.db
      .select({
        id: permissions.id,
        workspaceId: permissions.workspaceId,
        entityTable: permissions.entityTable,
        entityId: permissions.entityId,
        principalType: permissions.principalType,
        principalId: permissions.principalId,
        role: permissions.role,
        metadata: permissions.metadata,
        createdAt: permissions.createdAt,
      })
      .from(permissions)
      .where(condition)
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      entityTable: row.entityTable as AclEntityTable,
      entityId: row.entityId,
      principalType: row.principalType,
      principalId: row.principalId,
      role: row.role,
      metadata: row.metadata as AclPermissionMetadata,
      createdAt: row.createdAt,
    };
  }

  async getChildBlockIds(spaceId: UUID, parentId: UUID): Promise<readonly UUID[]> {
    const rows = await this.db
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.spaceId, spaceId), eq(blocks.parentId, parentId)));

    return rows.map((row) => row.id);
  }

  async getUserTeamspaceIds(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<readonly UUID[]> {
    if (!this.teamspaceResolver) {
      return [];
    }
    return this.teamspaceResolver(workspaceId, userId);
  }
}

/** Optional invalidation callback invoked whenever {@link InMemoryAclStore} mutates ACL state. */
export type InvalidationListener = (
  event: AclInvalidationEvent,
) => void | Promise<unknown>;

/**
 * Deterministic in-memory {@link AclStore} for unit tests and simulations.
 * Supports wiring cache invalidation listeners directly to permission mutations
 * and block reparenting operations.
 */
export class InMemoryAclStore implements AclStore {
  private readonly workspacesMap = new Map<UUID, AclWorkspace>();
  private readonly membersMap = new Map<string, AclWorkspaceMember>();
  private readonly blocksMap = new Map<UUID, AclBlockNode>();
  private readonly collectionsMap = new Map<UUID, AclCollectionNode>();
  private readonly permissionsMap = new Map<UUID, AclPermissionRule>();
  private readonly teamspaceMemberships = new Map<string, Set<UUID>>();
  private readonly invalidationListeners = new Set<InvalidationListener>();

  /** Registers an invalidation hook (e.g. `cache.createInvalidationHook(store)`). */
  onInvalidate(listener: InvalidationListener): () => void {
    this.invalidationListeners.add(listener);
    return () => {
      this.invalidationListeners.delete(listener);
    };
  }

  private async emitInvalidation(event: AclInvalidationEvent): Promise<void> {
    for (const listener of this.invalidationListeners) {
      await listener(event);
    }
  }

  addWorkspace(workspace: AclWorkspace): void {
    this.workspacesMap.set(workspace.id, {
      ...workspace,
      settings: { ...workspace.settings },
    });
  }

  async updateWorkspaceSettings(
    workspaceId: UUID,
    settings: WorkspaceSettings,
  ): Promise<void> {
    const existing = this.workspacesMap.get(workspaceId);
    if (!existing) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    this.workspacesMap.set(workspaceId, {
      ...existing,
      settings: { ...existing.settings, ...settings },
    });
    await this.emitInvalidation({
      type: 'workspace_settings_changed',
      spaceId: workspaceId,
    });
  }

  addWorkspaceMember(member: AclWorkspaceMember): void {
    this.membersMap.set(`${member.workspaceId}:${member.userId}`, { ...member });
  }

  async setWorkspaceMemberRole(
    workspaceId: UUID,
    userId: UUID,
    role: WorkspaceRole,
  ): Promise<void> {
    this.membersMap.set(`${workspaceId}:${userId}`, {
      workspaceId,
      userId,
      role,
    });
    await this.emitInvalidation({
      type: 'membership_changed',
      spaceId: workspaceId,
      userId,
    });
  }

  async removeWorkspaceMember(workspaceId: UUID, userId: UUID): Promise<void> {
    this.membersMap.delete(`${workspaceId}:${userId}`);
    await this.emitInvalidation({
      type: 'membership_changed',
      spaceId: workspaceId,
      userId,
    });
  }

  addUserToTeamspace(
    workspaceId: UUID,
    userId: UUID,
    teamspaceId: UUID,
  ): void {
    const key = `${workspaceId}:${userId}`;
    let set = this.teamspaceMemberships.get(key);
    if (!set) {
      set = new Set<UUID>();
      this.teamspaceMemberships.set(key, set);
    }
    set.add(teamspaceId);
  }

  addBlock(block: AclBlockNode): void {
    this.blocksMap.set(block.id, {
      ...block,
      content: [...block.content],
    });
    // Keep parent's `content` array in sync when parent block is already stored.
    if (block.parentTable === 'block') {
      const parent = this.blocksMap.get(block.parentId);
      if (parent && !parent.content.includes(block.id)) {
        this.blocksMap.set(parent.id, {
          ...parent,
          content: [...parent.content, block.id],
        });
      }
    }
  }

  async moveBlock(
    blockId: UUID,
    newParentId: UUID,
    newParentTable: ParentTable,
  ): Promise<void> {
    const block = this.blocksMap.get(blockId);
    if (!block) {
      throw new Error(`Block not found: ${blockId}`);
    }
    const previousParentId = block.parentId;
    if (block.parentTable === 'block') {
      const oldParent = this.blocksMap.get(previousParentId);
      if (oldParent) {
        this.blocksMap.set(oldParent.id, {
          ...oldParent,
          content: oldParent.content.filter((id) => id !== blockId),
        });
      }
    }

    this.blocksMap.set(blockId, {
      ...block,
      parentId: newParentId,
      parentTable: newParentTable,
    });

    if (newParentTable === 'block') {
      const newParent = this.blocksMap.get(newParentId);
      if (newParent && !newParent.content.includes(blockId)) {
        this.blocksMap.set(newParent.id, {
          ...newParent,
          content: [...newParent.content, blockId],
        });
      }
    }

    await this.emitInvalidation({
      type: 'block_moved',
      spaceId: block.spaceId,
      blockId,
      previousParentId,
      newParentId,
    });
  }

  async softDeleteBlock(blockId: UUID): Promise<void> {
    const block = this.blocksMap.get(blockId);
    if (!block) return;
    this.blocksMap.set(blockId, { ...block, alive: false });
    await this.emitInvalidation({
      type: 'block_moved',
      spaceId: block.spaceId,
      blockId,
    });
  }

  addCollection(collection: AclCollectionNode): void {
    this.collectionsMap.set(collection.id, { ...collection });
  }

  async setPermission(rule: AclPermissionRule): Promise<void> {
    this.permissionsMap.set(rule.id, {
      ...rule,
      metadata: rule.metadata ? { ...rule.metadata } : undefined,
    });
    await this.emitInvalidation({
      type: 'permission_changed',
      spaceId: rule.workspaceId,
      entityTable: rule.entityTable,
      entityId: rule.entityId,
      principalType: rule.principalType,
      principalId: rule.principalId,
    });
  }

  async removePermission(ruleId: UUID): Promise<boolean> {
    const existing = this.permissionsMap.get(ruleId);
    if (!existing) return false;
    this.permissionsMap.delete(ruleId);
    await this.emitInvalidation({
      type: 'permission_changed',
      spaceId: existing.workspaceId,
      entityTable: existing.entityTable,
      entityId: existing.entityId,
      principalType: existing.principalType,
      principalId: existing.principalId,
    });
    return true;
  }

  async getBlock(blockId: UUID): Promise<AclBlockNode | null> {
    return this.blocksMap.get(blockId) ?? null;
  }

  async getCollection(collectionId: UUID): Promise<AclCollectionNode | null> {
    return this.collectionsMap.get(collectionId) ?? null;
  }

  async getWorkspace(workspaceId: UUID): Promise<AclWorkspace | null> {
    return this.workspacesMap.get(workspaceId) ?? null;
  }

  async getWorkspaceByDomain(domain: string): Promise<AclWorkspace | null> {
    const normalized = domain.trim().toLowerCase();
    for (const workspace of this.workspacesMap.values()) {
      if (workspace.domain?.toLowerCase() === normalized) {
        return workspace;
      }
    }
    return null;
  }

  async getWorkspaceMember(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<AclWorkspaceMember | null> {
    return this.membersMap.get(`${workspaceId}:${userId}`) ?? null;
  }

  async getPermissionsForEntity(
    workspaceId: UUID,
    entityTable: AclEntityTable,
    entityId: UUID,
  ): Promise<readonly AclPermissionRule[]> {
    const matched: AclPermissionRule[] = [];
    for (const rule of this.permissionsMap.values()) {
      if (
        rule.workspaceId === workspaceId &&
        rule.entityTable === entityTable &&
        rule.entityId === entityId
      ) {
        matched.push(rule);
      }
    }
    return matched;
  }

  async getPublicPermissionBySlug(
    workspaceId: UUID,
    slug: string,
  ): Promise<AclPermissionRule | null> {
    const normalized = slug.trim().toLowerCase();
    for (const rule of this.permissionsMap.values()) {
      if (
        rule.workspaceId === workspaceId &&
        rule.principalType === 'public' &&
        rule.principalId === null &&
        rule.metadata?.public_slug?.toLowerCase() === normalized
      ) {
        return rule;
      }
    }
    return null;
  }

  async getPublicPermissionByCustomDomain(
    customDomain: string,
    slug?: string,
  ): Promise<AclPermissionRule | null> {
    const normalizedDomain = customDomain.trim().toLowerCase();
    const normalizedSlug = slug?.trim().toLowerCase();

    for (const rule of this.permissionsMap.values()) {
      if (
        rule.principalType !== 'public' ||
        rule.principalId !== null ||
        rule.metadata?.custom_domain?.toLowerCase() !== normalizedDomain
      ) {
        continue;
      }
      if (normalizedSlug && normalizedSlug.length > 0) {
        if (rule.metadata?.public_slug?.toLowerCase() === normalizedSlug) {
          return rule;
        }
      } else {
        return rule;
      }
    }
    return null;
  }

  async getChildBlockIds(spaceId: UUID, parentId: UUID): Promise<readonly UUID[]> {
    const children: UUID[] = [];
    for (const block of this.blocksMap.values()) {
      if (block.spaceId === spaceId && block.parentId === parentId) {
        children.push(block.id);
      }
    }
    return children;
  }

  async getUserTeamspaceIds(
    workspaceId: UUID,
    userId: UUID,
  ): Promise<readonly UUID[]> {
    const set = this.teamspaceMemberships.get(`${workspaceId}:${userId}`);
    return set ? Array.from(set) : [];
  }
}
