/**
 * Normalized in-memory record store (Zustand).
 *
 * The store is the single source of truth every renderer reads from. Records are
 * normalised into flat hash maps (`id -> record`) so a mutation of one block
 * never invalidates an unrelated subtree, and so path-addressed transaction
 * operations can be applied in O(1).
 *
 * Design notes:
 *  - The three canonical slices mirror the server tables addressed by
 *    `OperationPointer.table`: `block`, `collection` and `collection_view`.
 *  - Every action is *pure with respect to the network*: it never awaits I/O and
 *    never dispatches HTTP. Persistence and outbound synchronisation are the
 *    job of `IndexedDBStorage` / `SyncManager`.
 *  - Records are treated as immutable values; patched copies are written back so
 *    downstream selectors re-render on identity change.
 */

import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  Block,
  Collection,
  CollectionView,
  OperationTable,
  UUID,
} from '@votion/types';

/** Compile-time registry mapping a wire table name to its record type. */
export interface RecordTypeMap {
  block: Block;
  collection: Collection;
  collection_view: CollectionView;
}

/**
 * Table names the record store addresses.
 *
 * `OperationTable` also contains `space`, which is owned by the ACL layer rather
 * than the record cache, so it is excluded here.
 */
export type StoreTableName = Exclude<OperationTable, 'space'>;

/** Accepted record union. */
export type RecordRecord = RecordTypeMap[StoreTableName];

/** Normalised record slices held by the store. */
export interface RecordTables {
  blocks: Record<UUID, Block>;
  collections: Record<UUID, Collection>;
  collectionViews: Record<UUID, CollectionView>;
}

/** Batch record payload (mirrors the `loadPageChunk` record-map shape). */
export interface RecordMapInput {
  block?: Record<UUID, Block>;
  collection?: Record<UUID, Collection>;
  collection_view?: Record<UUID, CollectionView>;
}

/** Read-only projection of the store state. */
export interface RecordStoreState extends RecordTables {
  /** Monotonic counter bumped on every mutation (cheap "did anything change?" check). */
  revision: number;
  /** Whether the store has been hydrated from IndexedDB / the server. */
  hydrated: boolean;
}

/** Action surface of the record store. */
export interface RecordStoreActions {
  /** Inserts or replaces a single record in the matching slice. */
  setRecord: <T extends StoreTableName>(
    table: T,
    record: RecordTypeMap[T],
  ) => void;
  /** Inserts or replaces many records of one table in a single commit. */
  setRecords: <T extends StoreTableName>(
    table: T,
    records: RecordTypeMap[T][],
  ) => void;
  /**
   * Shallow-merges `patch` into an existing record without replacing the whole
   * value. Returns the patched record, or `undefined` when the record is absent.
   */
  updateRecord: <T extends StoreTableName>(
    table: T,
    id: UUID,
    patch: Partial<RecordTypeMap[T]>,
  ) => RecordTypeMap[T] | undefined;
  /**
   * Applies an arbitrary deep mutation to one record and commits the result.
   * Used by the optimistic patcher, which has already produced a cloned record.
   */
  replaceRecord: <T extends StoreTableName>(
    table: T,
    record: RecordTypeMap[T],
  ) => void;
  /** Hard-removes a record from the store (soft deletion is an `alive` patch). */
  removeRecord: (table: StoreTableName, id: UUID) => void;
  /** Merges a batch of records (the server's `recordMap` shape) in one commit. */
  loadRecords: (records: RecordMapInput) => void;
  /** Replaces the given slices wholesale (used when switching workspace). */
  replaceRecords: (records: Partial<RecordMapInput>) => void;
  /** Removes every record from every slice. */
  clearRecords: () => void;
  /** Marks the store as hydrated from local persistence. */
  markHydrated: (hydrated?: boolean) => void;
}

/** Complete store contract (state + actions). */
export interface RecordStore extends RecordStoreState, RecordStoreActions {}

/** Full Zustand store handle. */
export type RecordStoreApi = StoreApi<RecordStore>;

const EMPTY_TABLES: RecordTables = {
  blocks: {},
  collections: {},
  collectionViews: {},
};

/** Resolves a wire table name to the store slice key that backs it. */
export function sliceKeyOf(table: StoreTableName): keyof RecordTables {
  switch (table) {
    case 'block':
      return 'blocks';
    case 'collection':
      return 'collections';
    case 'collection_view':
      return 'collectionViews';
    default:
      throw new Error(`Unknown record table: ${String(table)}`);
  }
}

/**
 * Reads a slice through a table-name discriminant.
 *
 * Kept as a function (rather than a dynamic index) so every read stays strongly
 * typed for the caller's record variant.
 */
function readSlice<T extends StoreTableName>(
  state: RecordTables,
  table: T,
): Record<UUID, RecordTypeMap[T]> {
  switch (table) {
    case 'block':
      return state.blocks as Record<UUID, RecordTypeMap[T]>;
    case 'collection':
      return state.collections as Record<UUID, RecordTypeMap[T]>;
    case 'collection_view':
      return state.collectionViews as Record<UUID, RecordTypeMap[T]>;
    default:
      throw new Error(`Unknown record table: ${String(table)}`);
  }
}

/**
 * Returns a new state object with one slice replaced.
 *
 * The returned object only carries the touched slice plus `revision`, so
 * `Object.is` checks on the other slices stay stable for subscribers.
 */
function withSlice<T extends StoreTableName>(
  table: T,
  slice: Record<UUID, RecordTypeMap[T]>,
  revision: number,
): Partial<RecordStore> {
  switch (table) {
    case 'block':
      return { blocks: slice as Record<UUID, Block>, revision };
    case 'collection':
      return { collections: slice as Record<UUID, Collection>, revision };
    case 'collection_view':
      return {
        collectionViews: slice as Record<UUID, CollectionView>,
        revision,
      };
    default:
      throw new Error(`Unknown record table: ${String(table)}`);
  }
}

/**
 * Creates an isolated record store instance.
 *
 * A dedicated instance (rather than a module singleton) keeps tests hermetic and
 * lets the web app create per-workspace stores. `getRecordStore()` exposes the
 * process-wide default used by the sync engine.
 */
export function createRecordStore(
  initial?: Partial<RecordMapInput> & { hydrated?: boolean },
): RecordStoreApi {
  return createStore<RecordStore>()((set, get) => ({
    blocks: { ...(initial?.block ?? {}) },
    collections: { ...(initial?.collection ?? {}) },
    collectionViews: { ...(initial?.collection_view ?? {}) },
    revision: 0,
    hydrated: initial?.hydrated ?? false,

    setRecord: <T extends StoreTableName>(
      table: T,
      record: RecordTypeMap[T],
    ) => {
      set((state) => {
        const current = readSlice(state, table);
        return withSlice(
          table,
          { ...current, [record.id]: record },
          state.revision + 1,
        );
      });
    },

    setRecords: <T extends StoreTableName>(
      table: T,
      records: RecordTypeMap[T][],
    ) => {
      if (records.length === 0) {
        return;
      }
      set((state) => {
        const current = readSlice(state, table);
        const next: Record<UUID, RecordTypeMap[T]> = { ...current };
        for (const record of records) {
          next[record.id] = record;
        }
        return withSlice(table, next, state.revision + 1);
      });
    },

    updateRecord: <T extends StoreTableName>(
      table: T,
      id: UUID,
      patch: Partial<RecordTypeMap[T]>,
    ): RecordTypeMap[T] | undefined => {
      const current = readSlice(get(), table)[id];
      if (!current) {
        return undefined;
      }
      const next = { ...current, ...patch };
      set((state) =>
        withSlice(
          table,
          { ...readSlice(state, table), [id]: next },
          state.revision + 1,
        ),
      );
      return next;
    },

    replaceRecord: <T extends StoreTableName>(
      table: T,
      record: RecordTypeMap[T],
    ) => {
      set((state) => {
        const current = readSlice(state, table);
        return withSlice(
          table,
          { ...current, [record.id]: record },
          state.revision + 1,
        );
      });
    },

    removeRecord: (table: StoreTableName, id: UUID) => {
      const current = readSlice(get(), table);
      if (!(id in current)) {
        return;
      }
      set((state) => {
        const slice = readSlice(state, table);
        const next = { ...slice };
        delete next[id];
        return withSlice(table, next, state.revision + 1);
      });
    },

    loadRecords: (records: RecordMapInput) => {
      set((state) => ({
        blocks: { ...state.blocks, ...(records.block ?? {}) },
        collections: { ...state.collections, ...(records.collection ?? {}) },
        collectionViews: {
          ...state.collectionViews,
          ...(records.collection_view ?? {}),
        },
        revision: state.revision + 1,
      }));
    },

    replaceRecords: (records: Partial<RecordMapInput>) => {
      set((state) => ({
        blocks: records.block ? { ...records.block } : state.blocks,
        collections: records.collection
          ? { ...records.collection }
          : state.collections,
        collectionViews: records.collection_view
          ? { ...records.collection_view }
          : state.collectionViews,
        revision: state.revision + 1,
      }));
    },

    clearRecords: () => {
      set((state) => ({ ...EMPTY_TABLES, revision: state.revision + 1 }));
    },

    markHydrated: (hydrated = true) => {
      set((state) => ({ hydrated, revision: state.revision + 1 }));
    },
  }));
}

let defaultStore: RecordStoreApi | undefined;

/** Returns the process-wide default record store (created on first access). */
export function getRecordStore(): RecordStoreApi {
  defaultStore ??= createRecordStore();
  return defaultStore;
}

/** Replaces the default store (test isolation / workspace switching). */
export function setRecordStore(store: RecordStoreApi): void {
  defaultStore = store;
}

/** Resets the default store instance entirely. */
export function resetRecordStore(): RecordStoreApi {
  defaultStore = createRecordStore();
  return defaultStore;
}

/**
 * React hook binding a selector to a record store.
 *
 * The selector runs with reference equality, so callers should return primitives
 * or stable references (see `Selectors.ts` for memoised tree queries).
 */
export function useRecordStore<T, S extends RecordStore = RecordStore>(
  selector: (state: S) => T,
  store: StoreApi<S> = getRecordStore() as unknown as StoreApi<S>,
): T {
  return useStore(store, selector);
}
