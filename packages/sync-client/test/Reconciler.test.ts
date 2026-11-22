/**
 * Reconciler: per-field conflict resolution between cache and server.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@votion/types';

import {
  Reconciler,
  TransactionBuilder,
  createRecordStore,
  jsonEqual,
  type RecordStoreApi,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  id,
  makeCollection,
  makeCollectionView,
  makePage,
  makeTransaction,
  richText,
} from './factories.js';

let store: RecordStoreApi;

beforeEach(() => {
  store = createRecordStore();
  store.getState().setRecord(
    'block',
    makePage({
      id: PAGE_ID,
      version: 1,
      properties: { title: richText('Local title') },
    }),
  );
});

describe('jsonEqual', () => {
  it('compares primitives, arrays and nested objects structurally', () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual('a', 'b')).toBe(false);
    expect(jsonEqual([['a'], ['b']], [['a'], ['b']])).toBe(true);
    expect(jsonEqual([['a']], [['a'], ['b']])).toBe(false);
    expect(jsonEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
  });
});

describe('Reconciler — version decisions', () => {
  it('fast-forwards when the remote version is newer', () => {
    const reconciler = new Reconciler({ store });
    const result = reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 2,
      patch: { alive: false },
    });

    expect(result?.conflict).toBe('remote-newer');
    expect(result?.changed).toBe(true);
    expect(result?.version).toBe(2);
    expect(store.getState().blocks[PAGE_ID]?.alive).toBe(false);
  });

  it('classifies identical versions without mutating equal fields', () => {
    const reconciler = new Reconciler({ store });
    const result = reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 1,
      patch: { properties: { title: richText('Local title') } },
    });

    expect(result?.conflict).toBe('identical');
    expect(result?.changed).toBe(false);
    expect(result?.fields[0]?.reason).toBe('equal');
  });

  it('flags a stale local record as local-newer but still adopts unseen fields', () => {
    store.getState().updateRecord('block', PAGE_ID, { version: 9 });
    const reconciler = new Reconciler({ store });
    const result = reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 4,
      patch: { format: { page_icon: '🎯' } },
    });

    expect(result?.conflict).toBe('local-newer');
    expect(result?.version).toBe(9);
    expect(store.getState().blocks[PAGE_ID]?.format).toEqual({
      page_icon: '🎯',
    });
  });

  it('reports missing-local without creating phantom records', () => {
    const reconciler = new Reconciler({ store });
    const result = reconciler.reconcile({
      table: 'block',
      id: 'ghost',
      version: 2,
      patch: { alive: false },
    });

    expect(result?.conflict).toBe('missing-local');
    expect(result?.changed).toBe(false);
    expect(store.getState().blocks.ghost).toBeUndefined();
  });
});

describe('Reconciler — field-level patches', () => {
  it('applies only non-conflicting fields', () => {
    const pending: Transaction[] = [
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: PAGE_ID })
        .set(['properties', 'title'], [['Typing…']])
        .build(),
    ];
    const reconciler = new Reconciler({
      store,
      pendingTransactions: () => pending,
    });

    const result = reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 3,
      patch: {
        properties: { title: [['Remote title']] },
        format: { page_icon: '🚀' },
      },
    });

    expect(result?.shadowed).toEqual(['properties']);
    expect(result?.conflict).toBe('diverged');
    // The pending local edit wins; the untouched field lands.
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Local title'],
    ]);
    expect(store.getState().blocks[PAGE_ID]?.format).toEqual({
      page_icon: '🚀',
    });
    expect(result?.version).toBe(3);
  });

  it('ignores pending transactions for a different record', () => {
    const pending: Transaction[] = [
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: id(999) })
        .set(['properties', 'title'], [['Other']])
        .build(),
    ];
    const reconciler = new Reconciler({
      store,
      pendingTransactions: () => pending,
    });

    const result = reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 2,
      patch: { properties: { title: [['Remote wins']] } },
    });

    expect(result?.shadowed).toEqual([]);
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Remote wins'],
    ]);
  });

  it('resolves nested paths to their root field for shadowing', () => {
    const pending: Transaction[] = [
      makeTransaction([
        {
          pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
          path: ['properties', 'title', 0, 0],
          command: 'set',
          args: 'nested edit',
        },
      ]),
    ];
    const reconciler = new Reconciler({
      store,
      pendingTransactions: () => pending,
    });

    reconciler.reconcile({
      table: 'block',
      id: PAGE_ID,
      version: 2,
      patch: { properties: { title: [['Remote']] }, alive: false },
    });

    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Local title'],
    ]);
    expect(store.getState().blocks[PAGE_ID]?.alive).toBe(false);
  });

  it('reconciles collections and views through the same path', () => {
    const collection = makeCollection();
    const view = makeCollectionView();
    store.getState().loadRecords({
      collection: { [collection.id]: collection },
      collection_view: { [view.id]: view },
    });
    const reconciler = new Reconciler({ store });

    reconciler.reconcile({
      table: 'collection',
      id: collection.id,
      version: 2,
      patch: { name: [['Renamed']] },
    });
    reconciler.reconcile({
      table: 'collection_view',
      id: view.id,
      version: 2,
      patch: { type: 'board' },
    });

    expect(store.getState().collections[collection.id]?.name).toEqual([
      ['Renamed'],
    ]);
    expect(store.getState().collectionViews[view.id]?.type).toBe('board');
  });
});

describe('Reconciler — acknowledgements', () => {
  it('bumps versions forward from an ack payload', () => {
    const reconciler = new Reconciler({ store });
    const updated = reconciler.acknowledgeVersions({ [PAGE_ID]: 12 });

    expect(updated).toBe(1);
    expect(store.getState().blocks[PAGE_ID]?.version).toBe(12);
    // Content is untouched: an ack only confirms the version.
    expect(store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Local title'],
    ]);
  });

  it('never moves a version backwards', () => {
    store.getState().updateRecord('block', PAGE_ID, { version: 20 });
    const reconciler = new Reconciler({ store });

    expect(reconciler.acknowledgeVersions({ [PAGE_ID]: 3 })).toBe(0);
    expect(store.getState().blocks[PAGE_ID]?.version).toBe(20);
  });

  it('skips ids that are not cached', () => {
    const reconciler = new Reconciler({ store });
    expect(reconciler.acknowledgeVersions({ ghost: 5 })).toBe(0);
  });
});
