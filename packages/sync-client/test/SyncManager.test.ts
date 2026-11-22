/**
 * SyncManager: the full offline → reconnect → ordered replay lifecycle (V-03).
 *
 * These tests deliberately drive the manager through the public surface only
 * (`submit`, `flush`, `hydrate`, `applyRemoteUpdate`) so the assertions describe
 * observable behaviour rather than internal call sequences.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveTransactionsResponse, Transaction } from '@votion/types';

import {
  IndexedDBStorage,
  OutboxStorage,
  RetryStrategy,
  SaveTransactionsFetcher,
  SyncManager,
  TransactionBuilder,
  VOTION_DB_NAME,
  VotionDatabase,
  createRecordStore,
  setVotionDatabase,
  type EventTargetLike,
  type RecordStoreApi,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  id,
  makePage,
  makeTextBlock,
  makeTodoBlock,
  resetClock,
} from './factories.js';

const target = { spaceId: SPACE_ID, table: 'block' as const, id: PAGE_ID };

/** Minimal `window` stand-in for the online/offline listeners. */
class FakeEventTarget implements EventTargetLike {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

/** Records every dispatched batch and returns scripted responses. */
function createTransport(
  respond: (body: {
    requestId: string;
    transactions: Transaction[];
  }) => SaveTransactionsResponse | Promise<SaveTransactionsResponse>,
) {
  const calls: { requestId: string; transactions: Transaction[] }[] = [];
  const fetcher: SaveTransactionsFetcher = async (body) => {
    calls.push({ requestId: body.requestId, transactions: body.transactions });
    return respond(body);
  };
  return { fetcher, calls };
}

/** A response that acknowledges every transaction in the request. */
function ackAll(
  body: { transactions: Transaction[] },
  version = 2,
): SaveTransactionsResponse {
  return {
    requestId: 'req-ok',
    results: body.transactions.map((transaction) => ({
      id: transaction.id,
      applied: true,
      versions: Object.fromEntries(
        transaction.operations.map((operation) => [
          operation.pointer.id,
          version,
        ]),
      ),
    })),
  };
}

let db: VotionDatabase;
let databaseSeq = 0;
let store: RecordStoreApi;
let storage: IndexedDBStorage;
let outbox: OutboxStorage;

beforeEach(async () => {
  resetClock();
  databaseSeq += 1;
  db = new VotionDatabase(`${VOTION_DB_NAME}-sync-${databaseSeq}`);
  setVotionDatabase(db);
  await db.open();
  storage = new IndexedDBStorage(db);
  outbox = new OutboxStorage(db);
  store = createRecordStore();
  store.getState().setRecord('block', makePage({ id: PAGE_ID, children: [] }));
  store.getState().setRecord('block', makeTodoBlock({ id: id(500) }));
});

afterEach(async () => {
  await db.delete();
  setVotionDatabase(undefined);
});

function makeManager(
  overrides: Partial<ConstructorParameters<typeof SyncManager>[0]> = {},
) {
  return new SyncManager({
    store,
    storage,
    outbox,
    eventTarget: undefined,
    autoFlush: false,
    ...overrides,
  });
}

/** Builds a title-edit transaction. */
function titleTx(n: number, blockId = PAGE_ID): Transaction {
  return new TransactionBuilder({
    spaceId: SPACE_ID,
    table: 'block',
    id: blockId,
  })
    .set(['properties', 'title'], [[`edit-${n}`]])
    .build();
}

describe('SyncManager — optimistic submit', () => {
  it('applies locally, persists to IndexedDB and enqueues in the outbox', async () => {
    const { fetcher, calls } = createTransport((body) => ackAll(body));
    const manager = makeManager({ fetcher, isOnline: () => true });

    const transaction = titleTx(1);
    const patch = await manager.submit(transaction);

    // 1. Local state is already updated when submit resolves (0 ms UI).
    expect(patch.applied).toBe(1);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-1'],
    ]);

    // 2. The record is durable on disk.
    expect(
      (await storage.loadRecord('block', PAGE_ID))?.properties.title,
    ).toEqual([['edit-1']]);

    // 3. The transaction left the outbox after the background flush.
    await vi.waitFor(async () => {
      expect(await outbox.pendingCount()).toBe(0);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.transactions[0]?.id).toBe(transaction.id);
    manager.dispose();
  });

  it('does not await the network for the local commit', async () => {
    let resolveNetwork: (() => void) | undefined;
    const manager = makeManager({
      fetcher: async (body) => {
        await new Promise<void>((resolve) => {
          resolveNetwork = resolve;
        });
        return ackAll(body);
      },
      isOnline: () => true,
    });

    const done = await manager.submit(titleTx(2));
    expect(done.applied).toBe(1);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-2'],
    ]);

    // The dispatch is still in flight, yet the caller already has its result.
    await vi.waitFor(() => expect(resolveNetwork).toBeTypeOf('function'));
    resolveNetwork?.();
    await manager.flush();
    manager.dispose();
  });

  it('toggles a checkbox optimistically and reverts nothing when the server acks', async () => {
    const { fetcher } = createTransport((body) => ackAll(body));
    const manager = makeManager({ fetcher, isOnline: () => true });

    await manager.submit(
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: id(500) })
        .set(['properties', 'checked'], [['yes']])
        .build(),
    );

    expect(store.getState().blocks[id(500)]?.properties.checked).toEqual([
      ['yes'],
    ]);
    await vi.waitFor(() => expect(manager.status.pending).toBe(0));
    expect(store.getState().blocks[id(500)]?.properties.checked).toEqual([
      ['yes'],
    ]);
    manager.dispose();
  });

  it('submitMany commits a batch in one local update and one queue append', async () => {
    const { fetcher, calls } = createTransport((body) => ackAll(body));
    const manager = makeManager({ fetcher, isOnline: () => true });

    const batch = [titleTx(3), titleTx(4)];
    await manager.submitMany(batch);

    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-4'],
    ]);
    await vi.waitFor(async () => expect(await outbox.pendingCount()).toBe(0));
    expect(calls[0]?.transactions.map((tx) => tx.id)).toEqual(
      batch.map((tx) => tx.id),
    );
    manager.dispose();
  });

  it('submitMany with an empty batch is a no-op', async () => {
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      isOnline: () => true,
    });
    const result = await manager.submitMany([]);
    expect(result.touched).toEqual([]);
    expect(await outbox.pendingCount()).toBe(0);
    manager.dispose();
  });

  it('applies server-acknowledged versions without reverting local content', async () => {
    const { fetcher } = createTransport((body) => ackAll(body, 7));
    const manager = makeManager({ fetcher, isOnline: () => true });

    await manager.submit(titleTx(5));
    await vi.waitFor(() =>
      expect(store.getState().blocks[PAGE_ID]?.version).toBe(7),
    );

    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-5'],
    ]);
    manager.dispose();
  });
});

describe('SyncManager — offline outbox (V-03)', () => {
  it('queues while offline, then flushes in strict order on reconnect', async () => {
    let online = false;
    const events = new FakeEventTarget();
    const { fetcher, calls } = createTransport((body) => ackAll(body));
    const manager = makeManager({
      fetcher,
      eventTarget: events,
      isOnline: () => online,
      autoFlush: true,
      batchSize: 2,
    });

    // --- Phase 1: offline edits -------------------------------------------
    const offlineTxs = [
      titleTx(10),
      titleTx(11),
      titleTx(12),
      titleTx(13),
      titleTx(14),
    ];
    for (const transaction of offlineTxs) {
      await manager.submit(transaction);
    }

    // Every edit is applied locally and nothing hit the network.
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-14'],
    ]);
    expect(calls).toHaveLength(0);
    expect(await outbox.pendingCount()).toBe(5);
    expect(manager.status.online).toBe(false);

    // --- Phase 2: reconnect -------------------------------------------------
    online = true;
    events.emit('online');
    await manager.flush();

    // Flushed in creation order, batched at the configured size.
    const delivered = calls.flatMap((call) =>
      call.transactions.map((tx) => tx.id),
    );
    expect(delivered).toEqual(offlineTxs.map((tx) => tx.id));
    expect(calls.map((call) => call.transactions.length)).toEqual([2, 2, 1]);
    expect(await outbox.pendingCount()).toBe(0);
    expect(manager.status.synced).toBe(5);
    expect(manager.status.pending).toBe(0);
    manager.dispose();
  });

  it('a rejected dispatch keeps the whole queue intact and retries with backoff', async () => {
    let online = true;
    let failNext = true;
    const events = new FakeEventTarget();
    const { fetcher, calls } = createTransport((body) => {
      if (failNext) {
        const error = new Error('upstream unavailable');
        (error as Error & { status?: number }).status = 503;
        throw error;
      }
      return ackAll(body);
    });
    const manager = makeManager({
      fetcher,
      eventTarget: events,
      isOnline: () => online,
      autoFlush: true,
      retryStrategy: new RetryStrategy({
        baseDelayMs: 1,
        maxDelayMs: 5,
        random: () => 1,
      }),
    });

    await manager.submit(titleTx(20));
    await manager.submit(titleTx(21));

    const firstFlush = await manager.flush();
    expect(firstFlush.error).toContain('upstream unavailable');
    expect(firstFlush.retry).toBe(true);
    expect(firstFlush.retryDecision?.attempt).toBeGreaterThan(0);
    expect(await outbox.pendingCount()).toBe(2);
    // Local state is untouched by a sync failure: the user keeps their edits.
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-21'],
    ]);

    // Recovery: the queue drains in order and nothing is delivered twice.
    failNext = false;
    const pending = await outbox.peekTransactions();
    const expectedOrder = pending.map((entry) => entry.transaction.id);

    const recovery = makeManager({
      fetcher,
      eventTarget: events,
      isOnline: () => online,
      autoFlush: false,
    });
    const recovered = await recovery.flush();

    expect(recovered.error).toBeUndefined();
    expect(recovered.synced).toBe(2);
    expect(await outbox.pendingCount()).toBe(0);
    // The successful batch carries both edits, oldest first.
    const delivered = calls.at(-1)?.transactions.map((tx) => tx.id) ?? [];
    expect(delivered).toEqual(expectedOrder);
    manager.dispose();
    recovery.dispose();
  });

  it('does not dispatch while offline even if asked', async () => {
    const { fetcher, calls } = createTransport((body) => ackAll(body));
    const manager = makeManager({ fetcher, isOnline: () => false });

    const result = await manager.flush();
    expect(result.retry).toBe(true);
    expect(result.error).toBe('offline');
    expect(calls).toHaveLength(0);

    await manager.submit(titleTx(22));
    expect(await outbox.pendingCount()).toBe(1);
    manager.dispose();
  });

  it('a refresh mid-offline loses nothing (store + queue rehydrate)', async () => {
    const { fetcher } = createTransport((body) => ackAll(body));
    const offlineManager = makeManager({ fetcher, isOnline: () => false });

    await offlineManager.submit(titleTx(30));
    await offlineManager.submit(titleTx(31));
    offlineManager.dispose();
    db.close();

    // --- simulate a page reload: brand new everything --------------------
    const reopenedDb = new VotionDatabase(db.name);
    const reopenedStorage = new IndexedDBStorage(reopenedDb);
    const reopenedOutbox = new OutboxStorage(reopenedDb);
    const freshStore = createRecordStore();
    const { fetcher: onlineFetcher, calls } = createTransport((body) =>
      ackAll(body),
    );
    const onlineManager = new SyncManager({
      store: freshStore,
      storage: reopenedStorage,
      outbox: reopenedOutbox,
      fetcher: onlineFetcher,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => true,
    });

    const hydration = await onlineManager.hydrate();

    expect(hydration.records).toBeGreaterThanOrEqual(1);
    expect(hydration.pending).toBe(2);
    expect(freshStore.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-31'],
    ]);

    await onlineManager.flush();
    expect(await reopenedOutbox.pendingCount()).toBe(0);
    expect(calls[0]?.transactions).toHaveLength(2);
    expect(freshStore.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-31'],
    ]);

    onlineManager.dispose();
    await reopenedDb.delete();
  });

  it('shares one in-flight flush between the online event and a manual retry', async () => {
    let online = true;
    const events = new FakeEventTarget();
    let dispatchCount = 0;
    const manager = makeManager({
      fetcher: async (body) => {
        dispatchCount += 1;
        return ackAll(body);
      },
      eventTarget: events,
      isOnline: () => online,
      autoFlush: true,
    });

    await manager.submit(titleTx(40));
    await Promise.all([manager.flush(), manager.flush(), manager.flush()]);

    expect(dispatchCount).toBe(1);
    expect(await outbox.pendingCount()).toBe(0);
    manager.dispose();
  });

  it('dequeues rejected transactions so they cannot wedge the queue', async () => {
    const { fetcher } = createTransport((body) => ({
      requestId: 'req-reject',
      results: body.transactions.map((transaction) => ({
        id: transaction.id,
        applied: false,
        versions: {},
        error: 'stale version',
      })),
    }));
    const manager = makeManager({ fetcher, isOnline: () => true });

    await manager.submit(titleTx(41));
    await manager.flush();

    expect(await outbox.pendingCount()).toBe(0);
    manager.dispose();
  });

  it('records the failure on the outbox entry (attempts + last error)', async () => {
    const manager = makeManager({
      fetcher: async () => {
        throw new Error('boom');
      },
      isOnline: () => true,
      retryStrategy: new RetryStrategy({
        baseDelayMs: 1,
        maxDelayMs: 1,
        random: () => 1,
      }),
    });

    const transaction = titleTx(42);
    await manager.submit(transaction);
    await manager.flush();

    const [entry] = await outbox.peekTransactions();
    expect(entry?.attempts).toBeGreaterThanOrEqual(1);
    expect(entry?.lastError).toContain('boom');
    manager.dispose();
  });

  it('times out a hung request instead of blocking the queue forever', async () => {
    const manager = makeManager({
      fetcher: (_body, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      isOnline: () => true,
      requestTimeoutMs: 5,
      retryStrategy: new RetryStrategy({
        baseDelayMs: 1,
        maxDelayMs: 1,
        random: () => 1,
      }),
    });

    await manager.submit(titleTx(43));
    const result = await manager.flush();

    expect(result.error).toBeDefined();
    expect(result.retry).toBe(true);
    expect(await outbox.pendingCount()).toBe(1);
    manager.dispose();
  });
});

describe('SyncManager — listeners & lifecycle', () => {
  it('attaches and detaches the online/offline listeners', () => {
    const events = new FakeEventTarget();
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      eventTarget: events,
      autoFlush: true,
    });

    expect(events.listenerCount).toBe(2);
    manager.detachListeners();
    expect(events.listenerCount).toBe(0);

    manager.attachListeners();
    expect(events.listenerCount).toBe(2);
    manager.dispose();
  });

  it('is idempotent about listener attachment', () => {
    const events = new FakeEventTarget();
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      eventTarget: events,
      autoFlush: true,
    });
    manager.attachListeners();
    manager.attachListeners();
    expect(events.listenerCount).toBe(2);
    manager.dispose();
  });

  it('marks the engine offline on the offline event', async () => {
    const events = new FakeEventTarget();
    let online = true;
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      eventTarget: events,
      autoFlush: true,
      isOnline: () => online,
    });

    online = false;
    events.emit('offline');
    await manager.submit(titleTx(50));
    expect(await outbox.pendingCount()).toBe(1);
    manager.dispose();
  });

  it('hydrate marks the store hydrated and restores records', async () => {
    await storage.persistRecord('block', makeTextBlock({ id: id(600) }));
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      isOnline: () => false,
    });

    const result = await manager.hydrate();

    expect(result.records).toBeGreaterThanOrEqual(1);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().blocks[id(600)]).toBeDefined();
    manager.dispose();
  });

  it('resetLocalState clears both cache and queue', async () => {
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      isOnline: () => false,
    });
    await manager.submit(titleTx(60));

    await manager.resetLocalState();

    expect(store.getState().blocks).toEqual({});
    expect(await outbox.pendingCount()).toBe(0);
    expect(manager.status.pending).toBe(0);
    manager.dispose();
  });

  it('uses the configured endpoint and request id generator', async () => {
    const calls: string[] = [];
    const manager = makeManager({
      fetcher: async (body) => {
        calls.push(body.requestId);
        return ackAll(body);
      },
      isOnline: () => true,
      requestIdGenerator: () => 'req-fixed',
      endpoint: '/custom/saveTransactions',
    });

    expect(manager.transactionEndpoint).toBe('/custom/saveTransactions');
    await manager.submit(titleTx(61));
    await manager.flush();

    expect(calls).toEqual(['req-fixed']);
    manager.dispose();
  });
});

describe('SyncManager — inbound realtime updates', () => {
  it('applies a newer remote patch and persists the merged record', async () => {
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      isOnline: () => false,
    });

    const applied = manager.applyRemoteUpdate({
      type: 'record_updated',
      table: 'block',
      id: PAGE_ID,
      version: 5,
      patch: { properties: { title: [['From a peer']] } },
    });

    expect(applied).toBe(true);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['From a peer'],
    ]);
    await vi.waitFor(async () => {
      const persisted = await storage.loadRecord('block', PAGE_ID);
      expect(persisted?.version).toBe(5);
    });
    manager.dispose();
  });

  it('ignores unrelated envelopes and unknown records', () => {
    const manager = makeManager({
      fetcher: async (body) => ackAll(body),
      isOnline: () => false,
    });
    expect(manager.applyRemoteUpdate({ type: 'heartbeat', timestamp: 1 })).toBe(
      false,
    );
    expect(
      manager.applyRemoteUpdate({
        type: 'record_updated',
        table: 'block',
        id: 'ghost',
        version: 2,
        patch: {},
      }),
    ).toBe(false);
    manager.dispose();
  });

  it('keeps the local value of a field with a pending transaction', async () => {
    const manager = makeManager({
      fetcher: async () => new Promise(() => undefined),
      isOnline: () => true,
    });
    await manager.submit(titleTx(70));

    manager.applyRemoteUpdate({
      type: 'record_updated',
      table: 'block',
      id: PAGE_ID,
      version: 3,
      patch: { properties: { title: [['Peer overwrite']] }, alive: false },
    });

    // `properties` is shadowed by the in-flight local edit; `alive` is not.
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['edit-70'],
    ]);
    expect(store.getState().blocks[PAGE_ID]?.alive).toBe(false);
    manager.dispose();
  });
});
