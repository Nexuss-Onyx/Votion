/**
 * Command-pattern transaction protocol.
 *
 * Votion never exposes `PATCH /blocks/:id`. Every mutation is an atomic batch of
 * path-addressed operations that the server replays against PostgreSQL, appends
 * to the write-ahead log, and broadcasts to subscribed clients.
 */

import type { OperationTable, Timestamp, UUID } from './common.js';

/** Operation commands supported by the transaction processor. */
export type OperationCommand =
  | 'set'
  | 'update'
  | 'listAfter'
  | 'listBefore'
  | 'listRemove'
  | 'keyedObjectSet';

/** Path into a record, e.g. `['properties', 'title']` or `['content']`. */
export type OperationPath = (string | number)[];

/** Absolute address of the record an operation targets. */
export interface OperationPointer {
  table: OperationTable;
  id: UUID;
  /** Workspace/space the record belongs to (ACL + routing scope). */
  spaceId: UUID;
}

/** Fields shared by every operation variant. */
export interface OperationBase {
  pointer: OperationPointer;
  path: OperationPath;
}

/** Overwrites the value at `path` with `args`. */
export interface SetOperation extends OperationBase {
  command: 'set';
  args: unknown;
}

/** Shallow-merges the object keys of `args` into the object at `path`. */
export interface UpdateOperation extends OperationBase {
  command: 'update';
  args: Record<string, unknown>;
}

/** Payload of an ordered-list insertion. */
export interface ListInsertArgs {
  /** Id of the element being inserted. */
  id: UUID;
  /** Anchor element id; `null` prepends. */
  after?: UUID | null;
  before?: UUID | null;
}

/** Inserts `args.id` into the list at `path` after `args.after`. */
export interface ListAfterOperation extends OperationBase {
  command: 'listAfter';
  args: ListInsertArgs & { after: UUID | null };
}

/** Inserts `args.id` into the list at `path` before `args.before`. */
export interface ListBeforeOperation extends OperationBase {
  command: 'listBefore';
  args: ListInsertArgs & { before: UUID | null };
}

/** Removes `args.id` from the list at `path`. */
export interface ListRemoveOperation extends OperationBase {
  command: 'listRemove';
  args: { id: UUID };
}

/** Sets a single key inside the map at `path` without replacing siblings. */
export interface KeyedObjectSetOperation extends OperationBase {
  command: 'keyedObjectSet';
  args: { key: string; value: unknown };
}

/** Discriminated union of every operation variant. */
export type Operation =
  | SetOperation
  | UpdateOperation
  | ListAfterOperation
  | ListBeforeOperation
  | ListRemoveOperation
  | KeyedObjectSetOperation;

/** Narrowed operation type for a specific command. */
export type OperationOfCommand<C extends OperationCommand> = Extract<
  Operation,
  { command: C }
>;

/** An atomic, ordered batch of operations. */
export interface Transaction {
  id: UUID;
  spaceId: UUID;
  operations: Operation[];
  /** Client-side creation timestamp (epoch ms). */
  createdAt?: Timestamp;
  /** Idempotency key of the enclosing HTTP request. */
  requestId?: UUID;
}

/** Request body of `POST /api/v3/saveTransactions`. */
export interface SaveTransactionsRequest {
  requestId: UUID;
  transactions: Transaction[];
}

/** Per-transaction acknowledgement returned by the server. */
export interface TransactionResult {
  id: UUID;
  /** New record versions keyed by record id. */
  versions: Record<UUID, number>;
  applied: boolean;
  /** Set when the transaction was rejected (e.g. stale version). */
  error?: string;
}

/** Response body of `POST /api/v3/saveTransactions`. */
export interface SaveTransactionsResponse {
  requestId: UUID;
  results: TransactionResult[];
}

/** Builds a `set` operation. */
export function setOperation(
  pointer: OperationPointer,
  path: OperationPath,
  args: unknown,
): SetOperation {
  return { pointer, path, command: 'set', args };
}

/** Builds an `update` operation. */
export function updateOperation(
  pointer: OperationPointer,
  path: OperationPath,
  args: Record<string, unknown>,
): UpdateOperation {
  return { pointer, path, command: 'update', args };
}

/** Builds a `listAfter` operation. */
export function listAfterOperation(
  pointer: OperationPointer,
  path: OperationPath,
  id: UUID,
  after: UUID | null,
): ListAfterOperation {
  return { pointer, path, command: 'listAfter', args: { id, after } };
}

/** Builds a `listBefore` operation. */
export function listBeforeOperation(
  pointer: OperationPointer,
  path: OperationPath,
  id: UUID,
  before: UUID | null,
): ListBeforeOperation {
  return { pointer, path, command: 'listBefore', args: { id, before } };
}

/** Builds a `listRemove` operation. */
export function listRemoveOperation(
  pointer: OperationPointer,
  path: OperationPath,
  id: UUID,
): ListRemoveOperation {
  return { pointer, path, command: 'listRemove', args: { id } };
}

/** Builds a `keyedObjectSet` operation. */
export function keyedObjectSetOperation(
  pointer: OperationPointer,
  path: OperationPath,
  key: string,
  value: unknown,
): KeyedObjectSetOperation {
  return { pointer, path, command: 'keyedObjectSet', args: { key, value } };
}

const OPERATION_COMMANDS: ReadonlySet<string> = new Set<OperationCommand>([
  'set',
  'update',
  'listAfter',
  'listBefore',
  'listRemove',
  'keyedObjectSet',
]);

/** Narrows an unknown value to a {@link Operation}. */
export function isOperation(value: unknown): value is Operation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    command?: unknown;
    path?: unknown;
    pointer?: unknown;
    args?: unknown;
  };
  if (typeof candidate.command !== 'string' || !OPERATION_COMMANDS.has(candidate.command)) {
    return false;
  }
  if (!Array.isArray(candidate.path)) {
    return false;
  }
  if (typeof candidate.pointer !== 'object' || candidate.pointer === null) {
    return false;
  }
  const pointer = candidate.pointer as { table?: unknown; id?: unknown };
  return (
    typeof pointer.table === 'string' &&
    typeof pointer.id === 'string' &&
    typeof candidate.args === 'object' &&
    candidate.args !== null
  );
}

/** Narrows an unknown value to a {@link Transaction}. */
export function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; spaceId?: unknown; operations?: unknown };
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.spaceId === 'string' &&
    Array.isArray(candidate.operations) &&
    candidate.operations.every(isOperation)
  );
}

/** Returns every distinct record pointer touched by a transaction batch. */
export function getTransactionPointers(transaction: Transaction): OperationPointer[] {
  const seen = new Map<string, OperationPointer>();
  for (const operation of transaction.operations) {
    const key = `${operation.pointer.table}:${operation.pointer.id}`;
    if (!seen.has(key)) {
      seen.set(key, operation.pointer);
    }
  }
  return [...seen.values()];
}

/** Concatenates operation batches into a single transaction. */
export function mergeTransactions(
  id: UUID,
  spaceId: UUID,
  transactions: Transaction[],
): Transaction {
  return {
    id,
    spaceId,
    operations: transactions.flatMap((transaction) => transaction.operations),
  };
}
