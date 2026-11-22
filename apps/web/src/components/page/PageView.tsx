'use client';

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { getRecordStore, useRecordStore } from '@votion/sync-client';
import type { Block } from '@votion/types';
import { RichTextRenderer } from '@votion/editor';
import { CollectionViewRenderer } from '@votion/database-engine';

import { useWorkspace } from '@/state/WorkspaceProvider';
import { formatRelativeTime, pageTitle } from '@/lib/helpers';
import { PageCover, PageIconPicker } from './PageCoverAndIcon';
import { PageDiscussion } from '@/components/comments/PageDiscussion';
import { PageBodyRenderer } from './PageBodyRenderer';
import {
  InlineCommentOverlay,
  type AnchorRect,
  type AnchorRequest,
} from '@/components/comments/InlineCommentOverlay';

export function PageView({ page }: { page: Block }) {
  const {
    getCommentsForPage,
    addInlineComment,
    toggleCommentResolved,
    reactToComment,
    addCommentReply,
    updateCommentBody,
    activeWorkspace,
  } = useWorkspace();

  const [openAnchor, setOpenAnchor] = useState<AnchorRequest | null>(null);
  const [openRect, setOpenRect] = useState<AnchorRect | null>(null);

  const comments = getCommentsForPage(page.id);
  const isSmallText = Boolean(page.format?.page_small_text);
  const isFullWidth = Boolean(page.format?.page_full_width);

  const handleHighlightClick = useCallback(
    (blockId: string, anchor: string, rect: AnchorRect) => {
      setOpenAnchor((current) =>
        current?.anchor === anchor && current.blockId === blockId ? null : { blockId, anchor },
      );
      setOpenRect(rect);
    },
    [],
  );

  const handleAddInlineComment = useCallback(
    (blockId: string, anchor: string, body: string) => {
      addInlineComment(page.id, blockId, anchor, body);
    },
    [addInlineComment, page.id],
  );

  return (
    <div className="pb-16">
      {/* Bleed cover across the page surface */}
      <div className="px-4 pt-6 sm:px-8">
        <PageCover pageId={page.id} />
      </div>

      <div className={clsx('mx-auto px-4 sm:px-8', isFullWidth ? 'max-w-[1080px]' : 'max-w-3xl')}>
        <div className="flex items-start gap-3">
          <PageIconPicker pageId={page.id} />
          <div className="min-w-0 flex-1">
            <h1
              className={clsx(
                'font-bold leading-tight text-notion-text',
                isSmallText ? 'text-2xl' : 'text-[32px]',
              )}
              aria-label={`Page title: ${pageTitle(page)}`}
            >
              <RichTextRenderer richText={page.properties.title ?? []} />
            </h1>
            <p className="mt-1.5 text-xs text-notion-muted">
              {page.space_id === activeWorkspace.id ? activeWorkspace.name : ''} · Edited{' '}
              {formatRelativeTime(page.last_edited_time)}
            </p>
          </div>
        </div>

        {page.type === 'collection_view' ? (
          <CollectionViewSurface page={page} />
        ) : (
          <>
            <PageDiscussion pageId={page.id} />
            <PageBodyRenderer
              page={page}
              comments={comments}
              isSmallText={isSmallText}
              onHighlightClick={handleHighlightClick}
            />
          </>
        )}
      </div>

      <InlineCommentOverlay
        request={openAnchor}
        rect={openRect}
        comments={comments}
        onClose={() => setOpenAnchor(null)}
        onAdd={handleAddInlineComment}
        onToggleResolve={toggleCommentResolved}
        onReact={reactToComment}
        onReply={addCommentReply}
        onUpdateBody={updateCommentBody}
      />
    </div>
  );
}

function CollectionViewSurface({ page }: { page: Block }) {
  const blocks = useRecordStore((state) => state.collectionViews);
  const collections = useRecordStore((state) => state.collections);
  const store = getRecordStore();
  const collectionId = page.properties.collection_id;

  if (!collectionId) {
    return (
      <p className="mt-4 text-sm text-notion-muted">This page has no collection linked.</p>
    );
  }

  const collection = collections[collectionId];
  const view = Object.values(blocks).find(
    (entry) => entry.collection_id === collectionId && entry.alive,
  );

  if (!collection || !view) {
    return (
      <p className="mt-4 text-sm text-notion-muted">Collection view not found.</p>
    );
  }

  return (
    <div className="mt-6">
      <CollectionViewRenderer
        collectionId={collectionId}
        viewId={view.id}
        store={store}
      />
    </div>
  );
}
