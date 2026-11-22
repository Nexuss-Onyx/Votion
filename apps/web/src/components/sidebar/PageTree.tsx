'use client';

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useRecordStore } from '@votion/sync-client';
import { ChevronRight, Star } from 'lucide-react';
import type { Block, UUID } from '@votion/types';

import { useWorkspace } from '@/state/WorkspaceProvider';
import { isPageLike, pageTitle } from '@/lib/helpers';
import type { TreeDropZone } from '@/lib/treeMove';
import { pageIcon } from './pageIcon';

interface DropTarget {
  id: UUID;
  zone: TreeDropZone;
}

/**
 * Recursive sidebar page tree.
 *
 * Renders the active workspace's root pages with expandable chevron toggles
 * and breadcrumb-style indentation. Pages can be reordered (or re-nested) by
 * drag & drop: drop on the upper/lower third of a row to insert before/after
 * it, the middle to nest it inside.
 */
export function PageTree() {
  const { rootPages, activePageId, openPage, favorites, toggleFavorite, movePage } = useWorkspace();
  const blocks = useRecordStore((state) => state.blocks);

  const [expanded, setExpanded] = useState<ReadonlySet<UUID>>(
    () => new Set(['p-home', 'p-engineering']),
  );
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const draggedRef = useRef<UUID | null>(null);

  const toggleExpanded = (id: UUID) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const childrenOf = (page: Block): Block[] =>
    page.content
      .map((id) => blocks[id])
      .filter((child): child is Block => child !== undefined && child.alive && isPageLike(child));

  const handleDragStart = (event: DragEvent<HTMLDivElement>, id: UUID) => {
    draggedRef.current = id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, id: UUID) => {
    if (!draggedRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const height = rect.height || 32;
    const ratio = (event.clientY - rect.top) / height;
    const zone: TreeDropZone = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside';
    setDropTarget((current) => (current?.id === id && current.zone === zone ? current : { id, zone }));
  };

  const handleDragLeave = (id: UUID) => {
    setDropTarget((current) => (current?.id === id ? null : current));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, target: Block) => {
    event.preventDefault();
    const draggedId = draggedRef.current;
    if (draggedId && dropTarget && dropTarget.id === target.id) {
      movePage(draggedId, dropTarget.id, dropTarget.zone);
    }
    draggedRef.current = null;
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    draggedRef.current = null;
    setDropTarget(null);
  };

  const renderNode = (page: Block, depth: number): React.ReactNode => {
    const children = childrenOf(page);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(page.id);
    const active = page.id === activePageId;
    const isFavorite = favorites.includes(page.id);
    const targeted = dropTarget?.id === page.id;
    return (
      <div key={page.id}>
        <div
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-current={active ? 'page' : undefined}
          aria-selected={active}
          draggable
          onDragStart={(event) => handleDragStart(event, page.id)}
          onDragOver={(event) => handleDragOver(event, page.id)}
          onDragLeave={() => handleDragLeave(page.id)}
          onDrop={(event) => handleDrop(event, page)}
          onDragEnd={handleDragEnd}
          onClick={() => openPage(page.id)}
          className={[
            'group relative flex w-full cursor-pointer select-none items-center gap-1 rounded-shell py-1 pr-2 text-sm transition-colors',
            active ? 'bg-notion-active font-semibold text-notion-text' : 'text-notion-text hover:bg-notion-hover',
            targeted && dropTarget?.zone === 'before' ? 'ring-2 ring-inset ring-notion-accent' : '',
            targeted && dropTarget?.zone === 'after' ? 'border-b-2 border-notion-accent' : '',
            targeted && dropTarget?.zone === 'inside' ? 'ring-2 ring-inset ring-notion-accent' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? `Collapse ${pageTitle(page)}` : `Expand ${pageTitle(page)}`}
              aria-expanded={isExpanded}
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded(page.id);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-notion-muted transition-transform hover:bg-notion-hover"
              style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
          <span className="shrink-0" aria-hidden>
            {pageIcon(page)}
          </span>
          <span className="min-w-0 flex-1 truncate">{pageTitle(page)}</span>
          <button
            type="button"
            aria-label={isFavorite ? `Unpin ${pageTitle(page)}` : `Pin ${pageTitle(page)}`}
            aria-pressed={isFavorite}
            onClick={(event) => {
              event.stopPropagation();
              toggleFavorite(page.id);
            }}
            className={`shrink-0 rounded p-0.5 transition-opacity ${
              isFavorite
                ? 'text-yellow-500 opacity-100'
                : 'text-notion-muted opacity-0 group-hover:opacity-70 hover:!opacity-100'
            }`}
          >
            <Star className="h-3.5 w-3.5" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden />
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div role="group">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav aria-label="Pages" role="tree" className="flex flex-col gap-px">
      {rootPages.map((page) => renderNode(page, 0))}
    </nav>
  );
}

/** Pure helper exported for tests: top-level pages of a workspace. */
export function rootPagesFromBlocks(
  blocks: Record<UUID, Block>,
  spaceId: UUID,
): Block[] {
  return Object.values(blocks).filter(
    (block) =>
      block.alive &&
      (block.type === 'page' || block.type === 'collection_view') &&
      block.parent_table === 'space' &&
      block.space_id === spaceId,
  );
}
