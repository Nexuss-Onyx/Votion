/**
 * Persistent outbound transaction queue ("outbox").
 *
 * Every user mutation produces a `Transaction`. While the browser is offline —
 * or while the API is unreachable — those transactions accumulate here instead
 * of being dropped. Because the queue lives in IndexedDB, it survives page
 * refreshes, tab restores and browser restarts.
 *
 * Ordering guarantees:
 *  - Rows are keyed by an auto-incrementing `seq`, and reads always sort by
 *    `(enqueuedAt, seq)` ascending, so replay order equals user-action order even
 *    for transactions created inside the same millisecond.
 *  - `dequeueTransactions` is called only after a successful dispatch, which
 *    gives at-least-once delivery; the transaction `id` doubles as the server's
 *    idempotency key so replays cannot double-apply.
 */

import type { Transaction, UUID } from '@votion/types';
import {
  getVotionDatabase,
  type OutboxRecord,
  type PersistenceEnvironment,
  type VotionDatabase,
} from './VotionDatabase.js';

/** A pending transaction plus its queue metadata. */
export interface OutboxEntry {
  /** Replay sequence (primary key). */
  seq: number;
  /** Enqueue timestamp (epoch ms). */
  enqueuedAt: number;
  /** The pending transaction. */
  transaction: Transaction;
  /** Number of dispatch attempts already made. */
  attempts: number;
  /** Epoch ms of the last dispatch attempt. */
  lastAttemptAt?: number;
  /** Last transport/server error observed while flushing this entry. */
  lastError?: string;
}

/** Options accepted by {@link OutboxStorage.peekTransactions}. */
export interface PeekOptions {
  /** Maximum number of transactions to return (oldest first). */
  limit?: number;
  /** Restrict to a single workspace. */
  spaceId?: UUID;
}

/** Result of a successful dispatch, fed back into the queue bookkeeping. */
export interface DispatchOutcome {
  /** Server-reported versions, keyed by record id. */
  versions?: Record<UUID, number>;
  /** Wall-clock timestamp of the acknowledgement. */
  acknowledgedAt?: number;
}

/**
 * Narrow a raw row back to a `Transaction`.
 *
 * Rows are stored structured-clone-safe, so this is a shape assertion rather
 * than a deserialise step; malformed rows are dropped (never replayed) so a
 * corrupt entry cannot wedge the queue forever.
 */
function toTransaction(row: OutboxRecord): Transaction | undefined {
  const candidate = row.transaction as Transaction | undefined;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !Array.isArray(candidate.operations)
  ) {
    return undefined;
  }
  return candidate;
}

/** Persistent queue of not-yet-acknowledged transactions. */
export class OutboxStorage {
  private readonly db: VotionDatabase;

  constructor(db: VotionDatabase = getVotionDatabase()) {
    this.db = db;
  }

  /** The underlying Dexie handle. */
  get database(): VotionDatabase {
    return this.db;
  }

  /**
   * Appends a transaction to the tail of the queue.
   *
   * Enqueuing the same transaction id twice is a no-op: `id` is uniquely indexed
   * so a retry storm (or a re-render replaying the same action) cannot duplicate
   * the mutation.
   */
  async enqueueTransaction(
    transaction: Transaction,
    enqueuedAt = Date.now(),
  ): Promise<OutboxEntry> {
    const existing = await this.db.outbox
      .where('id')
      .equals(transaction.id)
      .first();
    if (existing) {
      const entry = this.toEntry(existing);
      if (entry) {
        return entry;
      }
      // A corrupt row blocks the unique index: drop it and re-enqueue cleanly.
      await this.db.outbox.where('id').equals(transaction.id).delete();
    }
    const row: OutboxRecord = {
      id: transaction.id,
      spaceId: transaction.spaceId,
      enqueuedAt,
      transaction,
      attempts: 0,
    };
    const seq = await this.db.outbox.add(row);
    return { seq, enqueuedAt, transaction, attempts: 0 };
  }

  /** Appends many transactions in one IndexedDB transaction, preserving order. */
  async enqueueTransactions(
    transactions: Transaction[],
    enqueuedAt = Date.now(),
  ): Promise<OutboxEntry[]> {
    const entries: OutboxEntry[] = [];
    await this.db.transaction('rw', this.db.outbox, async () => {
      let offset = 0;
      for (const transaction of transactions) {
        entries.push(
          await this.enqueueTransaction(transaction, enqueuedAt + offset),
        );
        offset += 1;
      }
    });
    return entries;
  }

  /**
   * Reads the head of the queue without removing anything.
   *
   * Returning (rather than taking) keeps the caller in control of acknowledgement:
   * a batch that fails mid-flight is simply not dequeued, so nothing is lost.
   */
  async peekTransactions(options: PeekOptions = {}): Promise<OutboxEntry[]> {
    const { limit, spaceId } = options;
    const rows = spaceId
      ? await this.db.outbox.where('spaceId').equals(spaceId).toArray()
      : await this.db.outbox.toArray();

    const entries: OutboxEntry[] = [];
    for (const row of rows.sort(
      (a, b) => a.enqueuedAt - b.enqueuedAt || (a.seq ?? 0) - (b.seq ?? 0),
    )) {
      const entry = this.toEntry(row);
      if (entry) {
        entries.push(entry);
      }
    }

    return typeof limit === 'number'
      ? entries.slice(0, Math.max(0, limit))
      : entries;
  }

  /** Number of transactions waiting in the queue. */
  async pendingCount(spaceId?: UUID): Promise<number> {
    return spaceId
      ? this.db.outbox.where('spaceId').equals(spaceId).count()
      : this.db.outbox.count();
  }

  /** True when at least one transaction is waiting to be flushed. */
  async hasPending(spaceId?: UUID): Promise<boolean> {
    return (await this.pendingCount(spaceId)) > 0;
  }

  /**
   * Removes acknowledged transactions from the queue.
   *
   * Accepts either transaction ids (the normal path after a successful
   * `saveTransactions` response) or outbox sequence numbers (when the caller
   * already holds entries from `peekTransactions`).
   */
  async dequeueTransactions(
    ids: ReadonlyArray<UUID | number>,
  ): Promise<number> {
    const stringIds = ids.filter((id): id is string => typeof id === 'string');
    const seqs = ids.filter((id): id is number => typeof id === 'number');
    let removed = 0;

    await this.db.transaction('rw', this.db.outbox, async () => {
      if (stringIds.length > 0) {
        removed +=
          (await this.db.outbox.where('id').anyOf(stringIds).delete()) ?? 0;
      }
      if (seqs.length > 0) {
        removed +=
          (await this.db.outbox.where('seq').anyOf(seqs).delete()) ?? 0;
      }
    });
    return removed;
  }

  /** Records a failed dispatch attempt (drives the retry/backoff strategy). */
  async recordAttempt(
    id: UUID,
    error?: string,
    attemptedAt = Date.now(),
  ): Promise<OutboxEntry | undefined> {
    const existing = await this.db.outbox.where('id').equals(id).first();
    if (!existing) {
      return undefined;
    }
    const next: OutboxRecord = {
      ...existing,
      attempts: (existing.attempts ?? 0) + 1,
      lastAttemptAt: attemptedAt,
      lastError: error,
    };
    await this.db.outbox.put(next);
    return this.toEntry(next);
  }

  /** Drops a poisoned transaction without replaying it (used after a hard 4xx). */
  async discardTransaction(id: UUID): Promise<number> {
    return this.db.outbox.where('id').equals(id).delete();
  }

  /** Empties the queue (sign-out / cache reset). */
  async clear(): Promise<void> {
    await this.db.outbox.clear();
  }

  /** Maps a persisted row onto the public entry shape. */
  private toEntry(row: OutboxRecord): OutboxEntry | undefined {
    const transaction = toTransaction(row);
    if (!transaction) {
      return undefined;
    }
    return {
      seq: row.seq ?? 0,
      enqueuedAt: row.enqueuedAt,
      transaction,
      attempts: row.attempts ?? 0,
      lastAttemptAt: row.lastAttemptAt,
      lastError: row.lastError,
    };
  }
}

/** Convenience: creates an outbox bound to the default database. */
export function createOutboxStorage(
  env?: PersistenceEnvironment,
): OutboxStorage {
  return new OutboxStorage(getVotionDatabase(env));
}
