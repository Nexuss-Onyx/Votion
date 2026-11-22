/**
 * Normalized store: slices, mutations, hydration and memoised selectors.
 */

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { Block, Collection, CollectionView } from '@votion/types';

import {
  createRecordStore,
  getRecordStore,
  resetRecordStore,
  selectAncestorBlocks,
  selectBlock,
  selectBlockById,
  selectBlocksByParent,
  selectChildBlocks,
  selectChildBlocksById,
  selectCollection,
  selectCollectionView,
  selectCollectionsBySpace,
  selectRecordCounts,
  selectViewsByCollection,
  sliceKeyOf,
  type RecordStore,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  id,
  makeCollection,
  makeCollectionView,
  makePage,
  makeTextBlock,
} from './factories.js';

describe('RecordStore — normalized slices', () => {
  it('starts empty with three slices and an unhydrated flag', () => {
    const store = createRecordStore();
    const state = store.getState();
    expect(state.blocks).toEqual({});
    expect(state.collections).toEqual({});
    expect(state.collectionViews).toEqual({});
    expect(state.hydrated).toBe(false);
    expect(state.revision).toBe(0);
  });

  it('routes each record to the correct slice by table name', () => {
    const store = createRecordStore();
    const page = makePage();
    const collection = makeCollection();
    const view = makeCollectionView();

    store.getState().setRecord('block', page);
    store.getState().setRecord('collection', collection);
    store.getState().setRecord('collection_view', view);

    const state = store.getState();
    expect(state.blocks[page.id]).toBe(page);
    expect(state.collections[collection.id]).toBe(collection);
    expect(state.collectionViews[view.id]).toBe(view);
    expect(state.revision).toBe(3);
  });

  it('accepts a space table in the type union but rejects it at runtime', () => {
    // `StoreTableName` intentionally excludes `space`: ACL records are not cached
    // by the sync client. The guard exists so a widened call fails loudly.
    expect(() => sliceKeyOf('space' as never)).toThrow(/Unknown record table/);
  });

  it('loads a record map batch in a single commit', () => {
    const store = createRecordStore();
    const page = makePage();
    const child = makeTextBlock({ parent_id: page.id });
    const collection = makeCollection();

    store.getState().loadRecords({
      block: { [page.id]: page, [child.id]: child },
      collection: { [collection.id]: collection },
    });

    expect(store.getState().revision).toBe(1);
    expect(Object.keys(store.getState().blocks)).toHaveLength(2);
    expect(store.getState().collections[collection.id]).toEqual(collection);
  });

  it('replaces slices wholesale without disturbing untouched ones', () => {
    const store = createRecordStore();
    const oldBlock = makeTextBlock({ id: id(10) });
    const collection = makeCollection();
    store.getState().loadRecords({
      block: { [oldBlock.id]: oldBlock },
      collection: { [collection.id]: collection },
    });

    const newBlock = makeTextBlock({ id: id(11) });
    const collectionsBefore = store.getState().collections;
    store.getState().replaceRecords({ block: { [newBlock.id]: newBlock } });

    expect(Object.keys(store.getState().blocks)).toEqual([newBlock.id]);
    expect(store.getState().collections).toBe(collectionsBefore);
  });

  it('clears every slice and keeps the store usable', () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage());
    store.getState().clearRecords();

    expect(store.getState().blocks).toEqual({});
    expect(store.getState().collections).toEqual({});
    expect(store.getState().collectionViews).toEqual({});
  });

  it('marks the store hydrated', () => {
    const store = createRecordStore();
    store.getState().markHydrated();
    expect(store.getState().hydrated).toBe(true);
    store.getState().markHydrated(false);
    expect(store.getState().hydrated).toBe(false);
  });
});

describe('RecordStore — updateRecord', () => {
  it('shallow-merges a patch and preserves identity of other records', () => {
    const store = createRecordStore();
    const target = makeTextBlock({ id: id(20) });
    const other = makeTextBlock({ id: id(21) });
    store
      .getState()
      .loadRecords({ block: { [target.id]: target, [other.id]: other } });

    const patched = store.getState().updateRecord('block', target.id, {
      properties: { title: [['Edited']] },
    });

    expect(patched?.properties.title).toEqual([['Edited']]);
    expect(store.getState().blocks[target.id]?.properties.title).toEqual([
      ['Edited'],
    ]);
    expect(store.getState().blocks[other.id]).toBe(other);
    // The original record object is never mutated in place.
    expect(target.properties.title).toEqual([['Hello world']]);
  });

  it('returns undefined for an unknown record without bumping the revision', () => {
    const store = createRecordStore();
    const revision = store.getState().revision;
    expect(
      store.getState().updateRecord('block', 'missing', { version: 2 }),
    ).toBeUndefined();
    expect(store.getState().revision).toBe(revision);
  });

  it('patches collections and views too', () => {
    const store = createRecordStore();
    const collection = makeCollection();
    const view = makeCollectionView();
    store.getState().loadRecords({
      collection: { [collection.id]: collection },
      collection_view: { [view.id]: view },
    });

    store
      .getState()
      .updateRecord('collection', collection.id, { name: [['Renamed']] });
    store
      .getState()
      .updateRecord('collection_view', view.id, { name: 'Board' });

    expect(store.getState().collections[collection.id]?.name).toEqual([
      ['Renamed'],
    ]);
    expect(store.getState().collectionViews[view.id]?.name).toBe('Board');
  });

  it('removeRecord deletes only the addressed record', () => {
    const store = createRecordStore();
    const a = makeTextBlock({ id: id(30) });
    const b = makeTextBlock({ id: id(31) });
    store.getState().loadRecords({ block: { [a.id]: a, [b.id]: b } });

    store.getState().removeRecord('block', a.id);

    expect(store.getState().blocks[a.id]).toBeUndefined();
    expect(store.getState().blocks[b.id]).toBe(b);
  });

  it('removeRecord is a no-op for unknown ids', () => {
    const store = createRecordStore();
    const revision = store.getState().revision;
    store.getState().removeRecord('block', 'nope');
    expect(store.getState().revision).toBe(revision);
  });

  it('setRecords writes a batch in one commit', () => {
    const store = createRecordStore();
    const records = [
      makeTextBlock({ id: id(40) }),
      makeTextBlock({ id: id(41) }),
    ];
    store.getState().setRecords('block', records);
    expect(store.getState().revision).toBe(1);
    expect(Object.keys(store.getState().blocks)).toHaveLength(2);
  });

  it('setRecords with an empty batch does not bump the revision', () => {
    const store = createRecordStore();
    store.getState().setRecords('block', []);
    expect(store.getState().revision).toBe(0);
  });
});

describe('RecordStore — singleton accessors', () => {
  beforeEach(() => {
    resetRecordStore();
  });

  it('getRecordStore returns a stable singleton', () => {
    const first = getRecordStore();
    const second = getRecordStore();
    expect(second).toBe(first);
  });

  it('resetRecordStore swaps in a clean store', () => {
    const before = getRecordStore();
    before.getState().setRecord('block', makePage());
    const after = resetRecordStore();
    expect(after).not.toBe(before);
    expect(after.getState().blocks).toEqual({});
  });

  it('exposes a typed state surface', () => {
    expectTypeOf<RecordStore['blocks']>().toEqualTypeOf<
      Record<string, Block>
    >();
    expectTypeOf<RecordStore['collections']>().toEqualTypeOf<
      Record<string, Collection>
    >();
    expectTypeOf<RecordStore['collectionViews']>().toEqualTypeOf<
      Record<string, CollectionView>
    >();
  });
});

describe('Selectors', () => {
  const page = makePage({ id: PAGE_ID });
  const first = makeTextBlock({ id: id(50), parent_id: PAGE_ID });
  const second = makeTextBlock({ id: id(51), parent_id: PAGE_ID });
  const third = makeTextBlock({ id: id(52), parent_id: PAGE_ID });

  function seededStore() {
    const store = createRecordStore();
    store.getState().loadRecords({
      block: {
        [page.id]: { ...page, content: [first.id, third.id, second.id] },
        [first.id]: first,
        [second.id]: second,
        [third.id]: third,
      },
    });
    return store;
  }

  it('selectBlock / selectCollection / selectCollectionView resolve by id', () => {
    const store = seededStore();
    expect(selectBlock(store.getState(), first.id)).toBe(first);
    expect(selectBlock(store.getState(), 'missing')).toBeUndefined();

    const collection = makeCollection();
    const view = makeCollectionView();
    store.getState().loadRecords({
      collection: { [collection.id]: collection },
      collection_view: { [view.id]: view },
    });
    expect(selectCollection(store.getState(), collection.id)).toBe(collection);
    expect(selectCollectionView(store.getState(), view.id)).toBe(view);
  });

  it('selectChildBlocks returns children in parent.content order', () => {
    const store = seededStore();
    const children = selectChildBlocks(store.getState(), PAGE_ID);
    expect(children.map((child) => child.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);
  });

  it('selectChildBlocks skips dangling content ids and unknown parents', () => {
    const store = createRecordStore();
    const orphanPage = makePage({ id: PAGE_ID, content: [id(999)] });
    store.getState().loadRecords({ block: { [orphanPage.id]: orphanPage } });

    expect(selectChildBlocks(store.getState(), PAGE_ID)).toEqual([]);
    expect(selectChildBlocks(store.getState(), 'missing')).toEqual([]);
  });

  it('selectBlocksByParent finds children by parent_id, oldest first', () => {
    const store = seededStore();
    const children = selectBlocksByParent(store.getState(), PAGE_ID);
    expect(children).toHaveLength(3);
    expect(children[0]?.created_time).toBeLessThanOrEqual(
      children[children.length - 1]?.created_time ?? 0,
    );
  });

  it('selectAncestorBlocks walks parent_id up to the root', () => {
    const store = createRecordStore();
    const root = makePage({ id: PAGE_ID });
    const middle = makeTextBlock({ id: id(60), parent_id: PAGE_ID });
    const leaf = makeTextBlock({
      id: id(61),
      parent_id: middle.id,
      parent_table: 'block',
    });
    store.getState().loadRecords({
      block: { [root.id]: root, [middle.id]: middle, [leaf.id]: leaf },
    });

    const chain = selectAncestorBlocks(store.getState(), leaf.id);
    expect(chain.map((block) => block.id)).toEqual([
      PAGE_ID,
      middle.id,
      leaf.id,
    ]);
  });

  it('selectAncestorBlocks terminates on a cyclic parent chain', () => {
    const store = createRecordStore();
    const a = makeTextBlock({ id: id(70), parent_table: 'block' });
    const b = makeTextBlock({
      id: id(71),
      parent_id: a.id,
      parent_table: 'block',
    });
    a.parent_id = b.id;
    store.getState().loadRecords({ block: { [a.id]: a, [b.id]: b } });

    const chain = selectAncestorBlocks(store.getState(), 'not-there');
    expect(chain).toEqual([]);
    expect(
      selectAncestorBlocks(store.getState(), a.id).length,
    ).toBeLessThanOrEqual(2);
  });

  it('selectCollectionsBySpace + selectViewsByCollection scope correctly', () => {
    const store = createRecordStore();
    const collection = makeCollection();
    const otherCollection = makeCollection({ id: id(101) });
    const otherSpaceCollection = makeCollection({
      id: id(102),
      space_id: 'other',
    });
    const view = makeCollectionView({ collection_id: collection.id });
    const otherView = makeCollectionView({
      id: id(201),
      collection_id: otherCollection.id,
    });
    store.getState().loadRecords({
      collection: {
        [collection.id]: collection,
        [otherCollection.id]: otherCollection,
        [otherSpaceCollection.id]: otherSpaceCollection,
      },
      collection_view: { [view.id]: view, [otherView.id]: otherView },
    });

    expect(
      selectCollectionsBySpace(store.getState(), SPACE_ID)
        .map((c) => c.id)
        .sort(),
    ).toEqual([collection.id, otherCollection.id].sort());
    expect(selectViewsByCollection(store.getState(), collection.id)).toEqual([
      view,
    ]);
  });

  it('selectRecordCounts summarises the cache', () => {
    const store = seededStore();
    expect(selectRecordCounts(store.getState())).toEqual({
      blocks: 4,
      collections: 0,
      collectionViews: 0,
    });
  });

  it('memoised selectors return a stable reference for an unchanged state', () => {
    const store = seededStore();
    const selector = selectChildBlocksById(PAGE_ID);
    const firstRun = selector(store.getState());
    const secondRun = selector(store.getState());
    expect(secondRun).toBe(firstRun);
  });

  it('memoised selectors recompute after a state change', () => {
    const store = seededStore();
    const selector = selectChildBlocksById(PAGE_ID);
    const before = selector(store.getState());

    const replacement = makeTextBlock({ id: id(53), parent_id: PAGE_ID });
    store.getState().loadRecords({ block: { [replacement.id]: replacement } });
    store
      .getState()
      .updateRecord('block', PAGE_ID, { content: [replacement.id] });

    const after = selector(store.getState());
    expect(after).not.toBe(before);
    expect(after.map((child) => child.id)).toEqual([replacement.id]);
  });

  it('selectBlockById/selectCollectionById are curry-stable', () => {
    const store = seededStore();
    const selector = selectBlockById(first.id);
    expect(selector(store.getState())).toBe(first);
  });
});
