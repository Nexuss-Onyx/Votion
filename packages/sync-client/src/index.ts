/**
 * `@votion/sync-client` — Votion's local-first client engine.
 *
 * Everything the editor needs to work offline, in one entry point:
 *
 * ```ts
 * import {
 *   SyncManager, TransactionBuilder, hydrateFromLocalCache,
 *   getRecordStore, selectChildBlocksById, PresenceClient,
 * } from '@votion/sync-client';
 *
 * // Boot: restore cache, then wire the sync engine.
 * const store = getRecordStore();
 * await hydrateFromLocalCache({ store });
 * const sync = new SyncManager({ store });
 *
 * // Mutate: local-first, queued, replayed on reconnect.
 * const tx = new TransactionBuilder({ spaceId, table: 'block', id: pageId })
 *   .set(['properties', 'title'], [['Updated Document Title']])
 *   .build();
 * await sync.submit(tx);
 * ```
 *
 * Module map:
 *  - `store/`       normalized Zustand cache + memoised selectors
 *  - `storage/`     Dexie/IndexedDB persistence, hydration and the offline outbox
 *  - `transaction/` `TransactionBuilder` + `OptimisticPatcher`
 *  - `sync/`        `SyncManager`, `Reconciler`, `RetryStrategy`
 *  - `presence/`    throttled multi-cursor broadcasting
 */

/** Version of the sync-client contract surface. */
export const VOTION_SYNC_CLIENT_VERSION = '0.1.0';

export * from './store/index.js';
export * from './storage/index.js';
export * from './transaction/index.js';
export * from './sync/index.js';
export * from './presence/index.js';

export * from './client.js';
