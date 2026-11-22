/**
 * Optimistic patcher.
 *
 * Applies a transaction's operations straight to the Zustand record store before
 * a single byte hits the network, which is what makes Votion feel local-first:
 * a keystroke lands in memory synchronously and the UI re-renders on the next
 * microtask, while the outbox drains in the background.
 *
 * Guarantees:
 *  - **Immutability**: records are deep-cloned along the touched path only, so
 *    untouched slices keep their identity and memoisd selectors stay valid.
 *  - **Atomicity**: all operations are staged on a draft store and committed in a
 *    single `set`, so subscribers never observe a half-applied transaction.
 *  - **Idempotency-tolerant**: operations on missing records are skipped and
 *    reported in {@link PatchResult.skipped}, never thrown. A late realtime echo
 *    of the same operation is therefore harmless.
 */

import type {
  Block,
  Collection,
  CollectionView,
  Operation,
  OperationPath,
  OperationTable,
  ServerSocketMessage,
  Transaction,
  UUID,
} from '@votion/types';
import { isRecordUpdatedEnvelope } from '@votion/types';
import {
  getRecordStore,
  type RecordStore,
  type RecordStoreApi,
  type RecordTables,
  type RecordTypeMap,
  type StoreTableName,
} from '../store/RecordStore.js';

/** Outcome of applying one transaction. */
export interface PatchResult {
  /** Transaction id that was applied. */
  transactionId: UUID;
  /** Records touched, in first-touch order. */
  touched: TouchedRecord[];
  /** Number of operations that mutated local state. */
  applied: number;
  /** Operations that could not be applied (missing record / bad path). */
  skipped: SkippedOperation[];
}

/** A record mutated by a patch, with its pre-patch snapshot. */
export interface TouchedRecord {
  table: StoreTableName;
  id: UUID;
  before: Block | Collection | CollectionView | undefined;
  after: Block | Collection | CollectionView;
}

/** An operation that could not be applied, with the reason. */
export interface SkippedOperation {
  operation: Operation;
  reason: string;
}

/** Options accepted by {@link OptimisticPatcher}. */
export interface OptimisticPatcherOptions {
  /** Store to patch (defaults to the shared singleton). */
  store?: RecordStoreApi;
  /** Clock used for `last_edited_time` (defaults to `Date.now`). */
  now?: () => number;
  /** Stamp `last_edited_time` on the root record of each touched transaction. */
  touchTimestamps?: boolean;
}

/** Mutable draft used to stage a transaction atomically. */
interface PatchDraft {
  blocks: Record<UUID, Block>;
  collections: Record<UUID, Collection>;
  collectionViews: Record<UUID, CollectionView>;
}

/** Prepares a mutable deep copy of the value at `path` for in-place mutation. */
function cloneAlongPath(
  root: unknown,
  path: OperationPath,
): { container: unknown } {
  if (path.length === 0) {
    return { container: root };
  }
  const [head, ...rest] = path as [string | number, ...OperationPath];
  if (Array.isArray(root)) {
    const index = Number(head);
    const next = [...root];
    (next as unknown[])[index] = cloneAlongPath(root[index], rest).container;
    return { container: next };
  }
  if (typeof root === 'object' && root !== null) {
    const record = root as Record<string, unknown>;
    const next = { ...record };
    next[String(head)] = cloneAlongPath(record[String(head)], rest).container;
    return { container: next };
  }
  return { container: root };
}

/**
 * Reads the value at `path`, returning `undefined` when any hop is missing.
 */
function readPath(root: unknown, path: OperationPath): unknown {
  let cursor = root;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

/**
 * Writes `value` at `path`, returning a new root.
 *
 * All ancestors along the path are cloned so the caller's input is untouched.
 */
function writePath<T>(root: T, path: OperationPath, value: unknown): T {
  if (path.length === 0) {
    return value as T;
  }
  const clone = cloneAlongPath(root, path).container;
  let cursor = clone as Record<string | number, unknown>;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index] as string | number;
    cursor = cursor[key] as Record<string | number, unknown>;
  }
  cursor[path[path.length - 1] as string | number] = value;
  return clone as T;
}

/** Applies one `set` / `update` / `list*` / `keyedObjectSet` operation to a record. */
function applyOperation(
  record: Block | Collection | CollectionView,
  operation: Operation,
): {
  record: Block | Collection | CollectionView;
  applied: boolean;
  reason?: string;
} {
  switch (operation.command) {
    case 'set': {
      return {
        record: writePath(record, operation.path, operation.args),
        applied: true,
      };
    }
    case 'update': {
      const current = readPath(record, operation.path);
      const base =
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {};
      return {
        record: writePath(record, operation.path, {
          ...base,
          ...operation.args,
        }),
        applied: true,
      };
    }
    case 'keyedObjectSet': {
      const current = readPath(record, operation.path);
      const base =
        current !== null &&
        typeof current === 'object' &&
        !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {};
      return {
        record: writePath(record, operation.path, {
          ...base,
          [operation.args.key]: operation.args.value,
        }),
        applied: true,
      };
    }
    case 'listAfter':
    case 'listBefore': {
      const current = readPath(record, operation.path);
      if (!Array.isArray(current)) {
        return { record, applied: false, reason: 'target path is not a list' };
      }
      const list = (current as UUID[]).filter((id) => id !== operation.args.id);
      const anchor =
        operation.command === 'listAfter'
          ? operation.args.after
          : operation.args.before;
      if (anchor === null || anchor === undefined) {
        if (operation.command === 'listAfter') {
          list.unshift(operation.args.id);
        } else {
          list.push(operation.args.id);
        }
      } else {
        const anchorIndex = list.indexOf(anchor);
        if (anchorIndex === -1) {
          return {
            record,
            applied: false,
            reason: `anchor ${anchor} not found in list`,
          };
        }
        list.splice(
          operation.command === 'listAfter' ? anchorIndex + 1 : anchorIndex,
          0,
          operation.args.id,
        );
      }
      return { record: writePath(record, operation.path, list), applied: true };
    }
    case 'listRemove': {
      const current = readPath(record, operation.path);
      if (!Array.isArray(current)) {
        return { record, applied: false, reason: 'target path is not a list' };
      }
      const list = (current as UUID[]).filter((id) => id !== operation.args.id);
      if (list.length === (current as UUID[]).length) {
        return {
          record,
          applied: false,
          reason: `id ${operation.args.id} not present in list`,
        };
      }
      return { record: writePath(record, operation.path, list), applied: true };
    }
    default: {
      const exhaustive: never = operation;
      return {
        record,
        applied: false,
        reason: `unsupported command ${(exhaustive as Operation).command}`,
      };
    }
  }
}

/** Copies the three slices into a mutable draft and drops nothing else. */
function draftFrom(state: RecordTables): PatchDraft {
  return {
    blocks: { ...state.blocks },
    collections: { ...state.collections },
    collectionViews: { ...state.collectionViews },
  };
}

/** Reads one draft slice through the table discriminant. */
function draftSlice(
  draft: PatchDraft,
  table: OperationTable,
): Record<UUID, RecordTypeMap[StoreTableName]> {
  switch (table) {
    case 'block':
      return draft.blocks;
    case 'collection':
      return draft.collections;
    case 'collection_view':
      return draft.collectionViews;
    default:
      throw new Error(`Unknown record table: ${String(table)}`);
  }
}

/** Writes one patched record back into the draft. */
function writeDraft(
  draft: PatchDraft,
  table: OperationTable,
  record: Block | Collection | CollectionView,
): void {
  switch (table) {
    case 'block':
      draft.blocks[record.id] = record as Block;
      return;
    case 'collection':
      draft.collections[record.id] = record as Collection;
      return;
    case 'collection_view':
      draft.collectionViews[record.id] = record as CollectionView;
      return;
    default:
      throw new Error(`Unknown record table: ${String(table)}`);
  }
}

/**
 * Applies transactions to the in-memory record store.
 *
 * One patcher instance is normally held by the `SyncManager`, but it is stateless
 * apart from the store reference, so tests and feature code can construct their
 * own against an isolated store.
 */
export class OptimisticPatcher {
  private readonly store: RecordStoreApi;
  private readonly now: () => number;
  private readonly touchTimestamps: boolean;

  constructor(options: OptimisticPatcherOptions = {}) {
    this.store = options.store ?? getRecordStore();
    this.now = options.now ?? Date.now;
    this.touchTimestamps = options.touchTimestamps ?? true;
  }

  /** The store this patcher mutates. */
  get target(): RecordStoreApi {
    return this.store;
  }

  /**
   * Synchronously applies every operation of `transaction`.
   *
   * Returns a report of touched records and skipped operations. Never throws for
   * data reasons (a missing record is a skip, not an error) — only a corrupt
   * store implementation can raise.
   */
  applyTransaction(transaction: Transaction): PatchResult {
    return this.applyTransactions([transaction]);
  }

  /** Applies several transactions atomically (one commit, in order). */
  applyTransactions(transactions: Transaction[]): PatchResult {
    const snapshot = this.store.getState();
    const draft = draftFrom(snapshot);
    const touched = new Map<string, TouchedRecord>();
    const skipped: SkippedOperation[] = [];
    let applied = 0;

    for (const transaction of transactions) {
      for (const operation of transaction.operations) {
        const table = operation.pointer.table;
        const slice = draftSlice(draft, table);
        const current = slice[operation.pointer.id];

        if (!current) {
          skipped.push({
            operation,
            reason: `record ${operation.pointer.id} is not cached locally`,
          });
          continue;
        }

        const result = applyOperation(current, operation);
        if (!result.applied) {
          skipped.push({
            operation,
            reason: result.reason ?? 'operation was not applicable',
          });
          continue;
        }

        const key = `${table}:${current.id}`;
        writeDraft(draft, table, result.record);
        applied += 1;

        const existing = touched.get(key);
        if (existing) {
          existing.after = result.record as Block | Collection | CollectionView;
        } else {
          touched.set(key, {
            table: table as StoreTableName,
            id: current.id,
            before: snapshot[
              table === 'block'
                ? 'blocks'
                : table === 'collection'
                  ? 'collections'
                  : 'collectionViews'
            ][current.id] as Block | Collection | CollectionView | undefined,
            after: result.record as Block | Collection | CollectionView,
          });
        }
      }
    }

    if (applied > 0) {
      const timestamp = this.now();
      for (const record of touched.values()) {
        if (!this.touchTimestamps || !('last_edited_time' in record.after)) {
          continue;
        }
        // Stamp the audit field on the *stored* copy, then mirror it into the
        // report so callers persisting `touched` write the same value to Dexie.
        const stamped = { ...record.after, last_edited_time: timestamp };
        record.after = stamped;
        writeDraft(draft, record.table, stamped);
      }
      this.store.setState({
        blocks: draft.blocks,
        collections: draft.collections,
        collectionViews: draft.collectionViews,
        revision: snapshot.revision + 1,
      });
    }

    return {
      transactionId: transactions[0]?.id ?? '',
      touched: [...touched.values()],
      applied,
      skipped,
    };
  }

  /**
   * Applies a `record_updated` realtime envelope from the gateway.
   *
   * The patch is shallow-merged onto the cached record and the version is raised,
   * which is exactly the semantics the server guarantees for a broadcast delta.
   */
  applyRemotePatch(message: ServerSocketMessage): boolean {
    if (!isRecordUpdatedEnvelope(message)) {
      return false;
    }
    const snapshot = this.store.getState();
    const draft = draftFrom(snapshot);
    const table = message.table;
    if (table === 'space') {
      return false;
    }
    const slice = draftSlice(draft, table);
    const current = slice[message.id];
    if (!current) {
      return false;
    }
    const next = {
      ...current,
      ...message.patch,
      version: Math.max(current.version, message.version),
    } as Block | Collection | CollectionView;
    writeDraft(draft, table, next);
    this.store.setState({
      blocks: draft.blocks,
      collections: draft.collections,
      collectionViews: draft.collectionViews,
      revision: snapshot.revision + 1,
    });
    return true;
  }

  /** Reads the current store state (helper for callers without a store handle). */
  get state(): RecordStore {
    return this.store.getState();
  }
}
