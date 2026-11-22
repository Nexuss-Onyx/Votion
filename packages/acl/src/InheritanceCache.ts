/**
 * Redis-backed ACL inheritance cache with immediate subtree invalidation.
 *
 * Key schema: `acl:space:<space_id>:user:<user_id>:entity:<entity_id>`
 * Default TTL: 300 seconds (5 minutes).
 */

import { Redis, type RedisOptions } from 'ioredis';

import type { PermissionRole, UUID } from '@votion/types';

import type {
  AclEntityTable,
  AclInvalidationEvent,
  AclStore,
  PermissionResolutionReason,
  PermissionResolutionSource,
  RedisClientLike,
} from './types.js';

/** Default Redis TTL for cached ACL decisions (5 minutes). */
export const DEFAULT_ACL_CACHE_TTL_SECONDS = 300;

/** Sentinel user segment used in cache keys for anonymous (public) checks. */
export const ANONYMOUS_USER_KEY = 'anonymous';

const DEFAULT_SCAN_COUNT = 250;
const DEFAULT_MAX_SUBTREE_NODES = 10_000;

/** Serialized value persisted in Redis for a resolved entity permission. */
export interface CachedPermissionEntry {
  role: PermissionRole | null;
  source: PermissionResolutionSource;
  reason: PermissionResolutionReason;
  resolvedAtEntityTable: AclEntityTable | null;
  resolvedAtEntityId: UUID | null;
}

/** Configuration accepted by {@link InheritanceCache}. */
export interface InheritanceCacheOptions {
  /** Redis client (`ioredis` `Redis` instance or compatible test double). */
  redis: RedisClientLike;
  /** Time-to-live for cached ACL decisions in seconds (defaults to 300s / 5m). */
  ttlSeconds?: number;
  /** Optional key namespace prefix (defaults to `'acl'`). */
  keyPrefix?: string;
  /** Batch size passed to `SCAN ... COUNT` during wildcard invalidation. */
  scanCount?: number;
  /** Maximum number of descendant nodes walked before falling back to space-wide invalidation. */
  maxSubtreeNodes?: number;
}

/** Minimal store surface needed for downward subtree cache invalidation. */
export type SubtreeLookupStore = Pick<AclStore, 'getBlock' | 'getChildBlockIds'>;

/** Creates a production `ioredis` client from a URL (or `REDIS_URL` env var). */
export function createRedisClient(
  redisUrl?: string,
  options?: RedisOptions,
): Redis {
  const url =
    redisUrl ??
    (typeof process !== 'undefined' ? process.env.REDIS_URL : undefined);

  if (url && url.trim().length > 0) {
    return new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      ...options,
    });
  }

  return new Redis({
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    ...options,
  });
}

function escapeGlobPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

interface StoredRedisValue {
  value: string;
  expiresAtMs: number | null;
}

/**
 * Deterministic in-memory Redis client implementing {@link RedisClientLike}
 * with real TTL expiration and glob `SCAN` matching. Useful for unit tests and
 * local development without a running Redis server.
 */
export class InMemoryRedisClient implements RedisClientLike {
  private readonly entries = new Map<string, StoredRedisValue>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private pruneIfExpired(key: string): StoredRedisValue | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.pruneIfExpired(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
  ): Promise<'OK'> {
    const expiresAtMs =
      expiryMode === 'EX' && ttlSeconds > 0
        ? this.now() + ttlSeconds * 1000
        : this.now();
    this.entries.set(key, { value, expiresAtMs });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.entries.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async scan(
    cursor: string | number,
    _matchToken: 'MATCH',
    pattern: string,
    _countToken: 'COUNT',
    count: number,
  ): Promise<[cursor: string, keys: string[]]> {
    const regex = escapeGlobPatternToRegex(pattern);
    const liveKeys: string[] = [];

    for (const key of this.entries.keys()) {
      if (this.pruneIfExpired(key) && regex.test(key)) {
        liveKeys.push(key);
      }
    }

    const startIndex =
      typeof cursor === 'number' ? cursor : Number.parseInt(cursor, 10) || 0;
    const step = Math.max(1, count);
    const slice = liveKeys.slice(startIndex, startIndex + step);
    const nextIndex = startIndex + step;
    const nextCursor = nextIndex >= liveKeys.length ? '0' : String(nextIndex);

    return [nextCursor, slice];
  }

  /** Inspection helper for tests: returns remaining unexpired keys. */
  keys(): string[] {
    const result: string[] = [];
    for (const key of this.entries.keys()) {
      if (this.pruneIfExpired(key)) {
        result.push(key);
      }
    }
    return result;
  }

  /** Inspection helper for tests: clears all keys. */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Redis-backed ACL path cache implementing key layout
 * `acl:space:<space_id>:user:<user_id>:entity:<entity_id>` and immediate
 * invalidation hooks for permission edits, block moves, and membership changes.
 */
export class InheritanceCache {
  private readonly redis: RedisClientLike;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly scanCount: number;
  private readonly maxSubtreeNodes: number;

  constructor(options: InheritanceCacheOptions) {
    this.redis = options.redis;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_ACL_CACHE_TTL_SECONDS;
    this.keyPrefix = options.keyPrefix ?? 'acl';
    this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
    this.maxSubtreeNodes = options.maxSubtreeNodes ?? DEFAULT_MAX_SUBTREE_NODES;
  }

  /** Builds the canonical Redis key: `acl:space:<space_id>:user:<user_id>:entity:<entity_id>`. */
  buildKey(spaceId: UUID, userId: UUID | null, entityId: UUID): string {
    const userSegment = userId ?? ANONYMOUS_USER_KEY;
    return `${this.keyPrefix}:space:${spaceId}:user:${userSegment}:entity:${entityId}`;
  }

  /** Reads and parses a cached permission decision, returning `null` on miss or corrupt payload. */
  async get(
    spaceId: UUID,
    userId: UUID | null,
    entityId: UUID,
  ): Promise<CachedPermissionEntry | null> {
    const raw = await this.redis.get(this.buildKey(spaceId, userId, entityId));
    if (raw === null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('role' in parsed) ||
        !('source' in parsed) ||
        !('reason' in parsed)
      ) {
        return null;
      }
      return parsed as CachedPermissionEntry;
    } catch {
      return null;
    }
  }

  /** Writes a resolved permission decision into Redis with TTL (defaults to 300s / 5 minutes). */
  async set(
    spaceId: UUID,
    userId: UUID | null,
    entityId: UUID,
    entry: CachedPermissionEntry,
    ttlSeconds: number = this.ttlSeconds,
  ): Promise<void> {
    const key = this.buildKey(spaceId, userId, entityId);
    await this.redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
  }

  /** Deletes cached entries matching a Redis `SCAN` glob pattern. */
  private async deleteByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        this.scanCount,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }

  /**
   * Invalidates cached permissions for a single entity — either for one specific
   * user (when `userId` is supplied) or across all users in the space.
   */
  async invalidateEntity(
    spaceId: UUID,
    entityId: UUID,
    userId?: UUID | null,
  ): Promise<number> {
    if (userId !== undefined) {
      return this.redis.del(this.buildKey(spaceId, userId, entityId));
    }
    const pattern = `${this.keyPrefix}:space:${spaceId}:user:*:entity:${entityId}`;
    return this.deleteByPattern(pattern);
  }

  /**
   * Invalidates cached permissions for `rootEntityId` and every descendant block
   * in its sub-tree. If the sub-tree exceeds `maxSubtreeNodes`, falls back to
   * invalidating the entire space so no stale permission can survive.
   */
  async invalidateSubtree(
    spaceId: UUID,
    rootEntityId: UUID,
    store: SubtreeLookupStore,
    userId?: UUID | null,
  ): Promise<number> {
    const entityIds = new Set<UUID>([rootEntityId]);
    const queue: UUID[] = [rootEntityId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (currentId === undefined) break;

      const block = await store.getBlock(currentId);
      const childIds = new Set<UUID>();

      if (block && block.spaceId === spaceId) {
        for (const id of block.content) {
          childIds.add(id);
        }
      }

      const queriedChildren = await store.getChildBlockIds(spaceId, currentId);
      for (const id of queriedChildren) {
        childIds.add(id);
      }

      for (const childId of childIds) {
        if (!entityIds.has(childId)) {
          entityIds.add(childId);
          if (entityIds.size > this.maxSubtreeNodes) {
            return userId !== undefined && userId !== null
              ? this.invalidateUserInSpace(spaceId, userId)
              : this.invalidateSpace(spaceId);
          }
          queue.push(childId);
        }
      }
    }

    let deleted = 0;
    if (userId !== undefined) {
      const keys = Array.from(entityIds, (id) =>
        this.buildKey(spaceId, userId, id),
      );
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
      return deleted;
    }

    for (const id of entityIds) {
      deleted += await this.invalidateEntity(spaceId, id);
    }
    return deleted;
  }

  /** Invalidates every cached permission for a single user within a workspace. */
  async invalidateUserInSpace(
    spaceId: UUID,
    userId: UUID | null,
  ): Promise<number> {
    const userSegment = userId ?? ANONYMOUS_USER_KEY;
    const pattern = `${this.keyPrefix}:space:${spaceId}:user:${userSegment}:entity:*`;
    return this.deleteByPattern(pattern);
  }

  /** Invalidates every cached permission inside a workspace. */
  async invalidateSpace(spaceId: UUID): Promise<number> {
    const pattern = `${this.keyPrefix}:space:${spaceId}:*`;
    return this.deleteByPattern(pattern);
  }

  /**
   * Handles a permission mutation, block move, membership edit, or workspace
   * settings change by immediately evicting all impacted cache keys.
   */
  async handleInvalidationEvent(
    event: AclInvalidationEvent,
    store?: SubtreeLookupStore,
  ): Promise<number> {
    switch (event.type) {
      case 'workspace_settings_changed':
        return this.invalidateSpace(event.spaceId);

      case 'membership_changed':
        return this.invalidateUserInSpace(event.spaceId, event.userId);

      case 'block_moved':
        if (store) {
          return this.invalidateSubtree(event.spaceId, event.blockId, store);
        }
        return this.invalidateSpace(event.spaceId);

      case 'permission_changed': {
        if (event.entityTable === 'space') {
          if (
            event.principalType === 'user' &&
            event.principalId !== undefined &&
            event.principalId !== null
          ) {
            return this.invalidateUserInSpace(event.spaceId, event.principalId);
          }
          return this.invalidateSpace(event.spaceId);
        }

        const scopedUserId =
          event.principalType === 'user' && event.principalId !== null
            ? event.principalId
            : undefined;

        if (store) {
          return this.invalidateSubtree(
            event.spaceId,
            event.entityId,
            store,
            scopedUserId,
          );
        }

        return this.invalidateEntity(
          event.spaceId,
          event.entityId,
          scopedUserId,
        );
      }
    }
  }

  /**
   * Returns a bound callback that can be attached directly to permission/block
   * mutation pipelines so cache eviction happens immediately on every change.
   */
  createInvalidationHook(
    store: SubtreeLookupStore,
  ): (event: AclInvalidationEvent) => Promise<number> {
    return (event) => this.handleInvalidationEvent(event, store);
  }
}
