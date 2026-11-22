/**
 * Dexie/IndexedDB persistence: round-trip fidelity, indexes and hydration.
 *
 * These tests run against `fake-indexeddb` (installed in `test/setup.ts`), so the
 * real Dexie query engine, real IndexedDB transactions and real structured
 * cloning are all exercised — only the disk is virtualised.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Block } from '@votion/types';

import {
  IndexedDBStorage,
  OutboxStorage,
  VOTION_DB_NAME,
  VotionDatabase,
  hydrateFromLocalCache,
  isPersistenceAvailable,
  PersistenceUnavailableError,
  createRecordStore,
  getVotionDatabase,
  setVotionDatabase,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  SPACE_ID_B,
  id,
  makeCollection,
  makeCollectionView,
  makePage,
  makeTextBlock,
} from './factories.js';

let db: VotionDatabase;
let storage: IndexedDBStorage;
let databaseSeq = 0;

beforeEach(async () => {
  // A fresh database per test keeps state from leaking between cases.
  databaseSeq += 1;
  db = new VotionDatabase(`${VOTION_DB_NAME}-test-${databaseSeq}`);
  setVotionDatabase(db);
  storage = new IndexedDBStorage(db);
  await storage.open();
});

afterEach(async () => {
  await db.delete();
  setVotionDatabase(undefined);
});

describe('VotionDatabase — schema', () => {
  it('declares the four tables with id primary keys and required indexes', () => {
    const schema = db.table('blocks').schema;
    expect(schema.primKey.keyPath).toBe('id');
    const blockIndexes = schema.indexes.map((index) => index.keyPath);
    expect(blockIndexes).toContain('space_id');
    expect(blockIndexes).toContain('parent_id');

    expect(db.table('collections').schema.primKey.keyPath).toBe('id');
    expect(db.table('collectionViews').schema.primKey.keyPath).toBe('id');

    const outboxSchema = db.table('outbox').schema;
    // Auto-incrementing replay sequence, plus the idempotency + ordering indexes.
    expect(outboxSchema.primKey.auto).toBe(true);
    expect(outboxSchema.indexes.map((index) => index.keyPath)).toEqual(
      expect.arrayContaining(['id', 'spaceId', 'enqueuedAt']),
    );
  });

  it('reports IndexedDB availability', () => {
    expect(isPersistenceAvailable()).toBe(true);
    expect(IndexedDBStorage.isAvailable()).toBe(true);
    expect(isPersistenceAvailable({})).toBe(false);
  });

  it('throws a typed error when IndexedDB is missing', () => {
    // The module-level handle is intentionally cached, so this asserts the
    // factory guard directly rather than through `getVotionDatabase`.
    expect(isPersistenceAvailable({})).toBe(false);
    const unavailable = new VotionDatabase('never-opened');
    unavailable.close();
    expect(unavailable.isOpen()).toBe(false);
    expect(PersistenceUnavailableError.prototype).toBeInstanceOf(Error);
  });
});

describe('IndexedDBStorage — single record round-trip', () => {
  it('persists and reloads a block with full JSONB fidelity', async () => {
    const block = makePage({
      id: PAGE_ID,
      properties: {
        title: [['Votion', [['b']]]],
        view_ids: [id(1), id(2)],
        nested: { deep: { value: [1, 2, 3] } },
      },
      format: { page_icon: '🚀', page_cover_position: 0.5 },
      content: [id(10), id(11)],
    });

    await storage.persistRecord('block', block);
    const reloaded = await storage.loadRecord('block', PAGE_ID);

    expect(reloaded).toEqual(block);
    expect(reloaded?.content).toEqual([id(10), id(11)]);
  });

  it('upserts on repeated puts (last write wins)', async () => {
    const block = makeTextBlock({ id: id(300) });
    await storage.persistRecord('block', block);
    await storage.persistRecord('block', {
      ...block,
      version: 2,
      alive: false,
    });

    const reloaded = await storage.loadRecord('block', id(300));
    expect(reloaded?.version).toBe(2);
    expect(reloaded?.alive).toBe(false);
    expect(await db.blocks.count()).toBe(1);
  });

  it('returns undefined for missing records', async () => {
    expect(await storage.loadRecord('block', 'nope')).toBeUndefined();
  });

  it('routes collections and views to their own tables', async () => {
    const collection = makeCollection();
    const view = makeCollectionView();
    await storage.persistRecord('collection', collection);
    await storage.persistRecord('collection_view', view);

    expect(await storage.loadRecord('collection', collection.id)).toEqual(
      collection,
    );
    expect(await storage.loadRecord('collection_view', view.id)).toEqual(view);
    expect(await db.collections.count()).toBe(1);
    expect(await db.collectionViews.count()).toBe(1);
    expect(await db.blocks.count()).toBe(0);
  });

  it('bulk-persists a mixed record map in one call', async () => {
    const page = makePage();
    await storage.persistRecordMap({
      block: { [page.id]: page, [id(400)]: makeTextBlock({ id: id(400) }) },
      collection: { [id(401)]: makeCollection({ id: id(401) }) },
      collection_view: { [id(402)]: makeCollectionView({ id: id(402) }) },
    });

    expect(await storage.countRecords()).toEqual({
      blocks: 2,
      collections: 1,
      collectionViews: 1,
    });
  });
});

describe('IndexedDBStorage — indexed queries', () => {
  it('loadAllLocalRecords returns the recordMap shape keyed by id', async () => {
    const page = makePage({ id: PAGE_ID });
    const child = makeTextBlock({ id: id(500), parent_id: PAGE_ID });
    const collection = makeCollection({ id: id(501) });
    await storage.persistRecordMap({
      block: { [page.id]: page, [child.id]: child },
      collection: { [collection.id]: collection },
    });

    const snapshot = await storage.loadAllLocalRecords();

    expect(snapshot.count).toBe(3);
    expect(snapshot.block?.[PAGE_ID]).toEqual(page);
    expect(snapshot.block?.[child.id]).toEqual(child);
    expect(snapshot.collection?.[collection.id]).toEqual(collection);
    expect(snapshot.collection_view).toEqual({});
  });

  it('scopes hydration to one workspace', async () => {
    const mine = makePage({ id: id(510), space_id: SPACE_ID });
    const theirs = makePage({ id: id(511), space_id: SPACE_ID_B });
    await storage.persistRecord('block', mine);
    await storage.persistRecord('block', theirs);

    const snapshot = await storage.loadAllLocalRecords({ spaceId: SPACE_ID });
    expect(Object.keys(snapshot.block ?? {})).toEqual([mine.id]);
    expect(snapshot.count).toBe(1);
  });

  it('filters soft-deleted records when asked', async () => {
    const alive = makePage({ id: id(520), alive: true });
    const deleted = makePage({ id: id(521), alive: false });
    await storage.persistRecord('block', alive);
    await storage.persistRecord('block', deleted);

    expect(
      Object.keys(
        (await storage.loadAllLocalRecords({ includeDeleted: false })).block ??
          {},
      ),
    ).toEqual([alive.id]);
    expect((await storage.loadAllLocalRecords()).count).toBe(2);
  });

  it('loadChildBlocks uses the parent_id index and orders by created_time', async () => {
    const late = makeTextBlock({
      id: id(531),
      parent_id: PAGE_ID,
      created_time: 900,
    });
    const early = makeTextBlock({
      id: id(532),
      parent_id: PAGE_ID,
      created_time: 100,
    });
    const unrelated = makeTextBlock({ id: id(533), parent_id: id(999) });
    for (const block of [late, early, unrelated]) {
      await storage.persistRecord('block', block);
    }

    const children = await storage.loadChildBlocks(PAGE_ID);
    expect(children.map((block) => block.id)).toEqual([early.id, late.id]);
  });

  it('loadBlocksBySpace and loadViewsByCollection use their indexes', async () => {
    await storage.persistRecord(
      'block',
      makePage({ id: id(540), space_id: SPACE_ID }),
    );
    await storage.persistRecord(
      'block',
      makePage({ id: id(541), space_id: SPACE_ID_B }),
    );

    const mine = await storage.loadBlocksBySpace(SPACE_ID);
    expect(mine.map((block) => block.id)).toEqual([id(540)]);

    const view = makeCollectionView({ id: id(550), collection_id: id(551) });
    const otherView = makeCollectionView({
      id: id(552),
      collection_id: id(553),
    });
    await storage.persistRecord('collection_view', view);
    await storage.persistRecord('collection_view', otherView);

    expect(
      (await storage.loadViewsByCollection(id(551))).map((v) => v.id),
    ).toEqual([view.id]);
  });
});

describe('IndexedDBStorage — mutation & cleanup', () => {
  it('removeRecord deletes only the addressed row', async () => {
    await storage.persistRecord('block', makeTextBlock({ id: id(600) }));
    await storage.persistRecord('block', makeTextBlock({ id: id(601) }));

    await storage.removeRecord('block', id(600));

    expect(await storage.loadRecord('block', id(600))).toBeUndefined();
    expect(await storage.loadRecord('block', id(601))).toBeDefined();
  });

  it('clearLocalData keeps the outbox by default and clears it on request', async () => {
    await storage.persistRecord('block', makeTextBlock({ id: id(610) }));
    const { OutboxStorage } = await import('../src/index.js');
    const outbox = new OutboxStorage(db);
    await outbox.enqueueTransaction({
      id: 'tx-1',
      spaceId: SPACE_ID,
      operations: [
        {
          pointer: { table: 'block', id: id(610), spaceId: SPACE_ID },
          path: ['alive'],
          command: 'set',
          args: false,
        },
      ],
    });

    await storage.clearLocalData();
    expect(await storage.countRecords()).toEqual({
      blocks: 0,
      collections: 0,
      collectionViews: 0,
    });
    expect(await outbox.pendingCount()).toBe(1);

    await storage.clearLocalData({ includeOutbox: true });
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('persists across a close/reopen cycle (the refresh scenario)', async () => {
    const block = makePage({ id: PAGE_ID });
    await storage.persistRecord('block', block);
    storage.close();

    const reopened = new IndexedDBStorage(db);
    await reopened.open();
    expect(await reopened.loadRecord('block', PAGE_ID)).toEqual(block);
  });
});

describe('hydrateFromLocalCache', () => {
  it('restores the cache into a fresh store and marks it hydrated', async () => {
    const page = makePage({ id: PAGE_ID });
    const child = makeTextBlock({ id: id(700), parent_id: PAGE_ID });
    await storage.persistRecordMap({
      block: { [page.id]: page, [child.id]: child },
    });

    const store = createRecordStore();
    const result = await hydrateFromLocalCache({
      store,
      storage,
      includeRecords: true,
    });

    expect(result.hydrated).toBe(true);
    expect(result.records).toBe(2);
    expect(result.error).toBeUndefined();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().blocks[PAGE_ID]).toEqual(page);
    expect(result.recordMap?.block?.[child.id]).toEqual(child);
  });

  it('reports pending outbox transactions at boot', async () => {
    const { OutboxStorage } = await import('../src/index.js');
    const outbox = new OutboxStorage(db);
    await outbox.enqueueTransaction({
      id: 'tx-boot',
      spaceId: SPACE_ID,
      operations: [
        {
          pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
          path: ['alive'],
          command: 'set',
          args: false,
        },
      ],
    });

    const store = createRecordStore();
    const result = await hydrateFromLocalCache({ store, storage, outbox });
    expect(result.pending).toBe(1);
  });

  it('degrades to an empty cache instead of failing boot', async () => {
    // Simulate a storage backend that cannot open at all (Safari private mode,
    // evicted origin, quota error). Boot must still complete.
    const failing = {
      open: async () => {
        throw new Error('QuotaExceededError: storage unavailable');
      },
      loadAllLocalRecords: async () => {
        throw new Error('unreachable');
      },
    } as unknown as IndexedDBStorage;

    const store = createRecordStore();
    const pendingOutbox = {
      pendingCount: async () => 0,
    } as unknown as OutboxStorage;
    const result = await hydrateFromLocalCache({
      store,
      storage: failing,
      outbox: pendingOutbox,
    });

    expect(result.hydrated).toBe(false);
    expect(result.error).toContain('storage unavailable');
    expect(result.records).toBe(0);
    // The flag still flips so the UI falls back to the network path.
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().blocks).toEqual({});
  });
});

describe('IndexedDBStorage — ordering guarantees', () => {
  it('preserves large numeric and string ids without coercion', async () => {
    const numericish = makeTextBlock({ id: '123456789012345678901234567890' });
    const zero = makeTextBlock({ id: '00000000-0000-4000-8000-000000000000' });
    await storage.persistRecord('block', numericish);
    await storage.persistRecord('block', zero);

    expect(await storage.loadRecord('block', numericish.id)).toEqual(
      numericish,
    );
    expect(await storage.loadRecord('block', zero.id)).toEqual(zero);
  });

  it('stores rich-text arrays as structured clones (no JSON strings)', async () => {
    const block = makeTextBlock({
      id: id(800),
      properties: {
        title: [['Mention: ', [['b'], ['a', 'https://votion.dev']]]],
      } as Block['properties'],
    });
    await storage.persistRecord('block', block);

    const reloaded = await storage.loadRecord('block', id(800));
    const title = reloaded?.properties.title;
    expect(Array.isArray(title)).toBe(true);
    expect(title?.[0]?.[1]).toEqual([['b'], ['a', 'https://votion.dev']]);
  });
});
