/**
 * Memoised record queries.
 *
 * Selectors are split into two layers:
 *  - **Pure functions** (`selectBlock`, `selectChildBlocks`, ...) that operate on
 *    a state snapshot and are trivially testable.
 *  - **Memoised factories** (`createBlockSelector`, ...) that cache the last
 *    result per input key, so `useRecordStore(createChildBlocksSelector(id))`
 *    returns a referentially stable array between renders and cannot trigger
 *    React's "getSnapshot should be cached" infinite loop.
 *
 * Every selector tolerates missing records and dangling `content` ids: a child
 * that has not been loaded yet is skipped rather than surfaced as `undefined`.
 */

import type { Block, Collection, CollectionView, UUID } from '@votion/types';
import type { RecordStore } from './RecordStore.js';

/** State subset required by the read selectors (keeps pure fns easy to call). */
export type SelectorState = Pick<
  RecordStore,
  'blocks' | 'collections' | 'collectionViews'
>;

/** Returns a block by id, or `undefined` when it is not cached. */
export function selectBlock(state: SelectorState, id: UUID): Block | undefined {
  return state.blocks[id];
}

/** Returns a collection by id, or `undefined` when it is not cached. */
export function selectCollection(
  state: SelectorState,
  id: UUID,
): Collection | undefined {
  return state.collections[id];
}

/** Returns a collection view by id, or `undefined` when it is not cached. */
export function selectCollectionView(
  state: SelectorState,
  id: UUID,
): CollectionView | undefined {
  return state.collectionViews[id];
}

/**
 * Resolves the ordered child blocks of `parentId`.
 *
 * Order is taken from the parent's `content` array (the canonical link list),
 * *not* from object insertion order, and unresolvable ids are dropped.
 */
export function selectChildBlocks(
  state: SelectorState,
  parentId: UUID,
): Block[] {
  const parent = state.blocks[parentId];
  if (!parent) {
    return [];
  }
  const children: Block[] = [];
  for (const childId of parent.content) {
    const child = state.blocks[childId];
    if (child) {
      children.push(child);
    }
  }
  return children;
}

/** Every live block whose `parent_id` is `parentId`, ordered by `created_time`. */
export function selectBlocksByParent(
  state: SelectorState,
  parentId: UUID,
): Block[] {
  const matches: Block[] = [];
  for (const block of Object.values(state.blocks)) {
    if (block.parent_id === parentId) {
      matches.push(block);
    }
  }
  return matches.sort((a, b) => a.created_time - b.created_time);
}

/** Walks the `parent_id` chain up to the root, root first. */
export function selectAncestorBlocks(state: SelectorState, id: UUID): Block[] {
  const chain: Block[] = [];
  const seen = new Set<UUID>();
  let cursor = state.blocks[id];
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor =
      cursor.parent_table === 'block'
        ? state.blocks[cursor.parent_id]
        : undefined;
  }
  return chain.reverse();
}

/** Every collection owned by a `space_id`. */
export function selectCollectionsBySpace(
  state: SelectorState,
  spaceId: UUID,
): Collection[] {
  return Object.values(state.collections).filter(
    (collection) => collection.space_id === spaceId,
  );
}

/** Every view attached to a collection, ordered by name. */
export function selectViewsByCollection(
  state: SelectorState,
  collectionId: UUID,
): CollectionView[] {
  return Object.values(state.collectionViews)
    .filter((view) => view.collection_id === collectionId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every block belonging to a space (used for hydration diagnostics). */
export function selectBlocksBySpace(
  state: SelectorState,
  spaceId: UUID,
): Block[] {
  return Object.values(state.blocks).filter(
    (block) => block.space_id === spaceId,
  );
}

/** Counts cached records per slice. */
export interface RecordCounts {
  blocks: number;
  collections: number;
  collectionViews: number;
}

/** Returns the number of cached records per slice. */
export function selectRecordCounts(state: SelectorState): RecordCounts {
  return {
    blocks: Object.keys(state.blocks).length,
    collections: Object.keys(state.collections).length,
    collectionViews: Object.keys(state.collectionViews).length,
  };
}

/**
 * Memoises a selector per argument key.
 *
 * The cache is bounded: once `maxEntries` distinct keys have been seen, a fresh
 * cache is started. That keeps long-lived sessions (thousands of visited blocks)
 * from leaking while preserving stability for the working set.
 */
export function memoizeByKey<A extends unknown[], R>(
  selector: (state: SelectorState, ...args: A) => R,
  maxEntries = 500,
): (state: SelectorState, ...args: A) => R {
  let cache = new Map<string, { state: SelectorState; result: R }>();

  return (state: SelectorState, ...args: A): R => {
    const key = args.map((arg) => String(arg)).join('\u0000');
    const hit = cache.get(key);
    if (hit && hit.state === state) {
      return hit.result;
    }
    const result = selector(state, ...args);
    if (cache.size >= maxEntries) {
      cache = new Map();
    }
    cache.set(key, { state, result });
    return result;
  };
}

/**
 * Returns a single-argument selector pre-bound to `memoizeByKey`.
 *
 * ```ts
 * const getBlock = createBlockSelector();
 * const block = useRecordStore((state) => getBlock(state, blockId));   // stable
 * ```
 */
export function createKeyedSelector<A extends unknown[], R>(
  selector: (state: SelectorState, ...args: A) => R,
): (state: SelectorState, ...args: A) => R {
  return memoizeByKey(selector);
}

/** Memoised `selectBlock`. */
export const selectBlockMemo = createKeyedSelector(selectBlock);
/** Memoised `selectChildBlocks`. */
export const selectChildBlocksMemo = createKeyedSelector(selectChildBlocks);
/** Memoised `selectCollection`. */
export const selectCollectionMemo = createKeyedSelector(selectCollection);
/** Memoised `selectCollectionView`. */
export const selectCollectionViewMemo =
  createKeyedSelector(selectCollectionView);
/** Memoised `selectAncestorBlocks`. */
export const selectAncestorBlocksMemo =
  createKeyedSelector(selectAncestorBlocks);
/** Memoised `selectViewsByCollection`. */
export const selectViewsByCollectionMemo = createKeyedSelector(
  selectViewsByCollection,
);

/** Curried convenience wrapper: `selectBlock(id)` returns a state selector. */
export function selectBlockById(
  id: UUID,
): (state: SelectorState) => Block | undefined {
  return (state) => state.blocks[id];
}

/** Curried convenience wrapper for ordered children. */
export function selectChildBlocksById(
  parentId: UUID,
): (state: SelectorState) => Block[] {
  return (state) => selectChildBlocksMemo(state, parentId);
}

/** Curried convenience wrapper for collections. */
export function selectCollectionById(
  id: UUID,
): (state: SelectorState) => Collection | undefined {
  return (state) => state.collections[id];
}
