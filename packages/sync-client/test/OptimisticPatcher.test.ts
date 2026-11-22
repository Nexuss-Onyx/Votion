/**
 * OptimisticPatcher: 0 ms local application of every operation primitive.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block, Transaction } from '@votion/types';

import {
  OptimisticPatcher,
  TransactionBuilder,
  createRecordStore,
  type RecordStoreApi,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  USER_ID,
  id,
  makeCollection,
  makeCollectionView,
  makePage,
  makeTextBlock,
  makeTodoBlock,
  makeTransaction,
  richText,
} from './factories.js';

const target = { spaceId: SPACE_ID, table: 'block' as const, id: PAGE_ID };

describe('OptimisticPatcher — `set`', () => {
  let store: RecordStoreApi;
  let patcher: OptimisticPatcher;

  beforeEach(() => {
    store = createRecordStore();
    patcher = new OptimisticPatcher({ store, now: () => 42 });
    store.getState().setRecord('block', makePage({ id: PAGE_ID }));
  });

  it('applies a nested set synchronously', () => {
    const transaction = new TransactionBuilder(target)
      .set(['properties', 'title'], richText('Updated Document Title'))
      .build();

    const result = patcher.applyTransaction(transaction);

    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Updated Document Title'],
    ]);
    expect(store.getState().revision).toBe(2);
  });

  it('applies primitive sets (`alive: false`, numeric timestamps)', () => {
    const transaction = new TransactionBuilder(target)
      .set(['alive'], false)
      .set(['version'], 7)
      .build();

    patcher.applyTransaction(transaction);

    const block = store.getState().blocks[PAGE_ID];
    expect(block?.alive).toBe(false);
    expect(block?.version).toBe(7);
  });

  it('replaces whole objects and arrays', () => {
    const transaction = new TransactionBuilder(target)
      .set(['format'], { page_icon: '🚀' })
      .set(['content'], ['a', 'b'])
      .build();

    patcher.applyTransaction(transaction);

    expect(store.getState().blocks[PAGE_ID]?.format).toEqual({
      page_icon: '🚀',
    });
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual(['a', 'b']);
  });

  it('never mutates the pre-patch record object', () => {
    const before = store.getState().blocks[PAGE_ID] as Block;
    const beforeTitle = before.properties.title;

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .set(['properties', 'title'], [['New']])
        .build(),
    );

    const after = store.getState().blocks[PAGE_ID] as Block;
    expect(after).not.toBe(before);
    expect(before.properties.title).toBe(beforeTitle);
    expect(before.properties.title).toEqual([['Untitled']]);
  });

  it('preserves identity of untouched records', () => {
    const other = makeTextBlock({ id: id(500) });
    store.getState().setRecord('block', other);

    patcher.applyTransaction(
      new TransactionBuilder(target).set(['alive'], false).build(),
    );

    expect(store.getState().blocks[other.id]).toBe(other);
  });

  it('stamps last_edited_time when timestamps are enabled', () => {
    patcher.applyTransaction(
      new TransactionBuilder(target)
        .set(['properties', 'title'], [['x']])
        .build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.last_edited_time).toBe(42);
  });

  it('can leave audit timestamps untouched', () => {
    const quiet = new OptimisticPatcher({ store, touchTimestamps: false });
    const original = store.getState().blocks[PAGE_ID]?.last_edited_time;
    quiet.applyTransaction(
      new TransactionBuilder(target).set(['alive'], false).build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.last_edited_time).toBe(original);
  });
});

describe('OptimisticPatcher — `update`', () => {
  it('shallow-merges object fields without dropping siblings', () => {
    const store = createRecordStore();
    const block = makeTextBlock({
      id: PAGE_ID,
      format: { block_color: 'blue', block_width: 10 },
    });
    store.getState().setRecord('block', block);
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .update(['format'], { block_color: 'red' })
        .build(),
    );

    expect(store.getState().blocks[PAGE_ID]?.format).toEqual({
      block_color: 'red',
      block_width: 10,
    });
  });

  it('creates the target object when the path is absent', () => {
    const store = createRecordStore();
    store
      .getState()
      .setRecord('block', makePage({ id: PAGE_ID, properties: {} }));
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .update(['properties'], { checked: [['yes']] })
        .build(),
    );

    expect(store.getState().blocks[PAGE_ID]?.properties).toEqual({
      checked: [['yes']],
    });
  });

  it('keyedObjectSet writes one key and keeps the rest', () => {
    const store = createRecordStore();
    store.getState().setRecord(
      'block',
      makeTextBlock({
        id: PAGE_ID,
        properties: { title: [['A']], source: [['s3://x']] },
      }),
    );
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .keyedObjectSet(['properties'], 'language', [['ts']])
        .build(),
    );

    expect(store.getState().blocks[PAGE_ID]?.properties).toEqual({
      title: [['A']],
      source: [['s3://x']],
      language: [['ts']],
    });
  });
});

describe('OptimisticPatcher — list operations', () => {
  function seeded() {
    const store = createRecordStore();
    const page = makePage({ id: PAGE_ID, children: ['a', 'b', 'c'] });
    for (const childId of ['a', 'b', 'c']) {
      store.getState().setRecord('block', makeTextBlock({ id: childId }));
    }
    store.getState().setRecord('block', page);
    return { store, patcher: new OptimisticPatcher({ store }) };
  }

  it('listAfter inserts immediately after the anchor', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target).listAfter(['content'], 'a', 'new').build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual([
      'a',
      'new',
      'b',
      'c',
    ]);
  });

  it('listAfter with a null anchor prepends', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target)
        .listAfter(['content'], null, 'first')
        .build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual([
      'first',
      'a',
      'b',
      'c',
    ]);
  });

  it('listBefore inserts immediately before the anchor', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target)
        .listBefore(['content'], 'c', 'new')
        .build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual([
      'a',
      'b',
      'new',
      'c',
    ]);
  });

  it('listBefore with a null anchor appends', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target)
        .listBefore(['content'], null, 'last')
        .build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual([
      'a',
      'b',
      'c',
      'last',
    ]);
  });

  it('listRemove drops the element', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target).listRemove(['content'], 'b').build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual(['a', 'c']);
  });

  it('list operations are idempotent (a duplicated insert is not doubled)', () => {
    const { store, patcher } = seeded();
    const transaction = new TransactionBuilder(target)
      .listAfter(['content'], 'a', 'new')
      .build();
    patcher.applyTransaction(transaction);
    patcher.applyTransaction(transaction);
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual([
      'a',
      'new',
      'b',
      'c',
    ]);
  });

  it('skips (never throws) list operations on missing anchors or non-lists', () => {
    const { store, patcher } = seeded();
    const transaction = makeTransaction([
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['content'],
        command: 'listAfter',
        args: { id: 'x', after: 'missing-anchor' },
      },
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['version'],
        command: 'listRemove',
        args: { id: 'a' },
      },
    ]);

    const result = patcher.applyTransaction(transaction);

    expect(result.applied).toBe(0);
    expect(result.skipped.map((entry) => entry.reason)).toEqual([
      'anchor missing-anchor not found in list',
      'target path is not a list',
    ]);
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual(['a', 'b', 'c']);
  });

  it('reorders a list with listRemove + listAfter in one atomic transaction', () => {
    const { store, patcher } = seeded();
    patcher.applyTransaction(
      new TransactionBuilder(target)
        .listRemove(['content'], 'c')
        .listAfter(['content'], 'a', 'c')
        .build(),
    );
    expect(store.getState().blocks[PAGE_ID]?.content).toEqual(['a', 'c', 'b']);
  });
});

describe('OptimisticPatcher — atomicity & reporting', () => {
  it('commits all operations of a transaction in a single store update', () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage({ id: PAGE_ID }));
    store.getState().setRecord('block', makeTextBlock({ id: id(600) }));
    const patcher = new OptimisticPatcher({ store });
    const listener = vi.fn();
    store.subscribe(listener);

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .set(['properties', 'title'], [['Batch']])
        .listAfter(['content'], null, id(600))
        .build(),
    );

    // Exactly one notification: subscribers never observe a half-applied batch.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips operations on records that are not cached', () => {
    const store = createRecordStore();
    const patcher = new OptimisticPatcher({ store });
    const result = patcher.applyTransaction(
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: 'ghost' })
        .set(['alive'], false)
        .build(),
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('not cached locally');
    expect(store.getState().revision).toBe(0);
  });

  it('reports touched records with before/after snapshots', () => {
    const store = createRecordStore();
    const original = makePage({ id: PAGE_ID });
    store.getState().setRecord('block', original);
    const patcher = new OptimisticPatcher({ store });

    const result = patcher.applyTransaction(
      new TransactionBuilder(target).set(['alive'], false).build(),
    );

    expect(result.touched).toHaveLength(1);
    expect(result.touched[0]?.before).toBe(original);
    expect(result.touched[0]?.after.alive).toBe(false);
    expect(result.transactionId).toBeTruthy();
  });

  it('applies multiple transactions in order, atomically', () => {
    const store = createRecordStore();
    store
      .getState()
      .setRecord('block', makePage({ id: PAGE_ID, children: [] }));
    const patcher = new OptimisticPatcher({ store });

    const first = new TransactionBuilder(target)
      .listAfter(['content'], null, 'a')
      .build();
    const second = new TransactionBuilder(target)
      .listAfter(['content'], 'a', 'b')
      .build();

    patcher.applyTransactions([first, second]);

    expect(store.getState().blocks[PAGE_ID]?.content).toEqual(['a', 'b']);
  });

  it('applies patches to collections and views', () => {
    const store = createRecordStore();
    const collection = makeCollection();
    const view = makeCollectionView();
    store.getState().loadRecords({
      collection: { [collection.id]: collection },
      collection_view: { [view.id]: view },
    });
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      makeTransaction([
        {
          pointer: {
            table: 'collection',
            id: collection.id,
            spaceId: SPACE_ID,
          },
          path: ['name'],
          command: 'set',
          args: [['Renamed']],
        },
        {
          pointer: { table: 'collection_view', id: view.id, spaceId: SPACE_ID },
          path: ['type'],
          command: 'set',
          args: 'board',
        },
      ]),
    );

    expect(store.getState().collections[collection.id]?.name).toEqual([
      ['Renamed'],
    ]);
    expect(store.getState().collectionViews[view.id]?.type).toBe('board');
  });

  it('preserves the explicit last_edited_by_id of a patch', () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage({ id: PAGE_ID }));
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .set(['last_edited_by_id'], USER_ID)
        .build(),
    );

    expect(store.getState().blocks[PAGE_ID]?.last_edited_by_id).toBe(USER_ID);
  });

  it('toggles a to-do checkbox (the canonical optimistic mutation)', () => {
    const store = createRecordStore();
    const todo = makeTodoBlock({ id: PAGE_ID });
    store.getState().setRecord('block', todo);
    const patcher = new OptimisticPatcher({ store });

    patcher.applyTransaction(
      new TransactionBuilder(target)
        .set(['properties', 'checked'], [['yes']])
        .build(),
    );

    expect(store.getState().blocks[PAGE_ID]?.properties.checked).toEqual([
      ['yes'],
    ]);
  });
});

describe('OptimisticPatcher — inbound realtime updates', () => {
  it('merges a record_updated envelope and raises the version', () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage({ id: PAGE_ID, version: 3 }));
    const patcher = new OptimisticPatcher({ store });

    const changed = patcher.applyRemotePatch({
      type: 'record_updated',
      table: 'block',
      id: PAGE_ID,
      version: 4,
      patch: { properties: { title: [['From peer']] } },
    });

    expect(changed).toBe(true);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['From peer'],
    ]);
    expect(store.getState().blocks[PAGE_ID]?.version).toBe(4);
  });

  it('ignores non-record_updated envelopes and unknown records', () => {
    const store = createRecordStore();
    const patcher = new OptimisticPatcher({ store });

    expect(patcher.applyRemotePatch({ type: 'heartbeat', timestamp: 1 })).toBe(
      false,
    );
    expect(
      patcher.applyRemotePatch({
        type: 'record_updated',
        table: 'block',
        id: 'unknown',
        version: 2,
        patch: { alive: false },
      }),
    ).toBe(false);
  });

  it('never lowers a version on a stale envelope', () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage({ id: PAGE_ID, version: 9 }));
    const patcher = new OptimisticPatcher({ store });

    patcher.applyRemotePatch({
      type: 'record_updated',
      table: 'block',
      id: PAGE_ID,
      version: 2,
      patch: { alive: false },
    });

    expect(store.getState().blocks[PAGE_ID]?.version).toBe(9);
    expect(store.getState().blocks[PAGE_ID]?.alive).toBe(false);
  });
});

describe('OptimisticPatcher — performance contract', () => {
  it('applies 1 000 operations well under a frame budget', () => {
    const store = createRecordStore();
    for (let index = 0; index < 500; index += 1) {
      store
        .getState()
        .setRecord('block', makeTextBlock({ id: id(1000 + index) }));
    }
    const patcher = new OptimisticPatcher({ store, touchTimestamps: false });
    const transactions: Transaction[] = [];
    for (let index = 0; index < 1000; index += 1) {
      transactions.push(
        new TransactionBuilder({
          spaceId: SPACE_ID,
          table: 'block',
          id: id(1000 + (index % 500)),
        })
          .set(['properties', 'title'], [[`t${index}`]])
          .build(),
      );
    }

    const started = performance.now();
    for (const transaction of transactions) {
      patcher.applyTransaction(transaction);
    }
    const elapsed = performance.now() - started;

    // The last write to the first fixture block is operation #500 (`500 % 500`).
    expect(store.getState().blocks[id(1000)]?.properties.title).toEqual([
      ['t500'],
    ]);
    expect(store.getState().blocks[id(1499)]?.properties.title).toEqual([
      ['t999'],
    ]);
    // Generous bound: CI machines are noisy, but 1 000 ops must not take ~1s.
    expect(elapsed).toBeLessThan(1000);
  });
});
