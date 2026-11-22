/**
 * PostgreSQL {@link DataStore} implementation (Drizzle ORM over Neon /
 * node-postgres, via `@votion/db`).
 *
 * Atomicity: on pooled drivers (`node-postgres`, `neon-websocket`) the whole
 * batch runs inside a single SQL transaction — any failing operation rolls
 * back every write, including the WAL rows. Stateless `neon-http` cannot
 * guarantee multi-statement atomicity, so batches fail closed under that
 * transport; configure `neon-websocket` or `node-postgres` for mutations.
 *
 * Operation semantics are shared with the in-memory store through
 * {@link applyOperation}: rows are fetched, patched in memory, and written
 * back inside the transaction, which keeps `set` / `update` / `listAfter` /
 * `listRemove` behaviour identical across transports.
 */

import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  blocks,
  collectionViews,
  collections,
  createDatabase,
  transactionRecords,
  users,
  workspaceMembers,
  workspaces,
  type DatabaseHandle,
  type VotionDatabase,
} from '@votion/db';
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

type Db = VotionDatabase;

type BlockRow = typeof blocks.$inferSelect;
type CollectionRow = typeof collections.$inferSelect;
type CollectionViewRow = typeof collectionViews.$inferSelect;
type UserRow = typeof users.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;

function toBlockRecord(row: BlockRow): BlockRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    version: row.version,
    type: row.type,
    properties: cloneJson(row.properties),
    format: cloneJson(row.format),
    content: [...row.content],
    parentId: row.parentId,
    parentTable: row.parentTable,
    alive: row.alive,
    createdTime: row.createdTime,
    lastEditedTime: row.lastEditedTime,
    createdById: row.createdById,
    lastEditedById: row.lastEditedById,
  };
}

function toCollectionRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    parentId: row.parentId,
    name: cloneJson(row.name),
    description: cloneJson(row.description),
    schema: cloneJson(row.schema),
    icon: row.icon,
    cover: row.cover,
    alive: row.alive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCollectionViewRecord(row: CollectionViewRow): CollectionViewRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    collectionId: row.collectionId,
    type: row.type,
    name: row.name,
    format: cloneJson(row.format),
    query2: cloneJson(row.query2),
    alive: row.alive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    locale: row.locale,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    icon: row.icon,
    plan: row.plan,
    settings: cloneJson(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Structural view of a Drizzle transaction-capable client. */
interface TransactionalDb {
  transaction<T>(callback: (tx: Db) => Promise<T>): Promise<T>;
}

function isTransactional(db: Db): db is Db & TransactionalDb {
  return typeof (db as unknown as TransactionalDb).transaction === 'function';
}

/** PostgreSQL-backed store. */
export class PostgresStore implements DataStore {
  private readonly handle: DatabaseHandle;

  constructor(handle: DatabaseHandle) {
    this.handle = handle;
  }

  private get db(): Db {
    return this.handle.db;
  }

  // ---- users -------------------------------------------------------------

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ? toUserRecord(rows[0]) : null;
  }

  async findUserById(id: UUID): Promise<UserRecord | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUserRecord(rows[0]) : null;
  }

  async createUser(input: NewUser): Promise<UserRecord> {
    const rows = await this.db
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        fullName: input.fullName,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create user.');
    }
    return toUserRecord(row);
  }

  async touchUserLastActive(userId: UUID): Promise<void> {
    await this.db
      .update(users)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ---- refresh tokens ----------------------------------------------------
  // Refresh tokens are persisted in the `accounts`-adjacent in-memory index
  // of this process when running against Postgres without a dedicated table:
  // the schema ships no refresh-token table, so tokens live in a process-
  // local map keyed by hash. Rotation semantics (single-use, revocation)
  // are identical to the in-memory store.

  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

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
      createdAt: new Date(),
    };
    this.refreshTokens.set(tokenHash, record);
    return cloneJson(record);
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const record = this.refreshTokens.get(tokenHash);
    return record ? cloneJson(record) : null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<boolean> {
    const record = this.refreshTokens.get(tokenHash);
    if (!record || record.revokedAt !== null) {
      return false;
    }
    record.revokedAt = new Date();
    return true;
  }

  async revokeAllRefreshTokens(userId: UUID): Promise<void> {
    for (const record of this.refreshTokens.values()) {
      if (record.userId === userId && record.revokedAt === null) {
        record.revokedAt = new Date();
      }
    }
  }

  // ---- workspaces & membership -------------------------------------------

  async createWorkspace(input: NewWorkspace): Promise<WorkspaceRecord> {
    const rows = await this.db
      .insert(workspaces)
      .values({
        name: input.name,
        domain: input.domain ?? null,
        icon: input.icon ?? null,
        settings: cloneJson(input.settings ?? {}),
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create workspace.');
    }
    return toWorkspaceRecord(row);
  }

  async findWorkspaceById(id: UUID): Promise<WorkspaceRecord | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);
    return rows[0] ? toWorkspaceRecord(rows[0]) : null;
  }

  async findWorkspaceByDomain(domain: string): Promise<WorkspaceRecord | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.domain, domain))
      .limit(1);
    return rows[0] ? toWorkspaceRecord(rows[0]) : null;
  }

  async listWorkspacesForUser(userId: UUID): Promise<WorkspaceRecord[]> {
    const rows = await this.db
      .select({ workspace: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId));
    return rows.map((row) => toWorkspaceRecord(row.workspace));
  }

  async updateWorkspace(
    id: UUID,
    patch: Partial<Pick<WorkspaceRecord, 'name' | 'domain' | 'icon' | 'settings'>>,
  ): Promise<WorkspaceRecord | null> {
    const set: Partial<WorkspaceRow> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.domain !== undefined) set.domain = patch.domain;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.settings !== undefined) set.settings = cloneJson(patch.settings);
    const rows = await this.db
      .update(workspaces)
      .set(set)
      .where(eq(workspaces.id, id))
      .returning();
    return rows[0] ? toWorkspaceRecord(rows[0]) : null;
  }

  async deleteWorkspace(id: UUID): Promise<boolean> {
    const rows = await this.db
      .delete(workspaces)
      .where(eq(workspaces.id, id))
      .returning();
    return rows.length > 0;
  }

  async addMember(
    workspaceId: UUID,
    userId: UUID,
    role: WorkspaceRole,
  ): Promise<WorkspaceMemberRecord> {
    const rows = await this.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to add workspace member.');
    }
    return {
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
    };
  }

  async removeMember(workspaceId: UUID, userId: UUID): Promise<boolean> {
    const rows = await this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .returning();
    return rows.length > 0;
  }

  async findMember(workspaceId: UUID, userId: UUID): Promise<WorkspaceMemberRecord | null> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row
      ? {
          workspaceId: row.workspaceId,
          userId: row.userId,
          role: row.role,
          createdAt: row.createdAt,
        }
      : null;
  }

  async listMembers(workspaceId: UUID): Promise<WorkspaceMemberRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
    }));
  }

  // ---- blocks -------------------------------------------------------------

  async findBlockById(id: UUID): Promise<BlockRecord | null> {
    const rows = await this.db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
    return rows[0] ? toBlockRecord(rows[0]) : null;
  }

  async listBlocksByIds(ids: UUID[]): Promise<BlockRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db.select().from(blocks).where(inArray(blocks.id, ids));
    return rows.map(toBlockRecord);
  }

  async createBlock(input: NewBlock): Promise<BlockRecord> {
    const rows = await this.db
      .insert(blocks)
      .values({
        id: input.id,
        spaceId: input.spaceId,
        type: input.type,
        properties: cloneJson(input.properties ?? {}),
        format: cloneJson(input.format ?? {}),
        content: [...(input.content ?? [])],
        parentId: input.parentId,
        parentTable: input.parentTable,
        createdById: input.createdById ?? null,
        lastEditedById: input.createdById ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create block.');
    }
    return toBlockRecord(row);
  }

  async listCollectionRows(collectionId: UUID): Promise<BlockRecord[]> {
    const rows = await this.db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.parentTable, 'collection'),
          eq(blocks.parentId, collectionId),
          eq(blocks.alive, true),
        ),
      );
    return rows.map(toBlockRecord);
  }

  // ---- collections & views ------------------------------------------------

  async findCollectionById(id: UUID): Promise<CollectionRecord | null> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
      .limit(1);
    return rows[0] ? toCollectionRecord(rows[0]) : null;
  }

  async listCollectionsByIds(ids: UUID[]): Promise<CollectionRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(collections)
      .where(inArray(collections.id, ids));
    return rows.map(toCollectionRecord);
  }

  async findCollectionViewById(id: UUID): Promise<CollectionViewRecord | null> {
    const rows = await this.db
      .select()
      .from(collectionViews)
      .where(eq(collectionViews.id, id))
      .limit(1);
    return rows[0] ? toCollectionViewRecord(rows[0]) : null;
  }

  async listCollectionViewsByIds(ids: UUID[]): Promise<CollectionViewRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(collectionViews)
      .where(inArray(collectionViews.id, ids));
    return rows.map(toCollectionViewRecord);
  }

  async listViewsForCollection(collectionId: UUID): Promise<CollectionViewRecord[]> {
    const rows = await this.db
      .select()
      .from(collectionViews)
      .where(
        and(eq(collectionViews.collectionId, collectionId), eq(collectionViews.alive, true)),
      );
    return rows.map(toCollectionViewRecord);
  }

  async createCollection(input: NewCollection): Promise<CollectionRecord> {
    const rows = await this.db
      .insert(collections)
      .values({
        id: input.id,
        spaceId: input.spaceId,
        parentId: input.parentId,
        name: cloneJson(input.name ?? []),
        description: cloneJson(input.description ?? []),
        schema: cloneJson(input.schema ?? {}),
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create collection.');
    }
    return toCollectionRecord(row);
  }

  async createCollectionView(input: NewCollectionView): Promise<CollectionViewRecord> {
    const rows = await this.db
      .insert(collectionViews)
      .values({
        id: input.id,
        spaceId: input.spaceId,
        collectionId: input.collectionId,
        type: input.type,
        name: input.name,
        format: cloneJson(input.format ?? {}),
        query2: cloneJson(input.query2 ?? {}),
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create collection view.');
    }
    return toCollectionViewRecord(row);
  }

  // ---- transactions (atomic) ----------------------------------------------

  private async applyBatchWith(
    db: Db,
    batch: Transaction[],
    requestId: UUID,
    userId: UUID,
  ): Promise<AppliedTransaction[]> {
    const applied: AppliedTransaction[] = [];
    for (const transaction of batch) {
      const versions: Record<UUID, number> = {};
      const touched = new Set<UUID>();
      for (const operation of transaction.operations) {
        const { table, id } = operation.pointer;
        if (table !== 'block') {
          throw new OperationError(
            `Operations on table "${table}" are not supported by this store.`,
          );
        }
        const rows = await db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
        const row = rows[0];
        if (!row) {
          throw new OperationError(`Block ${id} not found.`);
        }
        if (!row.alive) {
          throw new OperationError(`Block ${id} is deleted.`);
        }
        if (row.spaceId !== operation.pointer.spaceId || row.spaceId !== transaction.spaceId) {
          throw new OperationError(`Block ${id} does not belong to transaction space ${transaction.spaceId}.`);
        }
        const view: Record<string, unknown> = {
          properties: cloneJson(row.properties),
          format: cloneJson(row.format),
          content: [...row.content],
        };
        applyOperation(view, operation);
        const timestamp = new Date();
        await db
          .update(blocks)
          .set({
            properties: view['properties'] as BlockRow['properties'],
            format: view['format'] as BlockRow['format'],
            content: view['content'] as UUID[],
            lastEditedTime: timestamp,
            lastEditedById: userId,
          })
          .where(eq(blocks.id, id));
        touched.add(id);
      }
      for (const id of touched) {
        const rows = await db
          .update(blocks)
          .set({ version: (await this.readVersion(db, id)) + 1 })
          .where(eq(blocks.id, id))
          .returning();
        const newVersion = rows[0]?.version ?? 1;
        versions[id] = newVersion;
      }
      await db.insert(transactionRecords).values({
        transactionId: transaction.id,
        requestId,
        spaceId: transaction.spaceId,
        userId,
        operations: cloneJson(transaction.operations),
        versions: { ...versions },
      });
      applied.push({ transactionId: transaction.id, versions });
    }
    return applied;
  }

  private async readVersion(db: Db, id: UUID): Promise<number> {
    const rows = await db
      .select({ version: blocks.version })
      .from(blocks)
      .where(eq(blocks.id, id))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  async applyTransactions(
    batch: Transaction[],
    requestId: UUID,
    userId: UUID,
  ): Promise<AppliedTransaction[]> {
    const db = this.db;
    if (!isTransactional(db)) {
      // Never risk partial writes: the HTTP-only Neon driver cannot provide
      // Drizzle multi-statement transactions. Fail before the first mutation.
      throw new OperationError(
        'Atomic transaction batches require VOTION_DB_DRIVER=neon-websocket or node-postgres.',
      );
    }
    return db.transaction((tx) => this.applyBatchWith(tx, batch, requestId, userId));
  }

  async listTransactionRecords(spaceId: UUID): Promise<TransactionRecordRow[]> {
    const rows = await this.db
      .select()
      .from(transactionRecords)
      .where(eq(transactionRecords.spaceId, spaceId))
      .orderBy(asc(transactionRecords.id));
    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      requestId: row.requestId,
      spaceId: row.spaceId,
      userId: row.userId,
      operations: cloneJson(row.operations),
      versions: cloneJson(row.versions),
      createdAt: row.createdAt,
    }));
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

/** Creates a PostgreSQL store from environment configuration. */
export function createPostgresStore(env: {
  DATABASE_URL?: string;
  VOTION_DB_DRIVER?: 'neon-http' | 'neon-websocket' | 'node-postgres';
  VOTION_DB_MAX_CONNECTIONS?: string;
}): PostgresStore {
  const handle = createDatabase({
    connectionString: env.DATABASE_URL,
    driver: env.VOTION_DB_DRIVER,
    maxConnections: env.VOTION_DB_MAX_CONNECTIONS
      ? Number.parseInt(env.VOTION_DB_MAX_CONNECTIONS, 10)
      : undefined,
  });
  return new PostgresStore(handle);
}

