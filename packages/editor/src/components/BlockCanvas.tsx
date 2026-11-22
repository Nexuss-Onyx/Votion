import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Block, BlockType, UUID } from '@votion/types';
import { getRecordStore } from '@votion/sync-client';
import { useChildBlocks } from '../lib/store.js';
import { createBlockEditor, type BlockEditorActions } from '../lib/editor.js';
import { BlockWrapper } from './BlockWrapper.js';
import { Point, lassoRect } from '../dnd/MultiBlockSelection.js';
import { BlockRenderer } from '../blocks/BlockRenderer.js';
import { SlashMenu } from '../shortcuts/SlashMenu.js';
import { BlockSelectionProvider, useBlockSelection } from './BlockSelection.js';
import { MultiBlockSelection } from '../dnd/MultiBlockSelection.js';
import clsx from 'clsx';

export interface BlockCanvasProps {
  /** Id of the root block whose `content` list is rendered at this level. */
  rootBlockId: UUID;
  /** Workspace id stamped on newly created blocks. */
  spaceId?: UUID;
  /** Optional CSS class name. */
  className?: string;
}

/**
 * Recursive block canvas. Reads `content: UUID[]` from the `@votion/sync-client`
 * store and maps each child id to a `BlockWrapper`. Container blocks (page,
 * toggle, column, column_list) render nested `BlockCanvas` instances through
 * `BlockRenderer`, so the tree renders to arbitrary depth.
 */
export function BlockCanvas({
  rootBlockId,
  spaceId,
  className,
}: BlockCanvasProps) {
  const store = getRecordStore();
  const children = useChildBlocks(rootBlockId);
  const editor = useMemo(() => createBlockEditor(spaceId ?? ''), [spaceId]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [slashMenu, setSlashMenu] = useState<{
    blockId: UUID;
    position: 'after' | 'before';
    mode: 'insert' | 'convert';
    x: number;
    y: number;
  } | null>(null);
  const [dropZone, setDropZone] = useState<{
    blockId: UUID;
    zone: 'above' | 'below' | 'left' | 'right';
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<UUID>>(new Set());
  const lasso = useRef<{ start: Point; current: Point | null } | null>(null);

  const select = useCallback(
    (id: UUID, multi = false) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (multi && next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const toggle = useCallback((id: UUID) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const handleSlashAction = useCallback(
    (type: BlockType) => {
      if (!slashMenu) return;
      const state = store.getState();
      const target = state.blocks[slashMenu.blockId];
      const parentId = target?.parent_id ?? rootBlockId;
      if (slashMenu.mode === 'convert') {
        editor.convertBlock(slashMenu.blockId, type);
        setSlashMenu(null);
        return;
      }
      const parent = state.blocks[parentId];
      const content = parent?.content ?? [];
      const base = content.indexOf(slashMenu.blockId);
      const index =
        base === -1
          ? content.length
          : slashMenu.position === 'after'
            ? base + 1
            : base;
      editor.insertBlock(parentId, type, { index });
      setSlashMenu(null);
    },
    [slashMenu, rootBlockId, editor, store],
  );

  const handleDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const state = store.getState();
    for (const id of [...selectedIds]) {
      if (state.blocks[id]) {
        editor.deleteBlock(id);
      }
    }
    clear();
  }, [selectedIds, editor, store, clear]);

  const handleIndent = useCallback(() => {
    const [first] = [...selectedIds];
    if (!first) return;
    const state = store.getState();
    const block = state.blocks[first];
    const parent = state.blocks[block?.parent_id ?? ''];
    if (!block || !parent) return;
    const siblings = parent.content;
    const index = siblings.indexOf(first);
    if (index <= 0) return;
    const previous = state.blocks[siblings[index - 1] as UUID];
    if (!previous) return;
    editor.reparentBlock(first, previous.id, previous.content.length);
  }, [selectedIds, editor]);

  const handleOutdent = useCallback(() => {
    const [first] = [...selectedIds];
    if (!first) return;
    const state = store.getState();
    const block = state.blocks[first];
    const parent = state.blocks[block?.parent_id ?? ''];
    const grandParent = parent
      ? state.blocks[parent.parent_id]
      : undefined;
    if (!block || !parent || !grandParent) return;
    const gpSiblings = grandParent.content;
    const index = gpSiblings.indexOf(parent.id);
    editor.reparentBlock(first, grandParent.id, (index === -1 ? gpSiblings.length : index + 1));
  }, [selectedIds, editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (
          selectedIds.size === 0 &&
          (document.activeElement as HTMLElement | null)?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        handleDelete();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        // Open slash menu at the first selected block (or root).
        return;
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        handleIndent();
        return;
      }
      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        handleOutdent();
        return;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleDelete, handleIndent, handleOutdent]);

  const handleLassoStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (canvasRef.current && !canvasRef.current.contains(event.target as Node)) return;
      lasso.current = { start: { x: event.clientX, y: event.clientY }, current: null };
    },
    [],
  );

  const handleLassoMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!lasso.current) return;
      lasso.current.current = { x: event.clientX, y: event.clientY };
    },
    [],
  );

  const handleLassoEnd = useCallback(() => {
    if (!lasso.current) return;
    const state = store.getState();
    const selectionRect = lassoRect(
      lasso.current.start,
      lasso.current.current ?? { x: lasso.current.start.x, y: lasso.current.start.y },
    );
    const newlySelected = new Set<UUID>();
    for (const block of Object.values(state.blocks)) {
      const element = document.querySelector(`[data-block-id="${block.id}"]`);
      if (!element) continue;
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      if (
        centerX >= selectionRect.left &&
        centerX <= selectionRect.right &&
        centerY >= selectionRect.top &&
        centerY <= selectionRect.bottom
      ) {
        newlySelected.add(block.id);
      }
    }
    for (const id of newlySelected) select(id, true);
    lasso.current = null;
  }, [select, store]);

  return (
    <BlockSelectionProvider selectedIds={selectedIds} select={select} toggle={toggle} clear={clear}>
      <div
        ref={canvasRef}
        className={clsx('block-canvas', className)}
        onMouseDown={handleLassoStart}
        onMouseMove={handleLassoMove}
        onMouseUp={handleLassoEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const transferredId = event.dataTransfer.getData('votion/block-id');
          if (!transferredId || !dropZone) return;
          const { zone } = dropZone;
          if (zone === 'above' || zone === 'below') {
            editor.moveBlock(transferredId, dropZone.blockId, zone === 'below' ? 'after' : 'before');
          } else {
            editor.wrapInColumns(dropZone.blockId, transferredId, zone);
          }
          setDropZone(null);
        }}
      >
        {children.map((child) => (
          <BlockWrapper
            key={child.id}
            block={child}
            spaceId={spaceId}
            editor={editor}
            onOpenSlashMenu={(options: {
              position: 'after' | 'before';
              mode: 'insert' | 'convert';
              x: number;
              y: number;
            }) => setSlashMenu({ blockId: child.id, ...options })}
            onSetDropZone={setDropZone}
            isSelected={selectedIds.has(child.id)}
            selectBlock={(id: UUID) => select(id, false)}
          />
        ))}
        {slashMenu && (
          <div
            style={{
              position: 'absolute',
              left: slashMenu.x,
              top: slashMenu.y,
              zIndex: 60,
            }}
          >
            <SlashMenu
              x={slashMenu.x}
              y={slashMenu.y}
              mode={slashMenu.mode}
              onInsert={handleSlashAction}
              onClose={() => setSlashMenu(null)}
            />
          </div>
        )}
      </div>
    </BlockSelectionProvider>
  );
}
