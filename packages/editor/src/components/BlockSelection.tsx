import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
  useMemo,
} from 'react';
import type { UUID } from '@votion/types';

interface BlockSelectionContextValue {
  selectedIds: Set<UUID>;
  /** Select a block, optionally adding to the current selection. */
  select: (id: UUID, multi?: boolean) => void;
  /** Toggle a block in the selection. */
  toggle: (id: UUID) => void;
  /** Clear the selection. */
  clear: () => void;
  /** Number of selected blocks. */
  count: number;
}

const defaultContext: BlockSelectionContextValue = {
  selectedIds: new Set(),
  select: () => {},
  toggle: () => {},
  clear: () => {},
  count: 0,
};

export const BlockSelectionContext =
  createContext<BlockSelectionContextValue>(defaultContext);

/** Provides multi-block selection state to the canvas. */
export function BlockSelectionProvider({
  children,
  selectedIds: initial,
  select,
  toggle,
  clear,
}: {
  children: ReactNode;
  selectedIds: Set<UUID>;
  select: (id: UUID, multi?: boolean) => void;
  toggle: (id: UUID) => void;
  clear: () => void;
}) {
  const context = useMemo<BlockSelectionContextValue>(
    () => ({ selectedIds: initial, select, toggle, clear, count: initial.size }),
    [initial, select, toggle, clear],
  );
  return (
    <BlockSelectionContext.Provider value={context}>{children}</BlockSelectionContext.Provider>
  );
}

/** Hook to consume the current block selection. */
export function useBlockSelection(): BlockSelectionContextValue {
  return useContext(BlockSelectionContext);
}

/** Hook that reports whether a single block is selected. */
export function useIsBlockSelected(blockId: UUID): boolean {
  const { selectedIds } = useBlockSelection();
  return selectedIds.has(blockId);
}
