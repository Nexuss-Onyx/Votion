/**
 * Sync manager — the orchestrator of the local-first lifecycle.
 *
 * For every mutation the manager performs exactly the sequence described in
 * `Components.md` §5:
 *
 * ```text
 * 1. OptimisticPatcher   → apply to the Zustand store (UI updates in 0 ms)
 * 2. IndexedDBStorage    → persist the touched records (survives refresh)
 * 3. OutboxStorage       → queue the transaction (survives offline)
 * 4. HTTP                → POST /api/v3/saveTransactions when online
 * 5. OutboxStorage       → dequeue only what the server acknowledged
 * ```
 *
 * When the network is down, step 4 is skipped and a `window` `online` listener
 * (plus a retry timer) flushes the queue in strict order once connectivity
 * returns. A failed batch stops the flush immediately: because replay order is
 * guaranteed, applying transaction *n+1* while *n* is still pending would corrupt
 * list operations, so the queue head is always the blocking element.
 */

import type {
  Block,
  Collection,
  CollectionView,
  RecordUpdatedEnvelope,
  SaveTransactionsResponse,
  Transaction,
  UUID,
} from '@votion/types';
import { isRecordUpdatedEnvelope } from '@votion/types';
import {
  getRecordStore,
  type RecordStoreApi,
  type RecordTypeMap,
  type StoreTableName,
} from '../store/RecordStore.js';
import { IndexedDBStorage } from '../storage/IndexedDBStorage.js';
import { OutboxStorage, type OutboxEntry } from '../storage/OutboxStorage.js';
import { OptimisticPatcher } from '../transaction/OptimisticPatcher.js';
import type { PatchResult } from '../transaction/OptimisticPatcher.js';
import { Reconciler } from './Reconciler.js';
import { RetryStrategy, type RetryDecision } from './RetryStrategy.js';

/** Minimal structural view of `window`, so the manager runs headless in Node. */
export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Response shape returned by the transaction fetcher. */
export type SaveTransactionsResult = SaveTransactionsResponse | { ok: boolean };

/** Transport abstraction for `POST /api/v3/saveTransactions`. */
export type SaveTransactionsFetcher = (
  body: { requestId: UUID; transactions: Transaction[] },
  signal?: AbortSignal,
) => Promise<SaveTransactionsResult>;

/** Options accepted by {@link SyncManager}. */
export interface SyncManagerOptions {
  /** Record store to mutate (defaults to the shared singleton). */
  store?: RecordStoreApi;
  /** IndexedDB persistence facade. */
  storage?: IndexedDBStorage;
  /** Persistent transaction queue. */
  outbox?: OutboxStorage;
  /** Optimistic patcher instance. */
  patcher?: AtomicPatcher;
  /** Reconciler used for inbound realtime updates. */
  reconciler?: Reconciler;
  /** Retry policy for failed flushes. */
  retryStrategy?: RetryStrategy;
  /** `saveTransactions` transport (defaults to `fetch`). */
  fetcher?: SaveTransactionsFetcher;
  /** Endpoint of the transaction API. */
  endpoint?: string;
  /** Event target that emits `online` / `offline` (defaults to `window`). */
  eventTarget?: EventTargetLike;
  /** Connectivity probe (defaults to `navigator.onLine`). */
  isOnline?: () => boolean;
  /** Generate request ids (defaults to `crypto.randomUUID`). */
  requestIdGenerator?: () => UUID;
  /** Maximum transactions per HTTP batch. */
  batchSize?: number;
  /** Maximum time to wait for a dispatch before aborting (ms). */
  requestTimeoutMs?: number;
  /** Automatically flush the queue when the manager becomes online. */
  autoFlush?: boolean;
  /** Clock (injectable for deterministic tests). */
  now?: () => number;
}

/** Lifecycle state of the sync engine. */
export interface SyncStatus {
  /** Whether a dispatch is currently in flight. */
  flushing: boolean;
  /** Whether the browser reports connectivity. */
  online: boolean;
  /** Transactions still waiting in the outbox. */
  pending: number;
  /** Transactions acknowledged since the manager was created. */
  synced: number;
  /** Last transport/server error, if the last flush failed. */
  lastError?: string;
  /** Scheduled retry decision, when a backoff timer is armed. */
  retry?: RetryDecision;
}

/** Result of a single flush pass. */
export interface FlushResult {
  /** Transactions successfully acknowledged by the server. */
  synced: number;
  /** Transactions left in the queue afterwards. */
  pending: number;
  /** Error that stopped the flush, when it failed. */
  error?: string;
  /** Whether another pass should be retried automatically. */
  retry: boolean;
  /** Backoff decision when `retry` is `true`. */
  retryDecision?: RetryDecision;
}

/** Structural contract satisfied by the real `OptimisticPatcher`. */
export interface AtomicPatcher {
  applyTransaction(transaction: Transaction): PatchResult;
  applyTransactions(transactions: Transaction[]): PatchResult;
}

/** Envelope accepted by {@link SyncManager.applyRemoteUpdate}. */
export type InboundUpdate = RecordUpdatedEnvelope;

const DEFAULT_ENDPOINT = '/api/v3/saveTransactions';

/** Resolves the ambient `window`, when one exists. */
function ambientEventTarget(): EventTargetLike | undefined {
  const candidate = (globalThis as { window?: unknown }).window;
  if (
    candidate &&
    typeof (candidate as EventTargetLike).addEventListener === 'function'
  ) {
    return candidate as EventTargetLike;
  }
  return undefined;
}

/** Minimal UUID generator with a Math.random fallback. */
function defaultRequestId(): UUID {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/**
 * Coordinates optimistic local writes, persistence and network synchronisation.
 */
export class SyncManager {
  private readonly store: RecordStoreApi;
  private readonly storage: IndexedDBStorage;
  private readonly outbox: OutboxStorage;
  private readonly patcher: AtomicPatcher;
  private readonly reconciler: Reconciler;
  private readonly retryStrategy: RetryStrategy;
  private readonly fetcher: SaveTransactionsFetcher;
  private readonly endpoint: string;
  private readonly eventTarget?: EventTargetLike;
  private readonly onlineProbe: () => boolean;
  private readonly requestIdGenerator: () => UUID;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;
  private readonly autoFlush: boolean;
  private readonly now: () => number;

  private readonly onlineHandler = () => {
    if (this.autoFlush) {
      this.scheduleBackgroundFlush();
    }
  };
  private readonly offlineHandler = () => {
    this.statusExtra.online = false;
  };

  private statusExtra: SyncStatus & { synced: number } = {
    flushing: false,
    online: true,
    pending: 0,
    synced: 0,
  };
  private flushPromise: Promise<FlushResult> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private listening = false;

  constructor(options: SyncManagerOptions = {}) {
    this.store = options.store ?? getRecordStore();
    this.storage = options.storage ?? new IndexedDBStorage();
    this.outbox = options.outbox ?? new OutboxStorage();
    this.reconciler =
      options.reconciler ??
      new Reconciler({
        store: this.store,
        pendingTransactions: () => this.pendingTransactionsCache,
      });
    this.patcher = options.patcher ?? createDefaultPatcher(this.store);
    this.retryStrategy = options.retryStrategy ?? new RetryStrategy();
    this.fetcher =
      options.fetcher ??
      createFetchTransport(options.endpoint ?? DEFAULT_ENDPOINT);
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.eventTarget = options.eventTarget ?? ambientEventTarget();
    this.onlineProbe = options.isOnline ?? defaultOnlineProbe;
    this.requestIdGenerator = options.requestIdGenerator ?? defaultRequestId;
    this.batchSize = Math.max(1, options.batchSize ?? 20);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 15_000);
    this.autoFlush = options.autoFlush ?? true;
    this.now = options.now ?? Date.now;
    this.statusExtra.online = this.onlineProbe();

    if (this.autoFlush) {
      this.attachListeners();
    }
  }

  /** Transactions currently queued in memory (mirrors the outbox head). */
  private pendingTransactionsCache: Transaction[] = [];

  /** Snapshot of the engine state. */
  get status(): SyncStatus {
    return {
      flushing: this.statusExtra.flushing,
      online: this.statusExtra.online,
      pending: this.pendingTransactionsCache.length,
      synced: this.statusExtra.synced,
      ...(this.statusExtra.lastError
        ? { lastError: this.statusExtra.lastError }
        : {}),
      ...(this.statusExtra.retry ? { retry: this.statusExtra.retry } : {}),
    };
  }

  /** Endpoint this manager dispatches to. */
  get transactionEndpoint(): string {
    return this.endpoint;
  }

  /** The record store this manager writes to. */
  get recordStore(): RecordStoreApi {
    return this.store;
  }

  /**
   * Registers the `online` / `offline` listeners.
   *
   * Called automatically when `autoFlush` is enabled; exposed for callers that
   * construct the manager with `autoFlush: false` and want to opt in later.
   */
  attachListeners(): void {
    if (this.listening || !this.eventTarget) {
      return;
    }
    this.eventTarget.addEventListener('online', this.onlineHandler);
    this.eventTarget.addEventListener('offline', this.offlineHandler);
    this.listening = true;
  }

  /** Removes the connectivity listeners (teardown). */
  detachListeners(): void {
    if (!this.listening || !this.eventTarget) {
      return;
    }
    this.eventTarget.removeEventListener('online', this.onlineHandler);
    this.eventTarget.removeEventListener('offline', this.offlineHandler);
    this.listening = false;
  }

  /**
   * Applies a mutation locally and queues it for the server.
   *
   * This is the hot path of the entire application: it resolves after the local
   * commit and the IndexedDB write, and it only awaits the network when the
   * caller opts in via `dispatch: true`.
   *
   * ```ts
   * const tx = new TransactionBuilder(target).set(['properties','title'], [[text]]).build();
   * await syncManager.submit(tx);                       // local + queued, background sync
   * await syncManager.submit(tx, { dispatch: true });   // local + queued + flushed
   * ```
   */
  async submit(
    transaction: Transaction,
    options: { dispatch?: boolean } = {},
  ): Promise<PatchResult> {
    const patch = this.patcher.applyTransaction(transaction);

    await this.persistTouched(patch.touched);
    await this.outbox.enqueueTransaction(transaction, this.now());
    this.pendingTransactionsCache = [
      ...this.pendingTransactionsCache.filter(
        (pending) => pending.id !== transaction.id,
      ),
      transaction,
    ];
    this.statusExtra.pending = this.pendingTransactionsCache.length;

    const wantsDispatch = options.dispatch ?? this.onlineProbe();
    if (wantsDispatch && this.onlineProbe()) {
      this.scheduleBackgroundFlush();
    }
    return patch;
  }

  /** Applies a batch of transactions locally, then queues them together. */
  async submitMany(transactions: Transaction[]): Promise<PatchResult> {
    if (transactions.length === 0) {
      return { transactionId: '', touched: [], applied: 0, skipped: [] };
    }
    const patch = this.patcher.applyTransactions(transactions);
    await this.persistTouched(patch.touched);
    await this.outbox.enqueueTransactions(transactions, this.now());
    this.pendingTransactionsCache = [
      ...this.pendingTransactionsCache.filter(
        (pending) =>
          !transactions.some((transaction) => transaction.id === pending.id),
      ),
      ...transactions,
    ];
    this.statusExtra.pending = this.pendingTransactionsCache.length;
    if (this.onlineProbe()) {
      this.scheduleBackgroundFlush();
    }
    return patch;
  }

  /**
   * Drains the outbox in order.
   *
   * Concurrent calls share the in-flight promise: an `online` event racing a
   * user action must never dispatch the same batch twice.
   */
  async flush(options: { force?: boolean } = {}): Promise<FlushResult> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.runFlush(options).finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  /**
   * Applies a realtime `record_updated` envelope (or any inbound update).
   *
   * The reconciler decides per field whether the remote value wins, then the
   * merged record is written back to IndexedDB so a refresh keeps the merge.
   */
  applyRemoteUpdate(message: InboundUpdate | unknown): boolean {
    if (!isRecordUpdatedEnvelope(message as never)) {
      return false;
    }
    const envelope = message as RecordUpdatedEnvelope;
    const result = this.reconciler.reconcile({
      table: envelope.table as StoreTableName,
      id: envelope.id,
      version: envelope.version,
      patch: envelope.patch,
    });
    if (!result?.changed) {
      return false;
    }
    // Fire-and-forget, but never unhandled: a failed cache write must not crash
    // the tab, and the next navigation re-reads from the server anyway.
    void this.persistRecordAfterReconcile(result.table, result.id).catch(
      (error: unknown) => {
        this.statusExtra.lastError =
          error instanceof Error ? error.message : String(error);
      },
    );
    return true;
  }

  /** Hydrates the store from IndexedDB and restores the persisted outbox. */
  async hydrate(
    options: { spaceId?: UUID } = {},
  ): Promise<{ records: number; pending: number }> {
    const snapshot = await this.storage.loadAllLocalRecords(
      options.spaceId ? { spaceId: options.spaceId } : {},
    );
    this.store.getState().loadRecords({
      block: snapshot.block,
      collection: snapshot.collection,
      collection_view: snapshot.collection_view,
    });
    this.store.getState().markHydrated(true);

    const pending = await this.outbox.peekTransactions(
      options.spaceId ? { spaceId: options.spaceId } : {},
    );
    this.pendingTransactionsCache = pending.map((entry) => entry.transaction);
    this.statusExtra.pending = this.pendingTransactionsCache.length;

    if (pending.length > 0 && this.onlineProbe()) {
      this.scheduleBackgroundFlush();
    }
    return { records: snapshot.count, pending: pending.length };
  }

  /** Wipes local records and the outbox, then resets the store. */
  async resetLocalState(): Promise<void> {
    await this.storage.clearLocalData({ includeOutbox: true });
    this.store.getState().clearRecords();
    this.pendingTransactionsCache = [];
    this.statusExtra = {
      flushing: false,
      online: this.onlineProbe(),
      pending: 0,
      synced: 0,
    };
  }

  /** Releases timers and listeners (tests / unmount). */
  dispose(): void {
    this.detachListeners();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  /** Implementation of {@link flush} (single-flight via `flushPromise`). */
  private async runFlush(options: { force?: boolean }): Promise<FlushResult> {
    const online = options.force ? true : this.onlineProbe();
    this.statusExtra.online = online;

    const queued = await this.outbox.peekTransactions();
    this.pendingTransactionsCache = queued.map((entry) => entry.transaction);
    this.statusExtra.pending = queued.length;

    if (!online) {
      return {
        synced: 0,
        pending: queued.length,
        retry: true,
        error: 'offline',
      };
    }
    if (queued.length === 0) {
      this.retryStrategy.reset();
      return { synced: 0, pending: 0, retry: false };
    }

    this.statusExtra.flushing = true;
    let synced = 0;

    try {
      // Drain until the queue is empty; each pass re-reads the head so batches
      // appended during a flush are picked up in the same pass.
      for (
        let batch = await this.outbox.peekTransactions();
        batch.length > 0;
      ) {
        batch = batch.slice(0, this.batchSize);
        await this.dispatchBatch(batch);
        synced += batch.length;
        this.statusExtra.synced += batch.length;
        this.pendingTransactionsCache = (
          await this.outbox.peekTransactions()
        ).map((entry) => entry.transaction);
        this.statusExtra.pending = this.pendingTransactionsCache.length;
        batch = await this.outbox.peekTransactions();
      }
      this.retryStrategy.reset();
      this.statusExtra.lastError = undefined;
      this.statusExtra.retry = undefined;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      return { synced, pending: this.statusExtra.pending, retry: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = this.retryStrategy.next(error);
      this.statusExtra.lastError = message;
      this.statusExtra.retry = decision;
      this.pendingTransactionsCache = (
        await this.outbox.peekTransactions()
      ).map((entry) => entry.transaction);
      this.statusExtra.pending = this.pendingTransactionsCache.length;
      if (decision.shouldRetry) {
        this.scheduleRetry(decision);
      }
      return {
        synced,
        pending: this.statusExtra.pending,
        error: message,
        retry: decision.shouldRetry,
        retryDecision: decision,
      };
    } finally {
      this.statusExtra.flushing = false;
    }
  }

  /**
   * Sends one batch and removes it from the outbox on success.
   *
   * A rejected transaction (server `applied: false`) is a *permanent* data
   * conflict: it is recorded and dequeued so it cannot block the queue forever;
   * the reconciler will pull the authoritative record on the next page load.
   */
  private async dispatchBatch(batch: OutboxEntry[]): Promise<void> {
    const transactions = batch.map((entry) => entry.transaction);
    const requestId = this.requestIdGenerator();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetcher(
        { requestId, transactions },
        controller.signal,
      );
      if ('requestId' in response) {
        const results = response.results ?? [];
        const versions: Record<UUID, number> = {};
        const rejected = new Set<UUID>();
        for (const result of results) {
          Object.assign(versions, result.versions ?? {});
          if (!result.applied) {
            rejected.add(result.id);
          }
        }
        this.reconciler.acknowledgeVersions(versions);
        await this.outbox.dequeueTransactions(
          transactions.map((transaction) => transaction.id),
        );
        for (const id of rejected) {
          const entry = batch.find(
            (candidate) => candidate.transaction.id === id,
          );
          if (entry) {
            await this.outbox.recordAttempt(id, 'rejected by server');
          }
        }
      } else if (response.ok) {
        await this.outbox.dequeueTransactions(
          transactions.map((transaction) => transaction.id),
        );
      } else {
        throw new Error('saveTransactions failed');
      }
    } catch (error) {
      for (const transaction of transactions) {
        await this.outbox.recordAttempt(
          transaction.id,
          error instanceof Error ? error.message : String(error),
          this.now(),
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Persists records touched by a local (optimistic) patch. */
  private async persistTouched(touched: PatchResult['touched']): Promise<void> {
    const groups = new Map<
      StoreTableName,
      (Block | Collection | CollectionView)[]
    >();
    for (const record of touched) {
      const list = groups.get(record.table) ?? [];
      list.push(record.after);
      groups.set(record.table, list);
    }
    for (const [table, records] of groups) {
      await this.storage.persistRecords(table, records as never[]);
    }
  }

  /** Persists one reconciled record back to IndexedDB. */
  private async persistRecordAfterReconcile(
    table: StoreTableName,
    id: UUID,
  ): Promise<void> {
    const state = this.store.getState();
    const record =
      table === 'block'
        ? state.blocks[id]
        : table === 'collection'
          ? state.collections[id]
          : state.collectionViews[id];
    if (record) {
      await this.storage.persistRecord(
        table,
        record as RecordTypeMap[StoreTableName],
      );
    }
  }

  /**
   * Kicks off a background flush without awaiting it.
   *
   * The rejection is swallowed (and surfaced through `status.lastError`) because
   * a background sync failure is already reported by {@link flush}'s own result;
   * letting it escape would produce an unhandled rejection in the browser.
   */
  private scheduleBackgroundFlush(): void {
    void this.flush().catch((error: unknown) => {
      this.statusExtra.lastError =
        error instanceof Error ? error.message : String(error);
    });
  }

  /** Arms the backoff timer for the next flush attempt. */
  private scheduleRetry(decision: RetryDecision): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    if (!decision.shouldRetry) {
      this.retryTimer = undefined;
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.scheduleBackgroundFlush();
    }, decision.delayMs);
    // Never keep a Node process (or a test runner) alive for a retry timer.
    const timer = this.retryTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }
}

/** Default connectivity probe. */
function defaultOnlineProbe(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine ?? true;
}

/** Creates the default `fetch`-based transport. */
export function createFetchTransport(
  endpoint: string = DEFAULT_ENDPOINT,
  fetchImpl: typeof fetch | undefined = globalThis.fetch,
): SaveTransactionsFetcher {
  return async (body, signal) => {
    if (!fetchImpl) {
      throw new Error('No fetch implementation available in this runtime');
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const error = new Error(
        `saveTransactions failed with ${response.status}`,
      );
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return (await response.json()) as SaveTransactionsResponse;
  };
}

/** Default patcher factory (overridable for tests via `options.patcher`). */
export function createDefaultPatcher(store: RecordStoreApi): AtomicPatcher {
  return new OptimisticPatcher({ store });
}
