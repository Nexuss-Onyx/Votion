import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { GripVertical, Plus } from 'lucide-react';
import type { Block, BlockType, UUID } from '@votion/types';
import { clsx } from 'clsx';
import { BlockRenderer } from '../blocks/BlockRenderer.js';
import { useIsBlockSelected } from './BlockSelection.js';
import type { BlockEditorActions } from '../lib/editor.js';

export interface BlockWrapperProps {
  block: Block;
  /** Display index within the parent list (used for numbered lists). */
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
  /** Asks the owning canvas to open the slash menu next to this block. */
  onOpenSlashMenu: (options: {
    position: 'after' | 'before';
    mode: 'insert' | 'convert';
    x: number;
    y: number;
  }) => void;
  /** Reports a drag-over drop zone for this block. */
  onSetDropZone: (zone: {
    blockId: UUID;
    zone: 'above' | 'below' | 'left' | 'right';
  } | null) => void;
  isSelected?: boolean;
  selectBlock: (id: UUID, multi?: boolean) => void;
}

const TURN_INTO_TYPES: BlockType[] = [
  'text',
  'heading_1',
  'heading_2',
  'heading_3',
  'to_do',
  'bulleted_list_item',
  'numbered_list_item',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'math',
];

export function BlockWrapper({
  block,
  index,
  spaceId,
  editor,
  onOpenSlashMenu,
  onSetDropZone,
  isSelected = false,
  selectBlock,
}: BlockWrapperProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = useIsBlockSelected(block.id);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      selectBlock(block.id, event.shiftKey || event.metaKey);
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [block.id, selectBlock],
  );

  const handleInsertClick = useCallback(
    (event: ReactMouseEvent, position: 'after' | 'before') => {
      event.stopPropagation();
      const rect = wrapperRef.current?.getBoundingClientRect();
      onOpenSlashMenu({
        position,
        mode: 'insert',
        x: (rect?.left ?? 0) + 10,
        y: (rect?.top ?? 0) + 8,
      });
      setContextMenu(null);
    },
    [],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      event.dataTransfer.setData('votion/block-id', block.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    [block.id],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { clientX, clientY } = event.nativeEvent;
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      let zone: 'above' | 'below' | 'left' | 'right' = 'below';
      if (relativeY < rect.height * 0.25) zone = 'above';
      else if (relativeY > rect.height * 0.75) zone = 'below';
      else if (relativeX < rect.width * 0.4) zone = 'left';
      else zone = 'right';
      onSetDropZone({ blockId: block.id, zone });
    },
    [block.id, onSetDropZone],
  );

  const handleDragLeave = useCallback(() => {
    onSetDropZone(null);
  }, [onSetDropZone]);

  const handleDelete = useCallback(() => {
    editor.deleteBlock(block.id);
    setContextMenu(null);
  }, [block.id, editor]);

  const handleDuplicate = useCallback(() => {
    editor.duplicateBlock(block.id);
    setContextMenu(null);
  }, [block.id, editor]);

  const handleConvert = useCallback(
    (type: BlockType) => {
      editor.convertBlock(block.id, type);
      setContextMenu(null);
    },
    [block.id, editor],
  );

  return (
    <div
      ref={wrapperRef}
      data-block-id={block.id}
      className={clsx(
        'block-wrapper',
        'border border-transparent rounded-md p-1',
        isSelected && 'bg-notion-selected border-blue-400/50',
      )}
      onContextMenu={handleContextMenu}
      onDrop={(event) => {
        event.preventDefault();
        onSetDropZone(null);
      }}
    >
        <div
          className={clsx(
            'block-content group relative min-h-[20px] outline-none',
            isSelected ? 'ring-1 ring-blue-400' : '',
          )}
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={(event) => {
            if (!wrapperRef.current?.contains(event.target as Node)) return;
            selectBlock(block.id, event.shiftKey || event.metaKey);
          }}
        >
        {/* 6-dot drag handle (visible on hover) */}
        <div className="drag-handle" aria-label="Drag handle">
          {[0, 1, 2].map((row) => (
            <div key={row} className="drag-dot" />
          ))}
          {[0, 1, 2].map((row) => (
            <div key={row + 3} className="drag-dot" />
          ))}
        </div>

        {/* Quick insert button */}
        <button
          type="button"
          className="insert-button"
          aria-label="Insert block"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => handleInsertClick(event, 'after')}
        >
          <Plus className="w-3 h-3" />
        </button>



        {/* Block renderer */}
        <BlockRenderer
          block={block}
          index={index}
          spaceId={spaceId}
          editor={editor}
        />

        {/* Right-click context menu */}
        {contextMenu && (
          <div
            className={clsx(
              'fixed z-[70] rounded border border-gray-200 bg-white shadow-lg py-1 min-w-[160px]',
            )}
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div
              className="slash-menu-item text-sm text-gray-600"
              onClick={handleDuplicate}
              role="menuitem"
            >
              Duplicate
            </div>
            <div
              className="slash-menu-item text-sm text-gray-600"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(location.origin + '/blocks/' + block.id)
                  .catch(() => undefined);
                setContextMenu(null);
              }}
              role="menuitem"
            >
              Copy Link
            </div>
            <div
              className="slash-menu-item text-sm text-gray-600"
              onClick={() => {
                const rect = wrapperRef.current?.getBoundingClientRect();
                setContextMenu(null);
                onOpenSlashMenu({
                  position: 'after',
                  mode: 'convert',
                  x: contextMenu.x,
                  y: (rect?.top ?? contextMenu.y) + 26,
                });
              }}
              role="menuitem"
            >
              Turn Into
            </div>
            <div
              className="slash-menu-item text-sm text-gray-600"
              onClick={handleDelete}
              role="menuitem"
            >
              Delete
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
