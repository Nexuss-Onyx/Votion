import { createContext, useContext } from 'react';
import type { Block, UUID } from '@votion/types';
import { useBlock } from '../lib/store.js';
import { BlockCanvas } from '../components/BlockCanvas.js';
import type { BlockEditorActions } from '../lib/editor.js';

/**
 * React context carrying the stack of synced block master ids currently being
 * rendered, so circular references can be detected while descendants render.
 */
const SyncStackContext = createContext<Set<UUID>>(new Set());

export interface SyncedBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Synced block: renders the children of a referenced master block inline.
 * Changes to the master are reflected everywhere the synced block is used.
 * Circular references are detected and rendered as an inline notice.
 */
export function SyncedBlock({
  block,
  spaceId,
  editor,
}: SyncedBlockProps): JSX.Element {
  const masterId = block.properties.synced_from_block_id as UUID | undefined;
  const stack = useContext(SyncStackContext);

  if (!masterId) {
    return (
      <div className="my-2 p-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-500">
        Synced block (no master block set)
      </div>
    );
  }

  if (stack.has(masterId)) {
    return (
      <div className="my-2 p-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-500">
        Synced block (circular reference)
      </div>
    );
  }

  const master = useBlock(masterId);
  const extendedStack = new Set(stack);
  extendedStack.add(masterId);

  if (!master) {
    return (
      <SyncStackContext.Provider value={extendedStack}>
        <div className="my-2 p-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-500">
          Synced block (master block not loaded)
        </div>
      </SyncStackContext.Provider>
    );
  }

  return (
    <SyncStackContext.Provider value={extendedStack}>
      <div className="my-2">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Synced block</span>
          <span className="text-[10px] text-gray-400">→ {master.id.slice(0, 8)}</span>
        </div>
        <BlockCanvas rootBlockId={masterId} spaceId={spaceId} />
      </div>
    </SyncStackContext.Provider>
  );
}
