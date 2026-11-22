/**
 * Dexie schema for the local-first cache.
 *
 * Tables mirror the server's record tables one-to-one (`blocks`, `collections`,
 * `collection_views`) plus the outbound `outbox`. Every record table is keyed by
 * `id` and indexed by `space_id` (workspace scoping) and `parent_id` (tree
 * loading), which are the two predicates the editor issues on every navigation.
 *
 * Outbox rows are keyed by an auto-incrementing `seq` so replay order is the
 * insertion order even when two transactions share a millisecond timestamp.
 */

import Dexie, { type Table } from 'dexie';
import type { Block, Collection, CollectionView, UUID } from '@votion/types';

/** Outbox row: a pending transaction plus its replay metadata. */
export interface OutboxRecord {
  /** Auto-incrementing replay sequence (primary key). */
  seq?: number;
  /** Transaction id (idempotency key on the wire). */
  id: UUID;
  /** Workspace the transaction belongs to. */
  spaceId: UUID;
  /** Enqueue timestamp (epoch ms) — the ordering key for replay. */
  enqueuedAt: number;
  /** Serialised transactions, in dispatch order. */
  transaction: unknown;
  /** Number of failed dispatch attempts (drives retry backoff). */
  attempts?: number;
  /** Epoch ms of the last dispatch attempt. */
  lastAttemptAt?: number;
  /** Last transport/server error observed for this entry. */
  lastError?: string;
}

/** Name of the IndexedDB database used by the sync client. */
export const VOTION_DB_NAME = 'votion-sync-client';

/** Schema version of the local cache. Bump with a Dexie migration when changing. */
export const VOTION_DB_VERSION = 1;

/** Dexie database class backing the offline engine. */
export class VotionDatabase extends Dexie {
  /** Cached block records. */
  blocks!: Table<Block, UUID>;
  /** Cached collection records. */
  collections!: Table<Collection, UUID>;
  /** Cached collection view records. */
  collectionViews!: Table<CollectionView, UUID>;
  /** Pending outbound transactions (offline outbox). */
  outbox!: Table<OutboxRecord, number>;

  constructor(name: string = VOTION_DB_NAME) {
    super(name);

    this.version(VOTION_DB_VERSION).stores({
      blocks: 'id, space_id, parent_id, alive, last_edited_time',
      collections: 'id, space_id, parent_id, alive',
      collectionViews: 'id, space_id, collection_id, alive',
      outbox: '++seq, id, spaceId, enqueuedAt',
    });
  }
}

/**
 * Dexie resolves `IDBKeyRange` and friends lazily from the ambient scope. In
 * Node (tests / SSR) `fake-indexeddb` provides them, so callers must install the
 * polyfill before instantiating the database — see `test/setup.ts`.
 */

/** Environment capabilities required by the persistence layer. */
export interface PersistenceEnvironment {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

let database: VotionDatabase | undefined;

/**
 * Returns the process-wide local database handle.
 *
 * `indexedDB` is looked up on every first call because the polyfill may be
 * installed after module evaluation (true for both `fake-indexeddb` in tests and
 * some browser bootstraps).
 */
export function getVotionDatabase(
  env: PersistenceEnvironment = globalThis,
): VotionDatabase {
  if (!database) {
    if (!env.indexedDB) {
      throw new PersistenceUnavailableError(
        'IndexedDB is not available in this environment. Install a polyfill (fake-indexeddb) or run in a browser.',
      );
    }
    database = new VotionDatabase();
  }
  return database;
}

/** Overrides the database handle (tests / multiple workspaces). */
export function setVotionDatabase(next: VotionDatabase | undefined): void {
  database = next;
}

/** True when IndexedDB is available in the current runtime. */
export function isPersistenceAvailable(
  env: PersistenceEnvironment = globalThis,
): boolean {
  return typeof env.indexedDB?.open === 'function';
}

/** Raised when the persistence layer is used in an IndexedDB-less runtime. */
export class PersistenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnavailableError';
  }
}
