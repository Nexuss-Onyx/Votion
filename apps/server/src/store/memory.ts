/**
 * In-memory {@link DataStore} implementation.
 *
 * Used by the test-suite and by local development when no `DATABASE_URL` is
 * configured. Atomicity is implemented with a deep snapshot: the batch runs
 * against a cloned state and only commits when every operation succeeds, so
 * a failing operation leaves zero partial writes behind — exactly the
 * rollback guarantee the PostgreSQL implementation provides via
 * `BEGIN`/`COMMIT`.
 */

import { randomUUID } from 'node:crypto';

import type { Transaction, UUID, WorkspaceRole } from '@votion/types';

import { OperationError, applyOperation, cloneJson } from '../lib/jsonpatch.js';
import type {
  AppliedTransaction,
  BlockRecord,
  CollectionRecord,
  CollectionViewRecord,
  DataStore,
  NewBlock,
  NewCollection,
  NewCollectionView,
  NewUser,
  NewWorkspace,
  RefreshTokenRecord,
  TransactionRecordRow,
  UserRecord,
  WorkspaceMemberRecord,
  WorkspaceRecord,
} from './types.js';

interface MemoryState {
  users: Map<UUID, UserRecord>;
  refreshTokens: Map<UUID, RefreshTokenRecord>;
  workspaces: Map<UUID, WorkspaceRecord>;
  members: Map<string, WorkspaceMemberRecord>;
  blocks: Map<UUID, BlockRecord>;
  collections: Map<UUID, CollectionRecord>;
  collectionViews: Map<UUID, CollectionViewRecord>;
  transactionRecords: TransactionRecordRow[];
  transactionSeq: number;
}

function emptyState(): MemoryState {
  return {
    users: new Map(),
    refreshTokens: new Map(),
    workspaces: new Map(),
    members: new Map(),
    blocks: new Map(),
    collections: new Map(),
    collectionViews: new Map(),
    transactionRecords: [],
    transactionSeq: 0,
  };
}

function memberKey(workspaceId: UUID, userId: UUID): string {
  return `${workspaceId}:${userId}`;
}

function now(): Date {
  return new Date();
}

/** In-memory store with snapshot-based atomic transaction batches. */
export class InMemoryStore implements DataStore {
  private state: MemoryState = emptyState();

  // ---- users -------------------------------------------------------------

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    for (const user of this.state.users.values()) {
      if (user.email === normalized) {
        return cloneJson(user);
      }
    }
    return null;
  }

  async findUserById(id: UUID): Promise<UserRecord | null> {
    const user = this.state.users.get(id);
    return user ? cloneJson(user) : null;
  }

  async createUser(input: NewUser): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    if (await this.findUserByEmail(email)) {
      throw new Error(`User with email ${email} already exists.`);
    }
    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      avatarUrl: null,
      locale: 'en',
      lastActiveAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.state.users.set(user.id, user);
    return cloneJson(user);
  }

  async touchUserLastActive(userId: UUID): Promise<void> {
    const user = this.state.users.get(userId);
    if (user) {
      user.lastActiveAt = now();
      user.updatedAt = now();
    }
  }

  // ---- refresh tokens ----------------------------------------------------

  async createRefreshToken(
    userId: UUID,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      createdAt: now(),
    };
    this.state.refreshTokens.set(record.id, record);
    return cloneJson(record);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.state.refreshTokens.values()) {
      if (record.tokenHash === tokenHash) {
        return cloneJson(record);
      }
    }
    return null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<boolean> {
    for (const record of this.state.refreshTokens.values()) {
      if (record.tokenHash === tokenHash && record.revokedAt === null) {
        record.revokedAt = now();
        return true;
      }
    }
    return false;
  }

  async revokeAllRefreshTokens(userId: UUID): Promise<void> {
    for (const record of this.state.refreshTokens.values()) {
      if (record.userId === userId && record.revokedAt === null) {
        record.revokedAt = now();
      }
    }
  }

  // ---- workspaces & membership -------------------------------------------

  async createWorkspace(input: NewWorkspace): Promise<WorkspaceRecord> {
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      domain: input.domain ?? null,
      icon: input.icon ?? null,
      plan: 'free',
      settings: cloneJson(input.settings ?? {}),
      createdAt: now(),
      updatedAt: now(),
    };
    this.state.workspaces.set(workspace.id, workspace);
    return cloneJson(workspace);
  }

  async findWorkspaceById(id: UUID): Promise<WorkspaceRecord | null> {
    const workspace = this.state.workspaces.get(id);
    return workspace ? cloneJson(workspace) : null;
  }

  async findWorkspaceByDomain(domain: string): Promise<WorkspaceRecord | null> {
    for (const workspace of this.state.workspaces.values()) {
      if (workspace.domain === domain) {
        return cloneJson(workspace);
      }
    }
    return null;
  }

  async listWorkspacesForUser(userId: UUID): Promise<WorkspaceRecord[]> {
    const result: WorkspaceRecord[] = [];
    for (const member of this.state.members.values()) {
      if (member.userId === userId) {
        const workspace = this.state.workspaces.get(member.workspaceId);
        if (workspace) {
          result.push(cloneJson(workspace));
        }
      }
    }
    return result;
  }

  async updateWorkspace(
    id: UUID,
    patch: Partial<Pick<WorkspaceRecord, 'name' | 'domain' | 'icon' | 'settings'>>,
  ): Promise<WorkspaceRecord | null> {
    const workspace = this.state.workspaces.get(id);
    if (!workspace) {
      return null;
    }
    if (patch.name !== undefined) workspace.name = patch.name;
    if (patch.domain !== undefined) workspace.domain = patch.domain;
    if (patch.icon !== undefined) workspace.icon = patch.icon;
    if (patch.settings !== undefined) workspace.settings = cloneJson(patch.settings);
    workspace.updatedAt = now();
    return cloneJson(workspace);
  }

  async deleteWorkspace(id: UUID): Promise<boolean> {
    const existed = this.state.workspaces.delete(id);
    if (existed) {
      for (const [key, member] of this.state.members) {
        if (member.workspaceId === id) {
          this.state.members.delete(key);
        }
      }
    }
    return existed;
  }

  async addMember(
    workspaceId: UUID,
    userId: UUID,
    role: WorkspaceRole,
  ): Promise<WorkspaceMemberRecord> {
    const member: WorkspaceMemberRecord = {
      workspaceId,
      userId,
      role,
      createdAt: now(),
    };
    this.state.members.set(memberKey(workspaceId, userId), member);
    return cloneJson(member);
  }

  async removeMember(workspaceId: UUID, userId: UUID): Promise<boolean> {
    return this.state.members.delete(memberKey(workspaceId, userId));
  }

  async findMember(workspaceId: UUID, userId: UUID): Promise<WorkspaceMemberRecord | null> {
    const member = this.state.members.get(memberKey(workspaceId, userId));
    return member ? cloneJson(member) : null;
  }

  async listMembers(workspaceId: UUID): Promise<WorkspaceMemberRecord[]> {
    const result: WorkspaceMemberRecord[] = [];
    for (const member of this.state.members.values()) {
      if (member.workspaceId === workspaceId) {
        result.push(cloneJson(member));
      }
    }
    return result;
  }

  // ---- blocks -------------------------------------------------------------

  async findBlockById(id: UUID): Promise<BlockRecord | null> {
    const block = this.state.blocks.get(id);
    return block ? cloneJson(block) : null;
  }

  async listBlocksByIds(ids: UUID[]): Promise<BlockRecord[]> {
    const result: BlockRecord[] = [];
    for (const id of ids) {
      const block = this.state.blocks.get(id);
      if (block) {
        result.push(cloneJson(block));
      }
    }
    return result;
  }

  async createBlock(input: NewBlock): Promise<BlockRecord> {
    const timestamp = now();
    const block: BlockRecord = {
      id: input.id ?? randomUUID(),
      spaceId: input.spaceId,
      version: 1,
      type: input.type,
      properties: cloneJson(input.properties ?? {}),
      format: cloneJson(input.format ?? {}),
      content: [...(input.content ?? [])],
      parentId: input.parentId,
      parentTable: input.parentTable,
      alive: true,
      createdTime: timestamp,
      lastEditedTime: timestamp,
      createdById: input.createdById ?? null,
      lastEditedById: input.createdById ?? null,
    };
    this.state.blocks.set(block.id, block);
    return cloneJson(block);
  }

  async listCollectionRows(collectionId: UUID): Promise<BlockRecord[]> {
    const result: BlockRecord[] = [];
    for (const block of this.state.blocks.values()) {
      if (
        block.parentTable === 'collection' &&
        block.parentId === collectionId &&
        block.alive
      ) {
        result.push(cloneJson(block));
      }
    }
    return result;
  }

  // ---- collections & views ------------------------------------------------

  async findCollectionById(id: UUID): Promise<CollectionRecord | null> {
    const collection = this.state.collections.get(id);
    return collection ? cloneJson(collection) : null;
  }

  async listCollectionsByIds(ids: UUID[]): Promise<CollectionRecord[]> {
    const result: CollectionRecord[] = [];
    for (const id of ids) {
      const collection = this.state.collections.get(id);
      if (collection) {
        result.push(cloneJson(collection));
      }
    }
    return result;
  }

  async findCollectionViewById(id: UUID): Promise<CollectionViewRecord | null> {
    const view = this.state.collectionViews.get(id);
    return view ? cloneJson(view) : null;
  }

  async listCollectionViewsByIds(ids: UUID[]): Promise<CollectionViewRecord[]> {
    const result: CollectionViewRecord[] = [];
    for (const id of ids) {
      const view = this.state.collectionViews.get(id);
      if (view) {
        result.push(cloneJson(view));
      }
    }
    return result;
  }

  async listViewsForCollection(collectionId: UUID): Promise<CollectionViewRecord[]> {
    const result: CollectionViewRecord[] = [];
    for (const view of this.state.collectionViews.values()) {
      if (view.collectionId === collectionId && view.alive) {
        result.push(cloneJson(view));
      }
    }
    return result;
  }

  async createCollection(input: NewCollection): Promise<CollectionRecord> {
    const timestamp = now();
    const collection: CollectionRecord = {
      id: input.id ?? randomUUID(),
      spaceId: input.spaceId,
      parentId: input.parentId,
      name: cloneJson(input.name ?? []),
      description: cloneJson(input.description ?? []),
      schema: cloneJson(input.schema ?? {}),
      icon: null,
      cover: null,
      alive: true,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.collections.set(collection.id, collection);
    return cloneJson(collection);
  }

  async createCollectionView(input: NewCollectionView): Promise<CollectionViewRecord> {
    const timestamp = now();
    const view: CollectionViewRecord = {
      id: input.id ?? randomUUID(),
      spaceId: input.spaceId,
      collectionId: input.collectionId,
      type: input.type,
      name: input.name,
      format: cloneJson(input.format ?? {}),
      query2: cloneJson(input.query2 ?? {}),
      alive: true,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.collectionViews.set(view.id, view);
    return cloneJson(view);
  }

  // ---- transactions (atomic) ----------------------------------------------

  async applyTransactions(
    batch: Transaction[],
    requestId: UUID,
    userId: UUID,
  ): Promise<AppliedTransaction[]> {
    // Snapshot the mutable state; on any failure the snapshot is restored,
    // giving the batch all-or-nothing semantics.
    const snapshot = cloneJson(this.state);
    try {
      const applied: AppliedTransaction[] = [];
      for (const transaction of batch) {
        const versions: Record<UUID, number> = {};
        const touched = new Set<string>();
        for (const operation of transaction.operations) {
          const { table, id } = operation.pointer;
          if (table !== 'block') {
            throw new OperationError(
              `Operations on table "${table}" are not supported by this store.`,
            );
          }
          const block = this.state.blocks.get(id);
          if (!block) {
            throw new OperationError(`Block ${id} not found.`);
          }
          if (!block.alive) {
            throw new OperationError(`Block ${id} is deleted.`);
          }
          if (block.spaceId !== operation.pointer.spaceId || block.spaceId !== transaction.spaceId) {
            throw new OperationError(`Block ${id} does not belong to transaction space ${transaction.spaceId}.`);
          }
          // Apply against a plain-object view of the row so JSONB columns
          // (`properties`, `format`, `content`) behave exactly like the
          // PostgreSQL implementation.
          const view: Record<string, unknown> = {
            properties: block.properties,
            format: block.format,
            content: block.content,
          };
          applyOperation(view, operation);
          block.properties = view['properties'] as BlockRecord['properties'];
          block.format = view['format'] as BlockRecord['format'];
          block.content = view['content'] as UUID[];
          touched.add(id);
        }
        const timestamp = now();
        for (const id of touched) {
          const block = this.state.blocks.get(id) as BlockRecord;
          block.version += 1;
          block.lastEditedTime = timestamp;
          block.lastEditedById = userId;
          versions[id] = block.version;
        }
        this.state.transactionSeq += 1;
        this.state.transactionRecords.push({
          id: this.state.transactionSeq,
          transactionId: transaction.id,
          requestId,
          spaceId: transaction.spaceId,
          userId,
          operations: cloneJson(transaction.operations),
          versions: { ...versions },
          createdAt: timestamp,
        });
        applied.push({ transactionId: transaction.id, versions });
      }
      return applied;
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async listTransactionRecords(spaceId: UUID): Promise<TransactionRecordRow[]> {
    return this.state.transactionRecords
      .filter((row) => row.spaceId === spaceId)
      .map((row) => cloneJson(row));
  }

  async close(): Promise<void> {
    /* No resources to release. */
  }
}
