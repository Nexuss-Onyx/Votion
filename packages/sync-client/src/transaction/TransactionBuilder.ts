/**
 * Command-pattern transaction builder.
 *
 * The builder is the *only* sanctioned way for UI code to mutate records. It
 * produces serialisable, path-addressed operations — never a whole-record PATCH —
 * so the server can replay them with `jsonb_set`, diff them for the realtime
 * gateway, and keep concurrent editors from clobbering each other's fields.
 *
 * ```ts
 * const tx = new TransactionBuilder({ spaceId, table: 'block', id: pageId })
 *   .set(['properties', 'title'], [['New title']])
 *   .listAfter(['content'], lastChildId, newBlockId)
 *   .build();
 * ```
 */

import type {
  Operation,
  OperationPath,
  OperationTable,
  Transaction,
  UUID,
} from '@votion/types';
import {
  listAfterOperation,
  listBeforeOperation,
  listRemoveOperation,
  keyedObjectSetOperation,
  setOperation,
  updateOperation,
} from '@votion/types';

/** Record pointer plus workspace scope accepted by the builder constructor. */
export interface TransactionTarget {
  /** Workspace the records belong to (ACL + routing scope). */
  spaceId: UUID;
  /** Table the operations address. */
  table: OperationTable;
  /** Record id the operations address. */
  id: UUID;
}

/** Options accepted by {@link TransactionBuilder}. */
export interface TransactionBuilderOptions extends Partial<TransactionTarget> {
  /** Explicit transaction id (defaults to a generated UUID v4). */
  transactionId?: UUID;
  /** Explicit creation timestamp (defaults to `Date.now()`). */
  createdAt?: number;
  /** Idempotency key of the enclosing HTTP request. */
  requestId?: UUID;
}

/** Generates an RFC-4122 v4 UUID using the platform CSPRNG. */
export function generateUUID(): UUID {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback for exotic runtimes without WebCrypto.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Fluent builder producing one atomic {@link Transaction}.
 *
 * Every helper mirrors a server operation verb exactly, and each call appends in
 * order — the transaction is applied left-to-right on both the client and the
 * server, so `listRemove` followed by `listAfter` behaves identically in both.
 */
export class TransactionBuilder {
  private readonly operations: Operation[] = [];
  private readonly spaceId: UUID;
  private readonly transactionId: UUID;
  private readonly createdAt: number;
  private readonly requestId?: UUID;
  private defaultTarget: TransactionTarget | undefined;

  constructor(
    target: TransactionTarget,
    options?: Omit<TransactionBuilderOptions, keyof TransactionTarget>,
  );
  constructor(options: TransactionBuilderOptions);
  constructor(
    targetOrOptions: TransactionTarget | TransactionBuilderOptions,
    options: Omit<TransactionBuilderOptions, keyof TransactionTarget> = {},
  ) {
    const merged: TransactionBuilderOptions = {
      ...targetOrOptions,
      ...options,
    };
    if (!merged.spaceId) {
      throw new Error('TransactionBuilder requires a spaceId');
    }
    this.spaceId = merged.spaceId;
    this.transactionId = merged.transactionId ?? generateUUID();
    this.createdAt = merged.createdAt ?? Date.now();
    this.requestId = merged.requestId;
    if (merged.table && merged.id) {
      this.defaultTarget = {
        spaceId: merged.spaceId,
        table: merged.table,
        id: merged.id,
      };
    }
  }

  /** Number of operations queued so far. */
  get size(): number {
    return this.operations.length;
  }

  /** True when nothing has been queued. */
  get isEmpty(): boolean {
    return this.operations.length === 0;
  }

  /** Workspace id baked into every operation of this transaction. */
  get space(): UUID {
    return this.spaceId;
  }

  /** Re-points the builder at a different record (keeps queued operations). */
  target(
    target: Partial<Omit<TransactionTarget, 'spaceId'>> & { spaceId?: UUID },
  ): this {
    const resolved: TransactionTarget = {
      spaceId: target.spaceId ?? this.defaultTarget?.spaceId ?? this.spaceId,
      table: target.table ?? this.defaultTarget?.table ?? 'block',
      id: target.id ?? this.defaultTarget?.id ?? '',
    };
    this.defaultTarget = resolved;
    return this;
  }

  /**
   * `set` — overwrites the value at `path`.
   *
   * Used for whole-value replacement (`properties.title`, `alive`, `format`).
   */
  set(
    path: OperationPath,
    args: unknown,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(setOperation(this.pointerFor(target), path, args));
    return this;
  }

  /**
   * `update` — shallow-merges `args` into the object at `path`.
   *
   * Used when only a subset of keys changes, so concurrent editors touching
   * different keys both survive.
   */
  update(
    path: OperationPath,
    args: Record<string, unknown>,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(updateOperation(this.pointerFor(target), path, args));
    return this;
  }

  /**
   * `listAfter` — inserts `newId` into the ordered list at `path` after `targetId`.
   *
   * `targetId === null` prepends to the list.
   */
  listAfter(
    path: OperationPath,
    targetId: UUID | null,
    newId: UUID,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(
      listAfterOperation(this.pointerFor(target), path, newId, targetId),
    );
    return this;
  }

  /**
   * `listBefore` — inserts `newId` into the ordered list at `path` before `targetId`.
   *
   * `targetId === null` appends to the list.
   */
  listBefore(
    path: OperationPath,
    targetId: UUID | null,
    newId: UUID,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(
      listBeforeOperation(this.pointerFor(target), path, newId, targetId),
    );
    return this;
  }

  /** `listRemove` — drops `targetId` from the ordered list at `path`. */
  listRemove(
    path: OperationPath,
    targetId: UUID,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(
      listRemoveOperation(this.pointerFor(target), path, targetId),
    );
    return this;
  }

  /** `keyedObjectSet` — writes a single key inside a map without touching siblings. */
  keyedObjectSet(
    path: OperationPath,
    key: string,
    value: unknown,
    target?: Partial<TransactionTarget>,
  ): this {
    this.operations.push(
      keyedObjectSetOperation(this.pointerFor(target), path, key, value),
    );
    return this;
  }

  /** Appends a pre-built operation (escape hatch for shared operation factories). */
  push(operation: Operation): this {
    this.operations.push(operation);
    return this;
  }

  /** Copies every queued operation into a fresh transaction with a new id. */
  clone(
    options: {
      transactionId?: UUID;
      requestId?: UUID;
      createdAt?: number;
    } = {},
  ): Transaction {
    const requestId = options.requestId ?? this.requestId;
    return {
      id: options.transactionId ?? generateUUID(),
      spaceId: this.spaceId,
      operations: this.operations.map((operation) =>
        structuredCloneSafe(operation),
      ),
      createdAt: options.createdAt ?? Date.now(),
      ...(requestId ? { requestId } : {}),
    };
  }

  /**
   * Freezes the queued operations into an atomic {@link Transaction}.
   *
   * Throws when the transaction is empty: an empty batch is a programming error
   * (it would burn a network round-trip and an outbox slot for nothing).
   */
  build(): Transaction {
    if (this.operations.length === 0) {
      throw new Error('Cannot build a transaction with no operations');
    }
    return {
      id: this.transactionId,
      spaceId: this.spaceId,
      operations: this.operations.map((operation) =>
        structuredCloneSafe(operation),
      ),
      createdAt: this.createdAt,
      ...(this.requestId ? { requestId: this.requestId } : {}),
    };
  }

  /** Builds without throwing, returning `undefined` for an empty builder. */
  tryBuild(): Transaction | undefined {
    return this.operations.length === 0 ? undefined : this.build();
  }

  /** Returns the queued operations (defensive copy). */
  toOperations(): Operation[] {
    return this.operations.map((operation) => structuredCloneSafe(operation));
  }

  /** Resolves the pointer for an operation, honouring per-call overrides. */
  private pointerFor(target?: Partial<TransactionTarget>) {
    const resolved: TransactionTarget = {
      spaceId: target?.spaceId ?? this.defaultTarget?.spaceId ?? this.spaceId,
      table: target?.table ?? this.defaultTarget?.table ?? 'block',
      id: target?.id ?? this.defaultTarget?.id ?? '',
    };
    if (!resolved.id) {
      throw new Error(
        'TransactionBuilder operation is missing a target record id',
      );
    }
    return {
      table: resolved.table,
      id: resolved.id,
      spaceId: resolved.spaceId,
    };
  }
}

/**
 * Structured-clone helper with a JSON fallback.
 *
 * Operations only ever carry JSON values, so the fallback is lossless here while
 * keeping the builder usable on runtimes without `structuredClone`.
 */
function structuredCloneSafe<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Convenience factory for a transaction targeting one record. */
export function createTransactionBuilder(
  target: TransactionTarget,
  options?: Omit<TransactionBuilderOptions, keyof TransactionTarget>,
): TransactionBuilder {
  return new TransactionBuilder(target, options);
}

/** Convenience factory for a transaction with per-operation targets. */
export function createSpaceTransactionBuilder(
  options: TransactionBuilderOptions & { spaceId: UUID },
): TransactionBuilder {
  return new TransactionBuilder(options);
}
