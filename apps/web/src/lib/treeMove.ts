/**
 * Pure page-tree move logic for the sidebar.
 *
 * The sidebar tree is a recursive view over the record store's `content`
 * link-lists. Moving a page reorders (or reparents) the entry in the
 * enclosing parent's `content` array. This module computes the exact updates
 * needed; the caller applies them to the store.
 *
 * Pure and deterministic: no React, no DOM, no side effects — trivially
 * unit-testable.
 */

import type { Block, UUID } from '@votion/types';

/** Drop zone relative to a target tree row. */
export type TreeDropZone = 'before' | 'after' | 'inside';

/** A single block-level update to apply afterwards. */
export interface TreeMoveUpdate {
  blockId: UUID;
  /** New ordered `content` list for this block (when the block is a parent). */
  content?: UUID[];
  /** New parent page id for the dragged block (when it is reparented). */
  parentId?: UUID;
  parentTable?: 'block' | 'space' | 'collection';
}

function isDescendant(
  blocks: Record<UUID, Block>,
  ancestorId: UUID,
  candidateId: UUID,
): boolean {
  // BFS through the content arrays to see whether `candidateId` is a descendant
  // of `ancestorId` (i.e. whether dropping `ancestorId` into `candidateId` would
  // create a cycle).
  const seen = new Set<UUID>();
  const stack: UUID[] = [ancestorId];
  while (stack.length > 0) {
    const id = stack.pop() as UUID;
    if (id === candidateId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const block = blocks[id];
    if (!block) continue;
    for (const childId of block.content) stack.push(childId);
  }
  return false;
}

/** Computes the minimal set of updates needed to move one page.
 *
 * Returns `[]` when the move is impossible (self, duplicate, cycle, illegal
 * drop target). Pure: the input map is never mutated.
 */
export function computeTreeMove(
  blocks: Record<UUID, Block>,
  draggedId: UUID,
  targetId: UUID,
  zone: TreeDropZone,
): TreeMoveUpdate[] {
  if (draggedId === targetId) return [];

  const dragged = blocks[draggedId];
  const target = blocks[targetId];
  if (!dragged || !target) return [];
  if (dragged.parent_table !== 'block' && dragged.parent_table !== 'space') return [];
  if (target.parent_table !== 'block' && target.parent_table !== 'space') return [];

  // Cannot drop a page into its own descendant (would create a cycle).
  if (isDescendant(blocks, draggedId, targetId)) return [];

  const updates: TreeMoveUpdate[] = [];

  if (zone === 'inside') {
    // The dragged page becomes the last child of the target page.
    // (Dropping an empty page into itself is a no-op above; dropping a page
    // into a draft of itself is guarded by isDescendant.)
    const oldParentId = dragged.parent_id;
    const targetBlock = target;
    if (targetBlock.type !== 'page') return [];

    const oldParent = blocks[oldParentId];
    if (oldParent) {
      updates.push({
        blockId: oldParentId,
        content: oldParent.content.filter((id) => id !== draggedId),
      });
    }

    const newContent = [...targetBlock.content];
    if (!newContent.includes(draggedId)) newContent.push(draggedId);
    updates.push({ blockId: targetId, content: newContent });

    updates.push({
      blockId: draggedId,
      parentId: targetId,
      parentTable: 'block',
    });
    return updates;
  }

  // before/after: reorder within the target's parent.
  const parentId = target.parent_id;
  const parent = blocks[parentId];
  if (!parent) return [];

  const oldParentId = dragged.parent_id;
  const newContent = parent.content.filter((id) => id !== draggedId);
  const targetIndex = newContent.indexOf(targetId);
  const insertAt = zone === 'before' ? targetIndex : targetIndex + 1;
  newContent.splice(insertAt < 0 ? newContent.length : insertAt, 0, draggedId);

  updates.push({ blockId: parentId, content: newContent });

  if (oldParentId !== parentId) {
    // Cross-parent reorder: remove from the old parent's list too.
    const oldParent = blocks[oldParentId];
    if (oldParent) {
      updates.push({
        blockId: oldParentId,
        content: oldParent.content.filter((id) => id !== draggedId),
      });
    }
    updates.push({
      blockId: draggedId,
      parentId,
      parentTable: 'block',
    });
  }

  return updates;
}
