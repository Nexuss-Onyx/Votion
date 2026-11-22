/**
 * Structural contracts for the Redis clients the sync-worker depends on.
 *
 * The production worker connects with `ioredis` (see `index.ts`), while
 * tests inject `ioredis-mock` instances. Declared as minimal structural
 * interfaces so both implementations satisfy them without casts at the
 * call sites inside the worker.
 */

/** Command-level Redis client (presence keys, writes, TTLs). */
export interface RedisCommandClient {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
}

/** Pattern-subscription Redis client dedicated to consuming pub/sub events. */
export interface RedisSubscriberClient {
  psubscribe(pattern: string): Promise<unknown>;
  on(event: string, listener: (...args: never[]) => void): unknown;
}
