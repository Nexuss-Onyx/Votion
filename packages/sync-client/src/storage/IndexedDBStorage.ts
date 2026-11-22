/**
 * IndexedDB persistence for the local-first cache.
 *
 * Responsibilities:
 *  - **Write-through**: every optimistic mutation is flushed to Dexie so a page
 *    refresh (or a browser crash) cannot lose acknowledged-in-UI edits.
 *  - **Hydration**: on boot, `loadAllLocalRecords()` streams the cached workspace
 *    back into the Zustand store, making navigation instant and offline-capable.
 *
 * All methods are async and safe to call concurrently: Dexie serialises writes
 * per table, and batch helpers run in a single transaction so a partially
 * applied batch can never reach disk.
 */

import type { Block, Collection, CollectionView, UUID } from '@votion/types';
import type { Table } from 'dexie';
import {
  getVotionDatabase,
  type PersistenceEnvironment,
  type VotionDatabase,
} from './VotionDatabase.js';
import type {
  RecordMapInput,
  RecordTypeMap,
  StoreTableName,
} from '../store/RecordStore.js';

/** A cached record of any table. */
export type CachedRecord = Block | Collection | CollectionView;

/** Hydrated snapshot returned by {@link IndexedDBStorage.loadAllLocalRecords}. */
export interface LocalRecordSnapshot extends RecordMapInput {
  /** Total number of records read across every table. */
  count: number;
}

/** Options accepted by every storage read. */
export interface LoadOptions {
  /** Restrict the query to one workspace. */
  spaceId?: UUID;
  /** Restrict blocks to a single parent (loads a page subtree lazily). */
  parentId?: UUID;
  /** Include soft-deleted (`alive: false`) records. Defaults to `true`. */
  includeDeleted?: boolean;
}

/** Persistence facade over the Dexie handle. */
export class IndexedDBStorage {
  private readonly db: VotionDatabase;

  constructor(db: VotionDatabase = getVotionDatabase()) {
    this.db = db;
  }

  /** The underlying Dexie handle (exposed for transaction-scoped batches). */
  get database(): VotionDatabase {
    return this.db;
  }

  /** True when IndexedDB is reachable. */
  static isAvailable(env: PersistenceEnvironment = globalThis): boolean {
    return typeof env.indexedDB?.open === 'function';
  }

  /** Opens the database (idempotent, resolves when the schema is ready). */
  async open(): Promise<void> {
    if (!this.db.isOpen()) {
      await this.db.open();
    }
  }

  /** Closes the database handle (tests / teardown). */
  close(): void {
    this.db.close();
  }

  /** Deletes the whole database from disk (logout / "clear cache"). */
  async deleteDatabase(): Promise<void> {
    this.db.close();
    await this.db.delete();
  }

  /**
   * Writes one record, routing it to the table named by `table`.
   *
   * The record is stored verbatim (structured-clone), so JSONB payloads keep
   * their nested arrays/objects without a serialise step.
   */
  async persistRecord<T extends StoreTableName>(
    table: T,
    record: RecordTypeMap[T],
  ): Promise<void> {
    await this.tableFor(table).put(record as CachedRecord);
  }

  /** Writes many records of the same table inside a single IndexedDB transaction. */
  async persistRecords<T extends StoreTableName>(
    table: T,
    records: RecordTypeMap[T][],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.tableFor(table).bulkPut(records as CachedRecord[]);
  }

  /** Persists a mixed record map (the shape returned by `loadPageChunk`). */
  async persistRecordMap(records: RecordMapInput): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    if (records.block) {
      tasks.push(this.db.blocks.bulkPut(Object.values(records.block)));
    }
    if (records.collection) {
      tasks.push(
        this.db.collections.bulkPut(Object.values(records.collection)),
      );
    }
    if (records.collection_view) {
      tasks.push(
        this.db.collectionViews.bulkPut(Object.values(records.collection_view)),
      );
    }
    // `Promise.all` on Dexie promises still participates in the ambient Dexie
    // transaction opened by callers, so this stays atomic per table.
    await Promise.all(tasks);
  }

  /** Reads one record from the cache. */
  async loadRecord<T extends StoreTableName>(
    table: T,
    id: UUID,
  ): Promise<RecordTypeMap[T] | undefined> {
    return (await this.tableFor(table).get(id)) as RecordTypeMap[T] | undefined;
  }

  /**
   * Reads the whole local cache, optionally scoped to a workspace/parent.
   *
   * Returns records keyed by id in the same `{ block, collection, collection_view }`
   * shape the store consumes, so hydration is a single `loadRecords()` call.
   */
  async loadAllLocalRecords(
    options: LoadOptions = {},
  ): Promise<LocalRecordSnapshot> {
    const [blocks, collections, collectionViews] = await Promise.all([
      this.queryTable('blocks', options),
      this.queryTable('collections', options),
      this.queryTable('collectionViews', options),
    ]);

    const blockMap: Record<UUID, Block> = {};
    for (const block of blocks as Block[]) {
      blockMap[block.id] = block;
    }
    const collectionMap: Record<UUID, Collection> = {};
    for (const collection of collections as Collection[]) {
      collectionMap[collection.id] = collection;
    }
    const viewMap: Record<UUID, CollectionView> = {};
    for (const view of collectionViews as CollectionView[]) {
      viewMap[view.id] = view;
    }

    return {
      block: blockMap,
      collection: collectionMap,
      collection_view: viewMap,
      count: blocks.length + collections.length + collectionViews.length,
    };
  }

  /** Reads every cached block of one workspace. */
  async loadBlocksBySpace(spaceId: UUID): Promise<Block[]> {
    return this.db.blocks.where('space_id').equals(spaceId).toArray();
  }

  /** Reads every cached direct child block of `parentId`, ordered by `created_time`. */
  async loadChildBlocks(parentId: UUID): Promise<Block[]> {
    const blocks = await this.db.blocks
      .where('parent_id')
      .equals(parentId)
      .toArray();
    return blocks.sort((a, b) => a.created_time - b.created_time);
  }

  /** Reads every cached view of one collection. */
  async loadViewsByCollection(collectionId: UUID): Promise<CollectionView[]> {
    return this.db.collectionViews
      .where('collection_id')
      .equals(collectionId)
      .toArray();
  }

  /** Removes a single record from the cache. */
  async removeRecord(table: StoreTableName, id: UUID): Promise<void> {
    await this.tableFor(table).delete(id);
  }

  /** Clears every record table (and, by default, the outbox) but keeps the schema. */
  async clearLocalData(
    options: { includeOutbox?: boolean } = {},
  ): Promise<void> {
    const tables = [
      this.db.blocks,
      this.db.collections,
      this.db.collectionViews,
    ] as const;
    if (options.includeOutbox) {
      await this.db.transaction(
        'rw',
        this.db.blocks,
        this.db.collections,
        this.db.collectionViews,
        this.db.outbox,
        async () => {
          await Promise.all([
            ...tables.map((table) => table.clear()),
            this.db.outbox.clear(),
          ]);
        },
      );
      return;
    }
    await Promise.all(tables.map((table) => table.clear()));
  }

  /** Counts the records currently cached per table. */
  async countRecords(): Promise<{
    blocks: number;
    collections: number;
    collectionViews: number;
  }> {
    const [blocks, collections, collectionViews] = await Promise.all([
      this.db.blocks.count(),
      this.db.collections.count(),
      this.db.collectionViews.count(),
    ]);
    return { blocks, collections, collectionViews };
  }

  /** Resolves the Dexie table backing a wire table name. */
  private tableFor(table: StoreTableName): Table<CachedRecord, string> {
    switch (table) {
      case 'block':
        return this.db.blocks;
      case 'collection':
        return this.db.collections;
      case 'collection_view':
        return this.db.collectionViews;
      default:
        throw new Error(`Unknown record table: ${String(table)}`);
    }
  }

  /** Applies the `LoadOptions` predicates to one table query. */
  private async queryTable(
    table: 'blocks' | 'collections' | 'collectionViews',
    options: LoadOptions,
  ): Promise<CachedRecord[]> {
    const { spaceId, parentId, includeDeleted = true } = options;
    const byParent = table === 'blocks' && parentId !== undefined;

    let rows: CachedRecord[];
    if (byParent) {
      rows = await this.db.blocks.where('parent_id').equals(parentId).toArray();
    } else if (spaceId) {
      const handle = this.db.table<CachedRecord, string>(table);
      rows = await handle.where('space_id').equals(spaceId).toArray();
    } else {
      const handle = this.db.table<CachedRecord, string>(table);
      rows = await handle.toArray();
    }

    if (!includeDeleted) {
      rows = rows.filter((row) => row.alive !== false);
    }
    return rows;
  }
}

/** Convenience: creates a storage handle bound to the default database. */
export function createIndexedDBStorage(
  env?: PersistenceEnvironment,
): IndexedDBStorage {
  return new IndexedDBStorage(getVotionDatabase(env));
}
