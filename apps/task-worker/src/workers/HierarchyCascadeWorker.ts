import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  blocks as blocksTable,
  permissions as permissionsTable,
  type VotionDatabase,
} from '@votion/db';
import type { Block, Permission, UUID } from '@votion/types';

import {
  HIERARCHY_CASCADE_QUEUE_NAME,
  type HierarchyCascadeJobData,
  type HierarchyCascadeJobResult,
  type PermissionOverrideRule,
} from '../queues/hierarchy-cascade.queue.js';

export const DEFAULT_CASCADE_BATCH_SIZE = 500;

export interface CascadeBlockNode {
  id: UUID;
  space_id: UUID;
  parent_id: UUID;
  content: UUID[];
  alive: boolean;
  version: number;
}

export interface HierarchyCascadeStore {
  /** Fetches blocks by their UUIDs within a space. */
  getBlocksByIds(spaceId: UUID, ids: readonly UUID[]): Promise<CascadeBlockNode[]>;
  /** Fetches direct children whose `parent_id` is in `parentIds`. */
  getBlocksByParentIds(
    spaceId: UUID,
    parentIds: readonly UUID[],
  ): Promise<CascadeBlockNode[]>;
  /**
   * Updates `alive` status for a batch of block IDs.
   * Returns the subset of block IDs whose `alive` state actually changed
   * (or were updated) to ensure idempotence.
   */
  setBlocksAliveBatch(
    spaceId: UUID,
    blockIds: readonly UUID[],
    alive: boolean,
    actorId?: UUID,
  ): Promise<UUID[]>;
  /**
   * Idempotently applies permission overrides to a batch of block IDs.
   * Retries must update existing overrides rather than duplicating rows.
   */
  applyPermissionOverridesBatch(
    workspaceId: UUID,
    blockIds: readonly UUID[],
    overrides: readonly PermissionOverrideRule[],
    replaceExisting?: boolean,
  ): Promise<UUID[]>;
}

/**
 * In-memory implementation of {@link HierarchyCascadeStore} backed by `Block`
 * and `Permission` maps. Used for unit/integration tests and standalone execution.
 */
export class InMemoryHierarchyCascadeStore implements HierarchyCascadeStore {
  private readonly blocks = new Map<UUID, Block>();
  private readonly permissions = new Map<string, Permission>();

  constructor(initialBlocks: Iterable<Block> = []) {
    for (const block of initialBlocks) {
      this.blocks.set(block.id, structuredClone(block));
    }
  }

  upsertBlock(block: Block): void {
    this.blocks.set(block.id, structuredClone(block));
  }

  getBlock(id: UUID): Block | undefined {
    const block = this.blocks.get(id);
    return block ? structuredClone(block) : undefined;
  }

  getAllBlocks(): Block[] {
    return [...this.blocks.values()].map((b) => structuredClone(b));
  }

  getPermissionsForBlock(blockId: UUID): Permission[] {
    const results: Permission[] = [];
    for (const perm of this.permissions.values()) {
      if (perm.entity_table === 'block' && perm.entity_id === blockId) {
        results.push(structuredClone(perm));
      }
    }
    return results;
  }

  async getBlocksByIds(
    spaceId: UUID,
    ids: readonly UUID[],
  ): Promise<CascadeBlockNode[]> {
    const nodes: CascadeBlockNode[] = [];
    for (const id of ids) {
      const block = this.blocks.get(id);
      if (block && block.space_id === spaceId) {
        nodes.push({
          id: block.id,
          space_id: block.space_id,
          parent_id: block.parent_id,
          content: [...block.content],
          alive: block.alive,
          version: block.version,
        });
      }
    }
    return nodes;
  }

  async getBlocksByParentIds(
    spaceId: UUID,
    parentIds: readonly UUID[],
  ): Promise<CascadeBlockNode[]> {
    if (parentIds.length === 0) return [];
    const parentSet = new Set(parentIds);
    const nodes: CascadeBlockNode[] = [];
    for (const block of this.blocks.values()) {
      if (block.space_id === spaceId && parentSet.has(block.parent_id)) {
        nodes.push({
          id: block.id,
          space_id: block.space_id,
          parent_id: block.parent_id,
          content: [...block.content],
          alive: block.alive,
          version: block.version,
        });
      }
    }
    return nodes;
  }

  async setBlocksAliveBatch(
    spaceId: UUID,
    blockIds: readonly UUID[],
    alive: boolean,
    actorId?: UUID,
  ): Promise<UUID[]> {
    const updated: UUID[] = [];
    const now = Date.now();
    for (const id of blockIds) {
      const existing = this.blocks.get(id);
      if (!existing || existing.space_id !== spaceId) continue;
      if (existing.alive !== alive) {
        existing.alive = alive;
        existing.version += 1;
        existing.last_edited_time = now;
        if (actorId) {
          existing.last_edited_by_id = actorId;
        }
        updated.push(id);
      }
    }
    return updated;
  }

  async applyPermissionOverridesBatch(
    workspaceId: UUID,
    blockIds: readonly UUID[],
    overrides: readonly PermissionOverrideRule[],
    replaceExisting = false,
  ): Promise<UUID[]> {
    const updated: UUID[] = [];
    const now = Date.now();

    for (const blockId of blockIds) {
      if (!this.blocks.has(blockId)) continue;

      if (replaceExisting) {
        for (const [key, perm] of this.permissions.entries()) {
          if (perm.entity_table === 'block' && perm.entity_id === blockId) {
            this.permissions.delete(key);
          }
        }
      }

      let blockChanged = false;
      for (const rule of overrides) {
        const compositeKey = `${workspaceId}:block:${blockId}:${rule.principalType}:${rule.principalId ?? 'public'}`;
        const current = this.permissions.get(compositeKey);
        if (!current || current.role !== rule.role) {
          this.permissions.set(compositeKey, {
            id: current?.id ?? compositeKey,
            workspace_id: workspaceId,
            entity_table: 'block',
            entity_id: blockId,
            principal_type: rule.principalType,
            principal_id: rule.principalId,
            role: rule.role,
            created_at: current?.created_at ?? now,
          });
          blockChanged = true;
        }
      }

      if (blockChanged) {
        updated.push(blockId);
      }
    }

    return updated;
  }
}

/**
 * Drizzle PostgreSQL implementation of {@link HierarchyCascadeStore}.
 */
export class DatabaseHierarchyCascadeStore implements HierarchyCascadeStore {
  constructor(private readonly db: VotionDatabase) {}

  async getBlocksByIds(
    spaceId: UUID,
    ids: readonly UUID[],
  ): Promise<CascadeBlockNode[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: blocksTable.id,
        spaceId: blocksTable.spaceId,
        parentId: blocksTable.parentId,
        content: blocksTable.content,
        alive: blocksTable.alive,
        version: blocksTable.version,
      })
      .from(blocksTable)
      .where(
        and(
          eq(blocksTable.spaceId, spaceId),
          inArray(blocksTable.id, [...ids]),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      space_id: row.spaceId,
      parent_id: row.parentId,
      content: row.content ?? [],
      alive: row.alive,
      version: row.version,
    }));
  }

  async getBlocksByParentIds(
    spaceId: UUID,
    parentIds: readonly UUID[],
  ): Promise<CascadeBlockNode[]> {
    if (parentIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: blocksTable.id,
        spaceId: blocksTable.spaceId,
        parentId: blocksTable.parentId,
        content: blocksTable.content,
        alive: blocksTable.alive,
        version: blocksTable.version,
      })
      .from(blocksTable)
      .where(
        and(
          eq(blocksTable.spaceId, spaceId),
          inArray(blocksTable.parentId, [...parentIds]),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      space_id: row.spaceId,
      parent_id: row.parentId,
      content: row.content ?? [],
      alive: row.alive,
      version: row.version,
    }));
  }

  async setBlocksAliveBatch(
    spaceId: UUID,
    blockIds: readonly UUID[],
    alive: boolean,
    actorId?: UUID,
  ): Promise<UUID[]> {
    if (blockIds.length === 0) return [];
    const updatedRows = await this.db
      .update(blocksTable)
      .set({
        alive,
        version: sql`${blocksTable.version} + 1`,
        lastEditedTime: new Date(),
        ...(actorId ? { lastEditedBy: actorId } : {}),
      })
      .where(
        and(
          eq(blocksTable.spaceId, spaceId),
          inArray(blocksTable.id, [...blockIds]),
          eq(blocksTable.alive, !alive),
        ),
      )
      .returning();

    return updatedRows.map((row) => row.id);
  }

  async applyPermissionOverridesBatch(
    workspaceId: UUID,
    blockIds: readonly UUID[],
    overrides: readonly PermissionOverrideRule[],
    replaceExisting = false,
  ): Promise<UUID[]> {
    if (blockIds.length === 0 || overrides.length === 0) return [];

    if (replaceExisting) {
      await this.db
        .delete(permissionsTable)
        .where(
          and(
            eq(permissionsTable.workspaceId, workspaceId),
            eq(permissionsTable.entityTable, 'block'),
            inArray(permissionsTable.entityId, [...blockIds]),
          ),
        );
    }

    const existingRows = await this.db
      .select()
      .from(permissionsTable)
      .where(
        and(
          eq(permissionsTable.workspaceId, workspaceId),
          eq(permissionsTable.entityTable, 'block'),
          inArray(permissionsTable.entityId, [...blockIds]),
        ),
      );

    const existingMap = new Map<string, (typeof existingRows)[number]>();
    for (const row of existingRows) {
      const key = `${row.entityId}:${row.principalType}:${row.principalId ?? 'public'}`;
      existingMap.set(key, row);
    }

    const toInsert: (typeof permissionsTable.$inferInsert)[] = [];
    const changedBlockIds = new Set<UUID>();

    for (const blockId of blockIds) {
      for (const rule of overrides) {
        const key = `${blockId}:${rule.principalType}:${rule.principalId ?? 'public'}`;
        const existing = existingMap.get(key);
        if (!existing) {
          toInsert.push({
            workspaceId,
            entityTable: 'block',
            entityId: blockId,
            principalType: rule.principalType,
            principalId: rule.principalId,
            role: rule.role,
          });
          changedBlockIds.add(blockId);
        } else if (existing.role !== rule.role) {
          await this.db
            .update(permissionsTable)
            .set({ role: rule.role })
            .where(eq(permissionsTable.id, existing.id));
          changedBlockIds.add(blockId);
        }
      }
    }

    if (toInsert.length > 0) {
      await this.db.insert(permissionsTable).values(toInsert);
    }

    return [...changedBlockIds];
  }
}

export interface HierarchyCascadeWorkerOptions {
  store: HierarchyCascadeStore;
  defaultBatchSize?: number;
  /** Optional hook notified whenever a batch of blocks is soft-deleted. */
  onBlocksSoftDeleted?: (spaceId: UUID, blockIds: UUID[]) => Promise<void> | void;
}

/**
 * Traverses nested block hierarchies in fixed batches (default 500) to cascade
 * soft-deletions (`alive: false`) or permission overrides without blocking
 * HTTP transaction endpoints.
 */
export class HierarchyCascadeWorker {
  private readonly store: HierarchyCascadeStore;
  private readonly defaultBatchSize: number;
  private readonly onBlocksSoftDeleted?: (
    spaceId: UUID,
    blockIds: UUID[],
  ) => Promise<void> | void;

  constructor(options: HierarchyCascadeWorkerOptions) {
    this.store = options.store;
    this.defaultBatchSize = Math.max(
      1,
      options.defaultBatchSize ?? DEFAULT_CASCADE_BATCH_SIZE,
    );
    if (options.onBlocksSoftDeleted) {
      this.onBlocksSoftDeleted = options.onBlocksSoftDeleted;
    }
  }

  /**
   * Collects the root block and all of its descendants using breadth-first
   * level discovery across both `content` arrays and `parent_id` edges.
   * Cycle-safe via a `visited` set.
   */
  async discoverSubtreeIds(
    spaceId: UUID,
    rootBlockId: UUID,
    batchSize = this.defaultBatchSize,
  ): Promise<UUID[]> {
    const visited = new Set<UUID>();
    let frontier: UUID[] = [rootBlockId];

    while (frontier.length > 0) {
      const unvisitedFrontier = frontier.filter((id) => !visited.has(id));
      if (unvisitedFrontier.length === 0) break;

      const nextFrontierSet = new Set<UUID>();

      for (let i = 0; i < unvisitedFrontier.length; i += batchSize) {
        const chunkIds = unvisitedFrontier.slice(i, i + batchSize);
        const [nodesById, childrenByParent] = await Promise.all([
          this.store.getBlocksByIds(spaceId, chunkIds),
          this.store.getBlocksByParentIds(spaceId, chunkIds),
        ]);

        for (const node of nodesById) {
          visited.add(node.id);
          for (const childId of node.content) {
            if (!visited.has(childId)) {
              nextFrontierSet.add(childId);
            }
          }
        }

        // Mark any requested IDs that exist only as references as visited so we don't loop
        for (const id of chunkIds) {
          if (!nodesById.some((n) => n.id === id)) {
            visited.add(id);
          }
        }

        for (const child of childrenByParent) {
          if (!visited.has(child.id)) {
            nextFrontierSet.add(child.id);
          }
        }
      }

      frontier = [...nextFrontierSet];
    }

    // Filter to only IDs that actually exist in the store
    const allCandidateIds = [...visited];
    const verifiedIds: UUID[] = [];
    for (let i = 0; i < allCandidateIds.length; i += batchSize) {
      const slice = allCandidateIds.slice(i, i + batchSize);
      const existing = await this.store.getBlocksByIds(spaceId, slice);
      const existingSet = new Set(existing.map((n) => n.id));
      for (const id of slice) {
        if (existingSet.has(id)) {
          verifiedIds.push(id);
        }
      }
    }

    return verifiedIds;
  }

  /**
   * Executes a hierarchy cascade job (either soft-delete or permission-cascade)
   * in chunks of `batchSize` (default 500).
   */
  async process(data: HierarchyCascadeJobData): Promise<HierarchyCascadeJobResult> {
    const batchSize = Math.max(
      1,
      data.batchSize ?? this.defaultBatchSize,
    );

    const subtreeIds = await this.discoverSubtreeIds(
      data.spaceId,
      data.rootBlockId,
      batchSize,
    );

    const updatedBlockIds: UUID[] = [];
    let batchCount = 0;

    if (data.kind === 'soft-delete') {
      const targetAlive = data.alive ?? false;

      for (let offset = 0; offset < subtreeIds.length; offset += batchSize) {
        const batchIds = subtreeIds.slice(offset, offset + batchSize);
        batchCount += 1;
        const changedIds = await this.store.setBlocksAliveBatch(
          data.spaceId,
          batchIds,
          targetAlive,
          data.actorId,
        );
        updatedBlockIds.push(...changedIds);

        if (!targetAlive && changedIds.length > 0 && this.onBlocksSoftDeleted) {
          await this.onBlocksSoftDeleted(data.spaceId, changedIds);
        }
      }

      return {
        kind: 'soft-delete',
        rootBlockId: data.rootBlockId,
        visitedCount: subtreeIds.length,
        updatedCount: updatedBlockIds.length,
        batchCount,
        updatedBlockIds,
      };
    }

    for (let offset = 0; offset < subtreeIds.length; offset += batchSize) {
      const batchIds = subtreeIds.slice(offset, offset + batchSize);
      batchCount += 1;
      const changedIds = await this.store.applyPermissionOverridesBatch(
        data.workspaceId,
        batchIds,
        data.overrides,
        data.replaceExisting,
      );
      updatedBlockIds.push(...changedIds);
    }

    return {
      kind: 'permission-cascade',
      rootBlockId: data.rootBlockId,
      visitedCount: subtreeIds.length,
      updatedCount: updatedBlockIds.length,
      batchCount,
      updatedBlockIds,
    };
  }
}

export interface CreateHierarchyCascadeBullWorkerConfig
  extends HierarchyCascadeWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createHierarchyCascadeBullWorker(
  config: CreateHierarchyCascadeBullWorkerConfig,
): Worker<HierarchyCascadeJobData, HierarchyCascadeJobResult, string> {
  const processor = new HierarchyCascadeWorker(config);
  return new Worker<HierarchyCascadeJobData, HierarchyCascadeJobResult, string>(
    HIERARCHY_CASCADE_QUEUE_NAME,
    async (job: Job<HierarchyCascadeJobData, HierarchyCascadeJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 4,
      ...config.workerOptions,
    },
  );
}
