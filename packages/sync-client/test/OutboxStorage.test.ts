/**
 * OutboxStorage: durable queue semantics and strict replay ordering.
 *
 * Every case runs against real IndexedDB (fake-indexeddb), so the ordering
 * assertions cover the actual `++seq` key generator and not a JS array.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@votion/types';

import {
  OutboxStorage,
  VOTION_DB_NAME,
  VotionDatabase,
  setVotionDatabase,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  SPACE_ID_B,
  id,
  makeTransaction,
} from './factories.js';

let db: VotionDatabase;
let outbox: OutboxStorage;
let databaseSeq = 0;

/** Builds a one-operation transaction with a distinct id. */
function makeTx(n: number, spaceId = SPACE_ID): Transaction {
  return makeTransaction(
    [
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId },
        path: ['properties', 'title'],
        command: 'set',
        args: [[`edit-${n}`]],
      },
    ],
    { id: id(9000 + n), spaceId },
  );
}

beforeEach(async () => {
  databaseSeq += 1;
  db = new VotionDatabase(`${VOTION_DB_NAME}-outbox-${databaseSeq}`);
  setVotionDatabase(db);
  outbox = new OutboxStorage(db);
  await db.open();
});

afterEach(async () => {
  await db.delete();
  setVotionDatabase(undefined);
});

describe('OutboxStorage — enqueue', () => {
  it('enqueues a transaction and reports it as pending', async () => {
    const transaction = makeTx(1);
    const entry = await outbox.enqueueTransaction(transaction, 1000);

    expect(entry.transaction).toEqual(transaction);
    expect(entry.enqueuedAt).toBe(1000);
    expect(entry.attempts).toBe(0);
    expect(entry.seq).toBeGreaterThan(0);
    expect(await outbox.pendingCount()).toBe(1);
    expect(await outbox.hasPending()).toBe(true);
  });

  it('is idempotent by transaction id (retries cannot duplicate a mutation)', async () => {
    const transaction = makeTx(2);
    const first = await outbox.enqueueTransaction(transaction, 1000);
    const second = await outbox.enqueueTransaction(transaction, 2000);

    expect(second.seq).toBe(first.seq);
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('enqueueTransactions appends a batch in order', async () => {
    const batch = [makeTx(3), makeTx(4), makeTx(5)];
    const entries = await outbox.enqueueTransactions(batch, 5000);

    expect(entries.map((entry) => entry.transaction.id)).toEqual(
      batch.map((tx) => tx.id),
    );
    const peeked = await outbox.peekTransactions();
    expect(peeked.map((entry) => entry.transaction.id)).toEqual(
      batch.map((tx) => tx.id),
    );
  });

  it('scopes counts and peeks by workspace', async () => {
    await outbox.enqueueTransaction(makeTx(6, SPACE_ID));
    await outbox.enqueueTransaction(makeTx(7, SPACE_ID_B));

    expect(await outbox.pendingCount()).toBe(2);
    expect(await outbox.pendingCount(SPACE_ID)).toBe(1);
    expect(
      (await outbox.peekTransactions({ spaceId: SPACE_ID_B }))[0]?.transaction
        .id,
    ).toBe(id(9007));
  });
});

describe('OutboxStorage — ordering', () => {
  it('returns entries oldest-first by enqueue timestamp', async () => {
    // Insert out of timestamp order to prove sorting, not insertion order.
    await outbox.enqueueTransaction(makeTx(10), 3000);
    await outbox.enqueueTransaction(makeTx(11), 1000);
    await outbox.enqueueTransaction(makeTx(12), 2000);

    const peeked = await outbox.peekTransactions();
    expect(peeked.map((entry) => entry.transaction.id)).toEqual([
      id(9011),
      id(9012),
      id(9010),
    ]);
  });

  it('breaks timestamp ties by insertion sequence (same-millisecond edits)', async () => {
    const batch = [makeTx(13), makeTx(14), makeTx(15)];
    for (const transaction of batch) {
      await outbox.enqueueTransaction(transaction, 7000);
    }

    const peeked = await outbox.peekTransactions();
    expect(peeked.map((entry) => entry.transaction.id)).toEqual(
      batch.map((tx) => tx.id),
    );
    expect(peeked.map((entry) => entry.seq)).toEqual(
      [...peeked.map((entry) => entry.seq)].sort((a, b) => a - b),
    );
  });

  it('supports limited peeks (batch sizing)', async () => {
    for (let index = 20; index < 25; index += 1) {
      await outbox.enqueueTransaction(makeTx(index), 1000 + index);
    }
    expect(
      (await outbox.peekTransactions({ limit: 2 })).map(
        (entry) => entry.transaction.id,
      ),
    ).toEqual([id(9020), id(9021)]);
    expect(await outbox.peekTransactions({ limit: 0 })).toEqual([]);
  });

  it('peek never consumes the queue', async () => {
    await outbox.enqueueTransaction(makeTx(30));
    await outbox.peekTransactions();
    await outbox.peekTransactions();
    expect(await outbox.pendingCount()).toBe(1);
  });
});

describe('OutboxStorage — dequeue', () => {
  it('removes acknowledged transactions by id', async () => {
    const [first, second] = await outbox.enqueueTransactions([
      makeTx(40),
      makeTx(41),
    ]);

    const removed = await outbox.dequeueTransactions([
      first?.transaction.id ?? '',
    ]);

    expect(removed).toBe(1);
    expect(
      (await outbox.peekTransactions()).map((entry) => entry.transaction.id),
    ).toEqual([second?.transaction.id]);
  });

  it('removes acknowledged transactions by sequence number', async () => {
    const [first] = await outbox.enqueueTransactions([makeTx(42), makeTx(43)]);
    const removed = await outbox.dequeueTransactions([first?.seq ?? -1]);
    expect(removed).toBe(1);
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('ignores unknown ids without throwing', async () => {
    await outbox.enqueueTransaction(makeTx(44));
    expect(await outbox.dequeueTransactions(['ghost', 999_999])).toBe(0);
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('clear() empties the queue', async () => {
    await outbox.enqueueTransactions([makeTx(45), makeTx(46)]);
    await outbox.clear();
    expect(await outbox.pendingCount()).toBe(0);
    expect(await outbox.peekTransactions()).toEqual([]);
  });
});

describe('OutboxStorage — retry bookkeeping', () => {
  it('records attempts, timestamps and the last error', async () => {
    const transaction = makeTx(50);
    await outbox.enqueueTransaction(transaction, 1000);

    const first = await outbox.recordAttempt(
      transaction.id,
      'ECONNRESET',
      2000,
    );
    const second = await outbox.recordAttempt(transaction.id, 'timeout', 3000);

    expect(first?.attempts).toBe(1);
    expect(second?.attempts).toBe(2);
    expect(second?.lastAttemptAt).toBe(3000);
    expect(second?.lastError).toBe('timeout');
    expect((await outbox.peekTransactions())[0]?.attempts).toBe(2);
  });

  it('recordAttempt returns undefined for unknown ids', async () => {
    expect(await outbox.recordAttempt('ghost', 'x')).toBeUndefined();
  });

  it('discardTransaction drops a poisoned entry without replaying it', async () => {
    const transaction = makeTx(51);
    await outbox.enqueueTransaction(transaction);
    expect(await outbox.discardTransaction(transaction.id)).toBe(1);
    expect(await outbox.pendingCount()).toBe(0);
  });
});

describe('OutboxStorage — durability', () => {
  it('survives a database close/reopen (browser refresh)', async () => {
    const batch = [makeTx(60), makeTx(61)];
    await outbox.enqueueTransactions(batch, 1234);

    db.close();
    const reopenedDb = new VotionDatabase(db.name);
    const reopened = new OutboxStorage(reopenedDb);
    const peeked = await reopened.peekTransactions();

    expect(peeked).toHaveLength(2);
    expect(peeked.map((entry) => entry.transaction.id)).toEqual(
      batch.map((tx) => tx.id),
    );
    expect(peeked[0]?.enqueuedAt).toBe(1234);
    await reopenedDb.delete();
  });

  it('preserves the full transaction payload through structured cloning', async () => {
    const transaction = makeTransaction(
      [
        {
          pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
          path: ['content'],
          command: 'listAfter',
          args: { id: id(70), after: null },
        },
        {
          pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
          path: ['properties', 'title'],
          command: 'set',
          args: [['Offline edit', [['b'], ['a', 'https://votion.dev']]]],
        },
      ],
      { id: id(9062), createdAt: 555 },
    );

    await outbox.enqueueTransaction(transaction);
    db.close();
    const reopenedDb = new VotionDatabase(db.name);
    const [entry] = await new OutboxStorage(reopenedDb).peekTransactions();

    expect(entry?.transaction).toEqual(transaction);
    await reopenedDb.delete();
  });
});
