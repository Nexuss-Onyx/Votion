import { useStore } from 'zustand';
import type { Block, UUID } from '@votion/types';
import {
  createRecordStore,
  getRecordStore,
  resetRecordStore,
  setRecordStore,
  type RecordStore,
  type RecordStoreApi,
} from '@votion/sync-client';
import {
  selectChildBlocksMemo,
  selectBlockMemo,
  type SelectorState,
} from '@votion/sync-client';

/**
 * Hooks and helpers for reading the normalized record store from editor
 * components. The default store singleton is shared with the sync client, so
 * optimistic patches committed by the editor are immediately visible to the
 * canvas and vice versa.
 */

/** Returns the current record store state (for reads). */
export function useBlockStore(): RecordStore {
  return useStore(getRecordStore());
}

/** Returns the block with `blockId`, or `undefined` when it is not cached. */
export function useBlock(blockId: UUID): Block | undefined {
  return useStore(getRecordStore(), (state) => state.blocks[blockId]);
}

/** Returns the ordered child blocks of `parentId`, memoised per store state. */
export function useChildBlocks(parentId: UUID): Block[] {
  return useStore(getRecordStore(), (state) =>
    selectChildBlocksMemo(state as SelectorState, parentId),
  );
}

/** Test-only: replace the default store with an isolated instance. */
export function installTestStore(): RecordStoreApi {
  const store = createRecordStore();
  setRecordStore(store);
  return store;
}

/** Test-only: restore the default store singleton. */
export function uninstallTestStore(): void {
  resetRecordStore();
}
