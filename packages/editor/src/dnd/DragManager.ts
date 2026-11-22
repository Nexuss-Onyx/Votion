/**
 * Drag-and-drop helpers for the block canvas.
 *
 * Computes relative drop zones from a pointer position against a block's
 * bounding box and maps them to sync-client list operations:
 *  - `above` / `below` → `listBefore` / `listAfter` (reordering)
 *  - `left` / `right`  → column conversion via `wrapInColumns`
 */

export type DropZone = 'above' | 'below' | 'left' | 'right';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

import type { UUID } from '@votion/types';

export interface DropResult {
  zone: DropZone;
  index: number;
  operation: 'listAfter' | 'listBefore' | 'set';
  anchorId: UUID | null;
}

/**
 * Classifies a pointer position into a drop zone relative to a block rect:
 * the top/bottom 30% are vertical zones, the left/right halves are column
 * zones, with the nearer axis winning.
 */
export function getDropZone(
  rect: RectLike,
  clientX: number,
  clientY: number,
): DropZone {
  const relativeX = clientX - rect.left;
  const relativeY = clientY - rect.top;

  const verticalDistance = Math.min(relativeY, rect.height - relativeY);
  const horizontalDistance = Math.min(relativeX, rect.width - relativeX);

  const isVertical = verticalDistance < horizontalDistance;
  if (isVertical) {
    return relativeY < rect.height * 0.3 ? 'above' : 'below';
  }
  return relativeX < rect.width * 0.5 ? 'left' : 'right';
}

/**
 * Computes the insertion index of `targetId` within `content` for a given
 * zone. Column zones return the target's own index so the caller can perform
 * column conversion (wrap both blocks into a `column_list`).
 */
export function computeDropIndex(
  content: UUID[],
  targetId: UUID,
  zone: DropZone,
): number {
  const index = content.indexOf(targetId);
  if (index === -1) return content.length;
  switch (zone) {
    case 'above':
      return index;
    case 'below':
      return index + 1;
    case 'left':
    case 'right':
      return index;
  }
}

/**
 * Maps a drop zone to the sync-client operation that should be emitted.
 */
export function dropZoneToOperation(
  content: UUID[],
  targetId: UUID,
  zone: DropZone,
  movedId: UUID,
): DropResult {
  const index = computeDropIndex(content, targetId, zone);
  const anchorId = content[index] ?? null;
  const operation =
    zone === 'above'
      ? 'listBefore'
      : zone === 'below'
        ? 'listAfter'
        : 'set';
  return { zone, index, operation, anchorId };
}
