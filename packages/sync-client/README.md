# `@votion/sync-client`

The local-first engine that makes Votion feel instant and work offline.

Every user action is applied to an in-memory normalized store **before** any network
call, persisted to IndexedDB, and queued in a durable outbox that replays in strict
order when connectivity returns.

```text
[User action]
      │
      ▼
TransactionBuilder ──► Transaction { operations: [...] }
      │
      ├──► OptimisticPatcher ──► Zustand RecordStore        (UI in 0 ms)
      ├──► IndexedDBStorage  ──► Dexie blocks/collections   (survives refresh)
      └──► OutboxStorage     ──► outbox table               (survives offline)
                    │
                    ▼
             [network online?]
             ├── yes ──► POST /api/v3/saveTransactions ──► dequeue on ack
             └── no  ──► retain ──► window "online" ──► flush in order
```

## Install

Workspace-local package:

```json
{
  "dependencies": {
    "@votion/sync-client": "workspace:*"
  }
}
```

## Quick start

```ts
import {
  VotionClient,
  TransactionBuilder,
  getRecordStore,
  selectChildBlocksById,
} from '@votion/sync-client';

// 1. Boot: hydrate the cache from IndexedDB, restore the pending outbox.
const { client, hydration } = await VotionClient.bootstrap({ spaceId });

// 2. Mutate: local commit resolves immediately; sync happens in the background.
const tx = new TransactionBuilder({ spaceId, table: 'block', id: pageId })
  .set(['properties', 'title'], [['Updated Document Title']])
  .build();

await client.submit(tx);

// 3. Render: memoised selectors are reference-stable between renders.
const children = selectChildBlocksById(pageId)(getRecordStore().getState());
```

## Modules

| Path                             | Responsibility                                                          |
| :------------------------------- | :---------------------------------------------------------------------- |
| `store/RecordStore`              | Normalized Zustand slices (`blocks`, `collections`, `collectionViews`)  |
| `store/Selectors`                | Memoised tree queries (`selectChildBlocks`, `selectAncestorBlocks`, …)  |
| `storage/IndexedDBStorage`       | Dexie persistence, indexed reads, cache hydration                       |
| `storage/OutboxStorage`          | Durable pending-transaction queue ordered by `(enqueuedAt, seq)`        |
| `storage/Hydration`              | Boot-time restore that degrades instead of throwing                     |
| `transaction/TransactionBuilder` | Fluent builder for `set`/`update`/`listAfter`/`listBefore`/`listRemove` |
| `transaction/OptimisticPatcher`  | Atomic, cloned-path application of operations to the store              |
| `sync/SyncManager`               | Outbox orchestration, batching, `online` listener, teardown             |
| `sync/Reconciler`                | Per-field conflict resolution against remote versions                   |
| `sync/RetryStrategy`             | Full-jitter exponential backoff + error classification                  |
| `presence/PresenceClient`        | 20 Hz throttled cursor/selection broadcast + peer TTL                   |
| `client/VotionClient`            | Composition root wiring the above together                              |

## Guarantees

- **0 ms local writes.** `submit()` resolves after the local commit and the IndexedDB
  write; the HTTP dispatch is not awaited.
- **Nothing is lost offline.** The outbox lives in IndexedDB, so a refresh, a crashed
  tab or a browser restart resumes exactly where it stopped. Transaction ids double as
  server idempotency keys, so a replay cannot double-apply.
- **Strict replay order.** Entries are drained oldest-first by `(enqueuedAt, seq)`; a
  failed batch stops the flush so later list operations never overtake earlier ones.
- **No unhandled rejections.** Background persistence and flush failures are recorded in
  `SyncManager.status.lastError` instead of escaping.
- **Graceful degradation.** Missing IndexedDB (SSR, Safari private mode, evicted origin)
  degrades to an empty cache with `hydration.hydrated === false`.

## Verification

```bash
pnpm --filter @votion/sync-client run build     # V-01
pnpm --filter @votion/sync-client run test      # V-02 + V-03
pnpm turbo run typecheck                        # V-04
```

Tests run against `fake-indexeddb`, so Dexie, IndexedDB transactions, key ordering and
structured cloning are all exercised for real — only the disk is virtualised.
