/**
 * Transaction operation engine.
 *
 * Pure functions that replay a single {@link Operation} against a plain record
 * object. Both the in-memory store and the PostgreSQL store funnel through
 * this module, so the semantics of `set`, `update`, `listAfter`,
 * `listBefore`, `listRemove` and `keyedObjectSet` are identical everywhere
 * and unit-testable without a database.
 *
 * Records are addressed by dotted paths over their JSONB payload columns:
 * `['properties', 'title']` writes `record.properties.title`,
 * `['content']` replaces the child-id list, `['format', 'block_color']`
 * writes `record.format.block_color`, etc.
 */

import type { Operation, OperationPath } from '@votion/types';

/** Error thrown when an operation cannot be applied (rolls back the batch). */
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

/** Deep-clones a JSON-compatible value. */
export function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([key, entry]) => [cloneJson(key), cloneJson(entry)])) as T;
  }
  if (value instanceof Set) return new Set([...value].map((entry) => cloneJson(entry))) as T;
  if (Array.isArray(value)) return value.map((entry) => cloneJson(entry)) as T;
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) clone[key] = cloneJson(entry);
  return clone as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the value at `path`, returning `undefined` when any hop is missing. */
export function getAtPath(record: Record<string, unknown>, path: OperationPath): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') {
        return undefined;
      }
      current = current[segment];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Writes `value` at `path`, creating intermediate objects as needed. */
export function setAtPath(
  record: Record<string, unknown>,
  path: OperationPath,
  value: unknown,
): void {
  if (path.length === 0) {
    throw new OperationError('Operation path must not be empty.');
  }
  let current: Record<string, unknown> = record;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i] as string;
    const next = current[segment];
    if (Array.isArray(next)) {
      current = next as unknown as Record<string, unknown>;
    } else if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
    }
  }
  const last = path[path.length - 1] as string;
  current[last] = cloneJson(value);
}

/** Shallow-merges `args` into the object at `path` (Notion `update` semantics). */
function applyUpdate(record: Record<string, unknown>, path: OperationPath, args: unknown): void {
  if (!isPlainObject(args)) {
    throw new OperationError('`update` operation requires an object payload.');
  }
  const target = getAtPath(record, path);
  if (target === undefined) {
    setAtPath(record, path, { ...args });
    return;
  }
  if (!isPlainObject(target)) {
    throw new OperationError(`Cannot merge into non-object value at path ${JSON.stringify(path)}.`);
  }
  for (const [key, value] of Object.entries(args)) {
    target[key] = cloneJson(value);
  }
}

/** Inserts `id` into the list at `path` after `after` (or at the head). */
function applyListAfter(
  record: Record<string, unknown>,
  path: OperationPath,
  args: { id: string; after: string | null },
): void {
  const list = getAtPath(record, path);
  if (!Array.isArray(list)) {
    throw new OperationError(`Target at path ${JSON.stringify(path)} is not a list.`);
  }
  if (list.includes(args.id)) {
    return; // Idempotent re-insert.
  }
  if (args.after === null || args.after === undefined) {
    list.unshift(args.id);
    return;
  }
  const anchorIndex = list.indexOf(args.after);
  if (anchorIndex === -1) {
    throw new OperationError(
      `listAfter anchor ${args.after} not found in list at ${JSON.stringify(path)}.`,
    );
  }
  list.splice(anchorIndex + 1, 0, args.id);
}

/** Inserts `id` into the list at `path` before `before` (or at the tail). */
function applyListBefore(
  record: Record<string, unknown>,
  path: OperationPath,
  args: { id: string; before: string | null },
): void {
  const list = getAtPath(record, path);
  if (!Array.isArray(list)) {
    throw new OperationError(`Target at path ${JSON.stringify(path)} is not a list.`);
  }
  if (list.includes(args.id)) {
    return;
  }
  if (args.before === null || args.before === undefined) {
    list.push(args.id);
    return;
  }
  const anchorIndex = list.indexOf(args.before);
  if (anchorIndex === -1) {
    throw new OperationError(
      `listBefore anchor ${args.before} not found in list at ${JSON.stringify(path)}.`,
    );
  }
  list.splice(anchorIndex, 0, args.id);
}

/** Removes `id` from the list at `path` (no-op when absent). */
function applyListRemove(
  record: Record<string, unknown>,
  path: OperationPath,
  args: { id: string },
): void {
  const list = getAtPath(record, path);
  if (!Array.isArray(list)) {
    throw new OperationError(`Target at path ${JSON.stringify(path)} is not a list.`);
  }
  const index = list.indexOf(args.id);
  if (index !== -1) {
    list.splice(index, 1);
  }
}

/** Sets a single key inside the map at `path` without replacing siblings. */
function applyKeyedObjectSet(
  record: Record<string, unknown>,
  path: OperationPath,
  args: { key: string; value: unknown },
): void {
  if (typeof args.key !== 'string' || args.key.length === 0) {
    throw new OperationError('`keyedObjectSet` requires a non-empty `key`.');
  }
  const target = getAtPath(record, path);
  if (target === undefined) {
    setAtPath(record, path, { [args.key]: cloneJson(args.value) });
    return;
  }
  if (!isPlainObject(target)) {
    throw new OperationError(
      `Cannot set key on non-object value at path ${JSON.stringify(path)}.`,
    );
  }
  target[args.key] = cloneJson(args.value);
}

/**
 * Applies one operation to `record` in place.
 *
 * @throws {OperationError} when the operation is malformed or cannot be
 *   applied — callers must roll back the enclosing transaction.
 */
export function applyOperation(record: Record<string, unknown>, operation: Operation): void {
  switch (operation.command) {
    case 'set':
      setAtPath(record, operation.path, operation.args);
      return;
    case 'update':
      applyUpdate(record, operation.path, operation.args);
      return;
    case 'listAfter':
      applyListAfter(record, operation.path, operation.args);
      return;
    case 'listBefore':
      applyListBefore(record, operation.path, operation.args);
      return;
    case 'listRemove':
      applyListRemove(record, operation.path, operation.args);
      return;
    case 'keyedObjectSet':
      applyKeyedObjectSet(record, operation.path, operation.args);
      return;
    default:
      throw new OperationError(
        `Unsupported operation command: ${JSON.stringify((operation as Operation).command)}.`,
      );
  }
}
