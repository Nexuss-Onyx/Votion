/**
 * Conflict reconciliation between the local cache and the server.
 *
 * Votion never merges whole records. When a `record_updated` envelope or a
 * `saveTransactions` acknowledgement arrives, the reconciler compares the remote
 * `version` with the cached one and decides, per field, what to keep:
 *
 * | local vs remote            | action                                        |
 * | :------------------------- | :-------------------------------------------- |
 * | remote version ≤ local     | ignore (stale or duplicate broadcast)         |
 * | remote version = local + 1 | fast-forward, then re-apply pending local ops |
 * | remote version > local + 1 | gap: adopt remote, replay pending fields      |
 *
 * Fields with pending local operations are *shadowed*: the remote value is kept
 * in the record but the local field wins until the transaction is acknowledged.
 * That is what stops a slow echo of our own edit from visibly reverting text,
 * while still letting a collaborator's change to a different field land
 * immediately.
 */

import type {
  Block,
  Collection,
  CollectionView,
  OperationPath,
  Transaction,
  UUID,
} from '@votion/types';
import {
  getRecordStore,
  type RecordStoreApi,
  type StoreTableName,
} from '../store/RecordStore.js';

/** A cached record of any table. */
export type AnyRecord = Block | Collection | CollectionView;

/** Classification of a reconciliation decision. */
export type ConflictKind =
  | 'identical'
  | 'remote-newer'
  | 'local-newer'
  | 'diverged'
  | 'missing-local'
  | 'missing-remote';

/** Per-field resolution produced by the reconciler. */
export interface FieldResolution {
  /** Field name (top-level key of the record). */
  field: string;
  /** Value taken from the remote patch. */
  remoteValue: unknown;
  /** Whether the remote value was applied. */
  applied: boolean;
  /** Why the field was kept local (when `applied` is false). */
  reason?: 'pending-local-operation' | 'equal';
}

/** Result of reconciling one remote update. */
export interface ReconcileResult {
  id: UUID;
  table: StoreTableName;
  /** Decision taken for the record as a whole. */
  conflict: ConflictKind;
  /** Version the local record ended up at. */
  version: number;
  /** Per-field outcomes (only for fields present in the remote patch). */
  fields: FieldResolution[];
  /** Fields whose pending local operation shadowed the remote value. */
  shadowed: string[];
  /** Whether the store was mutated. */
  changed: boolean;
}

/** Options accepted by {@link Reconciler}. */
export interface ReconcilerOptions {
  /** Store to reconcile into (defaults to the shared singleton). */
  store?: RecordStoreApi;
  /**
   * Returns the transactions still pending (outbox lookup). Called on every
   * reconciliation, so the sync manager passes a synchronous in-memory view.
   */
  pendingTransactions?: () => Transaction[];
}

/** Extracts the top-level field a path-addressed operation answers for. */
function rootFieldOf(path: OperationPath): string | undefined {
  const [head] = path;
  return typeof head === 'string' ? head : undefined;
}

/**
 * Deep structural equality on JSON values.
 *
 * Records only ever hold JSON (rich text, JSONB property bags, arrays of ids), so
 * this is the right equality for deciding whether a remote field actually changed.
 * Reference equality is *not* enough: two `[['title']]` values decoded from
 * different sources are equal content that must not be treated as a conflict.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!jsonEqual(a[index], b[index])) {
        return false;
      }
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !jsonEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves version discrepancies between local and remote records.
 *
 * The class is deliberately synchronous for the common case (a broadcast with no
 * pending transactions) so realtime updates apply in the same tick.
 */
export class Reconciler {
  private readonly store: RecordStoreApi;
  private readonly pendingTransactions: () => Transaction[];

  constructor(options: ReconcilerOptions = {}) {
    this.store = options.store ?? getRecordStore();
    this.pendingTransactions = options.pendingTransactions ?? (() => []);
  }

  /**
   * Reconciles one remote delta (a `record_updated` envelope or an ack payload).
   *
   * Returns `undefined` when the delta does not address a cached record.
   */
  reconcile(update: {
    table: StoreTableName;
    id: UUID;
    version: number;
    patch: Record<string, unknown>;
  }): ReconcileResult | undefined {
    const snapshot = this.store.getState();
    const local = this.readRecord(snapshot, update.table, update.id);
    if (!local) {
      // Not cached: nothing to merge into — the next `loadPageChunk` will fetch it.
      return {
        id: update.id,
        table: update.table,
        conflict: 'missing-local',
        version: update.version,
        fields: [],
        shadowed: [],
        changed: false,
      };
    }

    const pendingRoots = this.collectPendingRoots(
      update.id,
      this.pendingTransactions(),
    );

    const fields: FieldResolution[] = [];
    const patch: Record<string, unknown> = {};
    const shadowed: string[] = [];

    for (const [field, remoteValue] of Object.entries(update.patch)) {
      const localValue = (local as unknown as Record<string, unknown>)[field];
      if (jsonEqual(localValue, remoteValue)) {
        fields.push({ field, remoteValue, applied: false, reason: 'equal' });
        continue;
      }
      if (pendingRoots.has(field)) {
        shadowed.push(field);
        fields.push({
          field,
          remoteValue,
          applied: false,
          reason: 'pending-local-operation',
        });
        continue;
      }
      patch[field] = remoteValue;
      fields.push({ field, remoteValue, applied: true });
    }

    const localVersion = local.version;
    const conflict = this.classify(
      localVersion,
      update.version,
      shadowed.length > 0,
    );

    if (Object.keys(patch).length === 0) {
      return {
        id: update.id,
        table: update.table,
        conflict,
        version: localVersion,
        fields,
        shadowed,
        changed: false,
      };
    }

    const nextVersion = Math.max(localVersion, update.version);
    const next = { ...local, ...patch, version: nextVersion } as AnyRecord;
    this.writeRecord(update.table, next);
    return {
      id: update.id,
      table: update.table,
      conflict,
      version: nextVersion,
      fields,
      shadowed,
      changed: true,
    };
  }

  /**
   * Applies server-acknowledged versions after a successful `saveTransactions`.
   *
   * The server is authoritative on `version`; the local record is bumped forward
   * (never backwards) so the echo of our own transaction becomes a no-op.
   */
  acknowledgeVersions(versions: Record<UUID, number>): number {
    const snapshot = this.store.getState();
    let updated = 0;
    for (const [id, version] of Object.entries(versions)) {
      const block = snapshot.blocks[id];
      const collection = snapshot.collections[id];
      const view = snapshot.collectionViews[id];
      const record = block ?? collection ?? view;
      if (!record || record.version >= version) {
        continue;
      }
      const table: StoreTableName = block
        ? 'block'
        : collection
          ? 'collection'
          : 'collection_view';
      this.writeRecord(table, { ...record, version } as AnyRecord);
      updated += 1;
    }
    return updated;
  }

  /**
   * Classifies a reconciliation.
   *
   * A shadowed field means the user has unacknowledged local intent for the same
   * record, so *any* remote change to it is a genuine divergence — even when the
   * version counters happen to line up.
   */
  private classify(
    localVersion: number,
    remoteVersion: number,
    hasShadowed: boolean,
  ): ConflictKind {
    if (hasShadowed) {
      return 'diverged';
    }
    if (localVersion === remoteVersion) {
      return 'identical';
    }
    return remoteVersion > localVersion ? 'remote-newer' : 'local-newer';
  }

  /** Collects the top-level fields touched by still-pending transactions. */
  private collectPendingRoots(
    recordId: UUID,
    pending: Transaction[],
  ): Set<string> {
    const roots = new Set<string>();
    for (const transaction of pending) {
      for (const operation of transaction.operations) {
        if (operation.pointer.id !== recordId) {
          continue;
        }
        const root = rootFieldOf(operation.path);
        if (root) {
          roots.add(root);
        }
      }
    }
    return roots;
  }

  /** Reads a record of any table from a store snapshot. */
  private readRecord(
    snapshot: {
      blocks: Record<UUID, Block>;
      collections: Record<UUID, Collection>;
      collectionViews: Record<UUID, CollectionView>;
    },
    table: StoreTableName,
    id: UUID,
  ): AnyRecord | undefined {
    switch (table) {
      case 'block':
        return snapshot.blocks[id];
      case 'collection':
        return snapshot.collections[id];
      case 'collection_view':
        return snapshot.collectionViews[id];
    }
  }

  /** Writes a reconciled record back into the store. */
  private writeRecord(table: StoreTableName, record: AnyRecord): void {
    const actions = this.store.getState();
    switch (table) {
      case 'block':
        actions.setRecord('block', record as Block);
        return;
      case 'collection':
        actions.setRecord('collection', record as Collection);
        return;
      case 'collection_view':
        actions.setRecord('collection_view', record as CollectionView);
        return;
    }
  }
}
