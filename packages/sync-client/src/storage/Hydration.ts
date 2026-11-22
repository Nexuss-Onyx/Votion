/**
 * Boot-time hydration of the in-memory store from IndexedDB.
 *
 * The web app's root layout calls `hydrateFromLocalCache()` before the editor
 * renders. Reading the cache first — rather than blocking on `loadPageChunk` —
 * is what makes a cold start feel instant and lets the workspace open with no
 * network at all. The server response, when it arrives, is merged as a normal
 * record-map update; the reconciler resolves any version skew per field.
 *
 * Hydration is intentionally tolerant: a corrupt or unavailable IndexedDB (Safari
 * private mode, storage eviction, a quota error mid-write) degrades to an empty
 * cache instead of failing the boot. The `hydrated` flag records *attempted*
 * hydration so the UI can distinguish "no cache yet" from "cache is empty".
 */

import type { UUID } from '@votion/types';
import { IndexedDBStorage } from './IndexedDBStorage.js';
import { OutboxStorage } from './OutboxStorage.js';
import type { RecordMapInput, RecordStoreApi } from '../store/RecordStore.js';
import type { Transaction } from '@votion/types';

/** Outcome of a hydration attempt. */
export interface HydrationResult {
  /** Number of records restored into the store. */
  records: number;
  /** Number of pending transactions found in the outbox. */
  pending: number;
  /** The restored record map (also already applied to the store). */
  recordMap?: RecordMapInput;
  /** Error that degraded hydration to an empty cache, if any. */
  error?: string;
  /** Whether the store was populated from disk. */
  hydrated: boolean;
}

/** Options accepted by {@link hydrateFromLocalCache}. */
export interface HydrationOptions {
  /** Store to populate. */
  store: RecordStoreApi;
  /** Persistence facade (defaults to one bound to the shared database). */
  storage?: IndexedDBStorage;
  /** Outbox facade (defaults to one bound to the shared database). */
  outbox?: OutboxStorage;
  /** Restrict hydration to a single workspace. */
  spaceId?: UUID;
  /** Include soft-deleted records (defaults to `false` for a clean canvas). */
  includeDeleted?: boolean;
  /** Inline the restored record map in the result (useful for diagnostics). */
  includeRecords?: boolean;
}

/**
 * Restores cached records into the store.
 *
 * Never throws: a storage failure is reported via `result.error` and the store is
 * marked hydrated so the UI can fall back to the network path.
 */
export async function hydrateFromLocalCache(
  options: HydrationOptions,
): Promise<HydrationResult> {
  const storage = options.storage ?? new IndexedDBStorage();
  const outbox = options.outbox ?? new OutboxStorage();
  const { store } = options;

  try {
    await storage.open();
    const snapshot = await storage.loadAllLocalRecords({
      ...(options.spaceId ? { spaceId: options.spaceId } : {}),
      includeDeleted: options.includeDeleted ?? true,
    });

    store.getState().loadRecords({
      block: snapshot.block,
      collection: snapshot.collection,
      collection_view: snapshot.collection_view,
    });
    store.getState().markHydrated(true);

    const pending = await outbox.pendingCount(options.spaceId);
    return {
      records: snapshot.count,
      pending,
      ...(options.includeRecords
        ? {
            recordMap: {
              block: snapshot.block,
              collection: snapshot.collection,
              collection_view: snapshot.collection_view,
            },
          }
        : {}),
      hydrated: true,
    };
  } catch (error) {
    store.getState().markHydrated(true);
    return {
      records: 0,
      pending: 0,
      error: error instanceof Error ? error.message : String(error),
      hydrated: false,
    };
  }
}

/** Reads the pending transactions without touching the store (boot diagnostics). */
export async function readPendingTransactions(
  outbox: OutboxStorage = new OutboxStorage(),
  spaceId?: UUID,
): Promise<Transaction[]> {
  const entries = await outbox.peekTransactions(spaceId ? { spaceId } : {});
  return entries.map((entry) => entry.transaction);
}
