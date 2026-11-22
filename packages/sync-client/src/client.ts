/**
 * `VotionClient` — composition root for the local-first engine.
 *
 * The web app constructs exactly one client per workspace session:
 *
 * ```ts
 * const client = await VotionClient.bootstrap({ spaceId });
 * await client.submit(tx);            // optimistic write + queued sync
 * client.usePresence({ pageId, userId });
 * client.dispose();
 * ```
 *
 * Bundling the store, storage, sync manager and presence client into one object
 * keeps application code from wiring the pieces (and their IndexedDB handles)
 * together by hand, and makes teardown a single call.
 */

import type { PresenceEnvelope, Transaction, UUID } from '@votion/types';
import { getRecordStore, type RecordStoreApi } from './store/RecordStore.js';
import { IndexedDBStorage } from './storage/IndexedDBStorage.js';
import { OutboxStorage } from './storage/OutboxStorage.js';
import {
  hydrateFromLocalCache,
  type HydrationResult,
} from './storage/Hydration.js';
import {
  SyncManager,
  type SaveTransactionsFetcher,
  type SyncManagerOptions,
} from './sync/SyncManager.js';
import {
  PresenceClient,
  type PresenceClientOptions,
} from './presence/PresenceClient.js';
import { OptimisticPatcher } from './transaction/OptimisticPatcher.js';

/** Options accepted by {@link VotionClient.create} / {@link VotionClient.bootstrap}. */
export interface VotionClientOptions extends Omit<
  SyncManagerOptions,
  'store' | 'storage' | 'outbox'
> {
  /** Workspace id (scopes hydration and the outbox). */
  spaceId?: UUID;
  /**
   * Store override (tests / per-workspace isolation).
   *
   * Defaults to the shared singleton so React components reading through
   * `useRecordStore()` observe the same records the sync engine writes.
   */
  store?: RecordStoreApi;
  /** Persistence facade override. */
  storage?: IndexedDBStorage;
  /** Outbox override. */
  outbox?: OutboxStorage;
  /** Hydrate from IndexedDB during `bootstrap` (defaults to `true`). */
  hydrate?: boolean;
}

/** Presence options minus the identifiers the client already knows. */
export type ClientPresenceOptions = Omit<PresenceClientOptions, 'send'> & {
  send?: (message: PresenceEnvelope) => void;
};

/** Composition root of the client engine. */
export class VotionClient {
  /** Normalized in-memory record store. */
  readonly store: RecordStoreApi;
  /** IndexedDB persistence facade. */
  readonly storage: IndexedDBStorage;
  /** Persistent outbox queue. */
  readonly outbox: OutboxStorage;
  /** Sync orchestrator. */
  readonly sync: SyncManager;
  /** Workspace the client was opened for. */
  readonly spaceId?: UUID;

  private presenceClient?: PresenceClient;
  private readonly options: VotionClientOptions;

  constructor(options: VotionClientOptions = {}) {
    this.options = options;
    this.spaceId = options.spaceId;
    this.store = options.store ?? getRecordStore();
    this.storage = options.storage ?? new IndexedDBStorage();
    this.outbox = options.outbox ?? new OutboxStorage();
    this.sync = new SyncManager({
      ...options,
      store: this.store,
      storage: this.storage,
      outbox: this.outbox,
      patcher: options.patcher ?? new OptimisticPatcher({ store: this.store }),
    });
  }

  /**
   * Creates a client bound to the shared record store (or an explicit override).
   *
   * Use this for tests or per-workspace isolation by passing `store`; use
   * {@link VotionClient.bootstrap} when the local cache should be hydrated first.
   */
  static create(options: VotionClientOptions = {}): VotionClient {
    return new VotionClient(options);
  }

  /**
   * Creates a client and hydrates it from IndexedDB.
   *
   * Construction never throws for a missing IndexedDB: hydration degrades to an
   * empty cache and the sync manager simply waits for the server response.
   */
  static async bootstrap(
    options: VotionClientOptions = {},
  ): Promise<{ client: VotionClient; hydration: HydrationResult }> {
    const client = new VotionClient(options);
    if (options.hydrate === false) {
      return {
        client,
        hydration: { records: 0, pending: 0, hydrated: false },
      };
    }
    const hydration = await hydrateFromLocalCache({
      store: client.store,
      storage: client.storage,
      outbox: client.outbox,
      ...(options.spaceId ? { spaceId: options.spaceId } : {}),
    });
    if (hydration.pending > 0 && client.sync.status.online) {
      void client.sync.flush();
    }
    return { client, hydration };
  }

  /**
   * Submits a transaction: local commit → IndexedDB → outbox → background sync.
   *
   * Resolves as soon as the local commit is durable, so a keystroke never waits
   * on the network.
   */
  async submit(transaction: Transaction, options: { dispatch?: boolean } = {}) {
    return this.sync.submit(transaction, options);
  }

  /** Submits several transactions as one local commit and one queue append. */
  async submitMany(transactions: Transaction[]) {
    return this.sync.submitMany(transactions);
  }

  /** Drains the outbox now (used by "retry" buttons and visibility handlers). */
  async flush() {
    return this.sync.flush();
  }

  /** Attaches (or re-attaches) the presence client for a page. */
  usePresence(options: ClientPresenceOptions): PresenceClient {
    this.presenceClient?.destroy();
    this.presenceClient = new PresenceClient({
      ...options,
      send: options.send ?? (() => undefined),
    });
    return this.presenceClient;
  }

  /** The active presence client, when one has been attached. */
  get presence(): PresenceClient | undefined {
    return this.presenceClient;
  }

  /** Idempotent teardown: listeners, timers and presence state. */
  dispose(): void {
    this.presenceClient?.destroy();
    this.presenceClient = undefined;
    this.sync.dispose();
  }
}

/** Convenience factory mirroring {@link VotionClient.bootstrap}. */
export async function createVotionClient(
  options: VotionClientOptions = {},
): Promise<{ client: VotionClient; hydration: HydrationResult }> {
  return VotionClient.bootstrap(options);
}

/** Re-exported for callers wiring a custom transport. */
export type { SaveTransactionsFetcher };
