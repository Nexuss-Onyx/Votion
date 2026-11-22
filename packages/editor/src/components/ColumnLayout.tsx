import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Block, UUID } from '@votion/types';
import { useChildBlocks } from '../lib/store.js';
import { BlockCanvas } from './BlockCanvas.js';
import type { BlockEditorActions } from '../lib/editor.js';

export interface ColumnLayoutProps {
  block: Block;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Multi-column layout engine. Renders a `column_list` as a flex row of
 * `column`s, each owning a nested `BlockCanvas`. Percentage dividers between
 * columns are draggable; dragging updates `format.column_ratios` on the
 * `column_list` and `format.column_ratio` on each `column` block.
 */
export function ColumnLayout({
  block,
  spaceId,
  editor,
}: ColumnLayoutProps) {
  const columns = useChildBlocks(block.id).filter(
    (child) => child.type === 'column',
  );
  const storedRatios: number[] | undefined =
    block.format.column_ratios ??
    (block.format.column_ratio ? [block.format.column_ratio] : undefined);

  const [ratios, setRatios] = useState<number[]>(() =>
    storedRatios?.length === columns.length && columns.length > 0
      ? [...storedRatios]
      : Array(columns.length).fill(100 / Math.max(columns.length, 1)),
  );

  const isResizing = useRef<number | null>(null);
  const startRatio = useRef<number[]>([]);
  const startX = useRef(0);

  const commitRatios = useCallback(
    (next: number[]) => {
      setRatios(next);
      editor.patchBlock(block.id, {
        format: { ...block.format, column_ratios: next },
      });
      columns.forEach((column, i) => {
        editor.patchBlock(column.id, {
          format: { ...column.format, column_ratio: next[i] },
        });
      });
    },
    [block, columns, editor],
  );

  const handleResizeStart = useCallback(
    (index: number) => (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      isResizing.current = index;
      startRatio.current = [...ratios];
      startX.current = event.clientX;
    },
    [ratios],
  );

      const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const resizeIndex = isResizing.current;
      if (resizeIndex === null) return;
      const index = resizeIndex;
      const dx = event.clientX - startX.current;
      const delta = (dx / 400) * 100;
      const next = [...startRatio.current];
      next[index] = Math.max(10, (next[index] ?? 0) - delta);
      next[index + 1] = Math.max(10, (next[index + 1] ?? 0) + delta);
      const total = next.reduce((a, b) => a + b, 0);
      commitRatios(next.map((r) => (r / total) * 100));
    },
    [commitRatios],
  );

  const handleMouseUp = useCallback(() => {
    isResizing.current = null;
  }, []);

  useEffect(() => {
    if (isResizing.current === null) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing.current, handleMouseMove, handleMouseUp]);

  const equalWidth = 100 / Math.max(columns.length, 1);

  return (
    <div className="column-list relative" style={{ display: 'flex', gap: '8px', width: '100%' }}>
      {columns.map((column, i) => (
        <div
          key={column.id}
          className="column relative flex flex-col min-w-[120px]"
          style={{
            flex: `0 0 ${ratios[i] ?? equalWidth}%`,
            minWidth: '120px',
          }}
        >
          <BlockCanvas rootBlockId={column.id} spaceId={spaceId} className="pt-1" />
          {i < columns.length - 1 && (
            <div
              className="column-resize-handle"
              onMouseDown={(event) =>
                handleResizeStart(i)(event as unknown as MouseEvent)
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}
