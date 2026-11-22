import {
  generateUUID,
  TransactionBuilder,
} from '@votion/sync-client';
import type { Block, BlockType, NewBlock, UUID } from '@votion/types';
import { getRecordStore } from '@votion/sync-client';

/** Now timestamp used for freshly created blocks. */
export function now(): number {
  return Date.now();
}

/** Builds a minimal new block record of the given type. */
export function createBlockRecord(
  params: NewBlock & { id?: UUID; title?: string },
): Block {
  const id = params.id ?? generateUUID();
  const timestamp = now();
  return {
    id,
    space_id: params.space_id,
    type: params.type,
    version: 1,
    properties: {},
    format: {},
    content: [],
    parent_id: params.parent_id,
    parent_table: params.parent_table,
    alive: true,
    created_time: timestamp,
    last_edited_time: timestamp,
    created_by_id: params.created_by_id ?? '',
    last_edited_by_id: params.created_by_id ?? '',
    ...(params.title !== undefined
      ? { properties: { title: [[params.title]] } }
      : {}),
    ...(params.properties ? { properties: { ...params.properties } } : {}),
    ...(params.format ? { format: { ...params.format } } : {}),
    ...(params.content ? { content: [...params.content] } : {}),
  };
}

/** Persists (inserts or replaces) a block record into the default record store. */
export function upsertBlockRecord(record: Block): void {
  const store = getRecordStore();
  store.getState().setRecord('block', record);
}

/** Removes `blockId` and all of its descendants from the store. */
export function removeBlockTree(blockId: UUID): void {
  const store = getRecordStore();
  const state = store.getState();
  const toRemove = new Set<UUID>([blockId]);
  let queue = [blockId];
  while (queue.length > 0) {
    const next: UUID[] = [];
    for (const id of queue) {
      const block = state.blocks[id];
      if (!block) continue;
      for (const childId of block.content) {
        if (!toRemove.has(childId)) {
          toRemove.add(childId);
          next.push(childId);
        }
      }
    }
    queue = next;
  }
  const nextBlocks = { ...state.blocks };
  for (const id of toRemove) {
    delete nextBlocks[id];
  }
  store.setState({ blocks: nextBlocks });
}

export interface BlockEditorActions {
  /** Replaces the title rich text of a text-like block. */
  setBlockTitle(blockId: UUID, title: string): void;
  /** Patches an arbitrary subset of block fields. */
  patchBlock(blockId: UUID, patch: Partial<Block>): void;
  /**
   * Inserts a new block as a child of `parentId` at `index` (appends when
   * omitted) and returns its new id.
   */
  insertBlock(
    parentId: UUID,
    type: BlockType,
    options?: { index?: number; title?: string; spaceId?: UUID },
  ): UUID;
  /** Removes `blockId` and its entire descendant subtree. */
  deleteBlock(blockId: UUID): void;
  /** Moves `blockId` after or before `anchorId` within the same parent. */
  moveBlock(
    blockId: UUID,
    anchorId: UUID,
    position: 'after' | 'before',
  ): void;
  /** Reparents `blockId` under `newParentId` at `index` in its content list. */
  reparentBlock(
    blockId: UUID,
    newParentId: UUID,
    index?: number,
  ): void;
  /** Duplicates `blockId` (same type, properties and format) right after it. */
  duplicateBlock(blockId: UUID): UUID;
  /**
   * Wraps `anchorId` and `draggedId` (siblings under the same parent) into a new
   * `column_list` inserted at the anchor's position, each inside its own
   * `column`. When `zone` is `'left'` the dragged block becomes the first
   * column, otherwise the anchor stays first.
   */
  wrapInColumns(
    anchorId: UUID,
    draggedId: UUID,
    zone: 'left' | 'right',
  ): UUID | undefined;
  /** Converts `blockId` to a different block type, keeping its title text. */
  convertBlock(blockId: UUID, type: BlockType): void;
}

/**
 * Imperative block mutation API bound to the default record store. Used by
 * block components and the slash menu. All writes are local-first optimistic
 * patches to the Zustand store; a server-backed layer can wrap these calls
 * with `TransactionBuilder` + `SyncManager.submit`.
 */
export function createBlockEditor(spaceId: UUID): BlockEditorActions {
  const store = getRecordStore();

  function setBlockTitle(blockId: UUID, title: string): void {
    store.getState().updateRecord('block', blockId, {
      properties: { title: [[title]] },
      last_edited_time: now(),
    });
  }

  function patchBlock(blockId: UUID, patch: Partial<Block>): void {
    const current = store.getState().blocks[blockId];
    const merged: Partial<Block> = { ...patch, last_edited_time: now() };
    if (patch.properties && current?.properties) {
      merged.properties = { ...current.properties, ...patch.properties };
    }
    if (patch.format && current?.format) {
      merged.format = { ...current.format, ...patch.format };
    }
    store.getState().updateRecord('block', blockId, merged);
  }

  function insertBlock(
    parentId: UUID,
    type: BlockType,
    options: { index?: number; title?: string; spaceId?: UUID } = {},
  ): UUID {
    const state = store.getState();
    const content = state.blocks[parentId]?.content?.slice() ?? [];
    const id = generateUUID();
    const record = createBlockRecord({
      id,
      type,
      space_id: options.spaceId ?? spaceId,
      parent_id: parentId,
      parent_table: 'block',
      title: options.title,
    });
    store.getState().setRecord('block', record);
    const index = Math.max(
      0,
      Math.min(options.index === undefined ? content.length : options.index, content.length),
    );
    content.splice(index, 0, id);
    store.getState().updateRecord('block', parentId, {
      content,
      last_edited_time: now(),
    });
    return id;
  }

  function deleteBlock(blockId: UUID): void {
    const state = store.getState();
    const parentId = state.blocks[blockId]?.parent_id;
    removeBlockTree(blockId);
    if (parentId && state.blocks[parentId]) {
      store.getState().updateRecord('block', parentId, {
        content: state.blocks[parentId].content.filter((id) => id !== blockId),
      });
    }
  }

  function moveBlock(
    blockId: UUID,
    anchorId: UUID,
    position: 'after' | 'before',
  ): void {
    const state = store.getState();
    const block = state.blocks[blockId];
    const anchor = state.blocks[anchorId];
    if (!block || !anchor || block.parent_id !== anchor.parent_id) return;
    const parent = state.blocks[block.parent_id];
    if (!parent) return;
    const content = parent.content.filter((id) => id !== blockId);
    const anchorIndex = content.indexOf(anchorId);
    if (anchorIndex === -1) return;
    content.splice(
      position === 'after' ? anchorIndex + 1 : anchorIndex,
      0,
      blockId,
    );
    store.getState().updateRecord('block', parent.id, {
      content,
      last_edited_time: now(),
    });
  }

  function reparentBlock(
    blockId: UUID,
    newParentId: UUID,
    index?: number,
  ): void {
    const state = store.getState();
    const block = state.blocks[blockId];
    const newParent = state.blocks[newParentId];
    const oldParent = block ? state.blocks[block.parent_id] : undefined;
    if (!block || !newParent || block.id === newParentId) return;

    if (oldParent) {
      store.getState().updateRecord('block', oldParent.id, {
        content: oldParent.content.filter((id) => id !== blockId),
      });
    }

    const content = [...(newParent.content ?? [])];
    const insertIndex = index === undefined ? content.length : index;
    content.splice(Math.max(0, Math.min(insertIndex, content.length)), 0, blockId);
    store.getState().updateRecord('block', newParentId, {
      content,
      last_edited_time: now(),
    });

    store.getState().updateRecord('block', blockId, {
      parent_id: newParentId,
      parent_table: 'block',
      last_edited_time: now(),
    });
  }

  function wrapInColumns(
    anchorId: UUID,
    draggedId: UUID,
    zone: 'left' | 'right',
  ): UUID | undefined {
    const state = store.getState();
    const anchor = state.blocks[anchorId];
    const dragged = state.blocks[draggedId];
    if (!anchor || !dragged || anchor.parent_id !== dragged.parent_id) {
      return undefined;
    }
    const parent = state.blocks[anchor.parent_id];
    const grandParent = state.blocks[parent?.parent_id ?? ''];
    if (!parent || !grandParent) return undefined;

    const parentIndex = grandParent.content.indexOf(parent.id);
    if (parentIndex === -1) return undefined;

    // Remove both blocks from the parent list.
    store.getState().updateRecord('block', parent.id, {
      content: parent.content.filter(
        (id) => id !== anchorId && id !== draggedId,
      ),
    });

    const columnListId = generateUUID();
    const first =
      zone === 'left' ? [draggedId, anchorId] : [anchorId, draggedId];

    const columnList = createBlockRecord({
      id: columnListId,
      type: 'column_list',
      space_id: anchor.space_id,
      parent_id: grandParent.id,
      parent_table: grandParent.parent_table,
      content: [],
      format: { column_ratios: [50, 50] },
    });
    store.getState().setRecord('block', columnList);

    const insertIndex =
      parentIndex === -1 ? grandParent.content.length : parentIndex;
    const grandContent = [...grandParent.content];
    grandContent.splice(insertIndex, 0, columnListId);
    store.getState().updateRecord('block', grandParent.id, {
      content: grandContent,
      last_edited_time: now(),
    });

    const columnContent: UUID[] = [];
    for (const blockId of first) {
      const columnId = generateUUID();
      const column = createBlockRecord({
        id: columnId,
        type: 'column',
        space_id: anchor.space_id,
        parent_id: columnListId,
        parent_table: 'block',
        format: { column_ratio: 50 },
      });
      store.getState().setRecord('block', column);
      store.getState().updateRecord('block', blockId, {
        parent_id: columnId,
        parent_table: 'block',
        last_edited_time: now(),
      });
      store.getState().updateRecord('block', columnId, {
        content: [blockId],
        last_edited_time: now(),
      });
      columnContent.push(columnId);
    }
    store.getState().updateRecord('block', columnListId, {
      content: columnContent,
    });

    return columnListId;
  }

  function convertBlock(blockId: UUID, type: BlockType): void {
    const state = store.getState();
    const block = state.blocks[blockId];
    if (!block) return;
    const patch: Partial<Block> = { type, last_edited_time: now() };
    if (type === 'to_do' && block.type !== 'to_do') {
      patch.properties = { ...block.properties, checked: [['no']] };
    }
    store.getState().updateRecord('block', blockId, patch);
  }

  function duplicateBlock(blockId: UUID): UUID {
    const state = store.getState();
    const block = state.blocks[blockId];
    if (!block) throw new Error(`Block ${blockId} is not cached`);
    const parentId = block.parent_id;
    const parent = state.blocks[parentId];
    if (!parent) throw new Error(`Parent ${parentId} is not cached`);
    const id = generateUUID();
    const duplicate = createBlockRecord({
      id,
      type: block.type,
      space_id: block.space_id,
      parent_id: parentId,
      parent_table: block.parent_table,
      properties: block.properties,
      format: block.format,
      content: [],
    });
    store.getState().setRecord('block', duplicate);
    const index = parent.content.indexOf(blockId) + 1;
    const content = [...parent.content];
    content.splice(Math.max(0, Math.min(index, content.length)), 0, id);
    store.getState().updateRecord('block', parentId, {
      content,
      last_edited_time: now(),
    });
    return id;
  }

    return {
    setBlockTitle,
    patchBlock,
    insertBlock,
    deleteBlock,
    moveBlock,
    reparentBlock,
    wrapInColumns,
    convertBlock,
    duplicateBlock,
  };
}

/** Builds a server-ready transaction that inserts a new child block record. */
export function buildInsertBlockTransaction({
  spaceId,
  parentId,
  type,
  title,
}: {
  spaceId: UUID;
  parentId: UUID;
  type: BlockType;
  title?: string;
}): ReturnType<typeof TransactionBuilder.prototype.build> {
  const id = generateUUID();
  const record = createBlockRecord({
    id,
    type,
    space_id: spaceId,
    parent_id: parentId,
    parent_table: 'block',
    title,
  });
  return new TransactionBuilder({ spaceId, table: 'block', id })
    .set(['type'], type)
    .set(['properties', 'title'], record.properties.title ?? [])
    .set(['content'], [])
    .set(['parent_id'], parentId)
    .set(['parent_table'], 'block')
    .set(['space_id'], spaceId)
    .set(['alive'], true)
    .set(['version'], 1)
    .listAfter(['content'], null, id, { table: 'block', id: parentId })
    .build();
}
