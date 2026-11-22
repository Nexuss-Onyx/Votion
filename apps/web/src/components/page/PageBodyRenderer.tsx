'use client';

import type { MouseEvent, ReactNode } from 'react';
import { getRecordStore, useRecordStore } from '@votion/sync-client';
import type { Block, RichText, RichTextSegment, TextModifier, UUID } from '@votion/types';
import { ChevronRight } from 'lucide-react';

import { useWorkspace } from '@/state/WorkspaceProvider';
import type { InlineComment } from '@/lib/types';
import { isPageLike, pageTitle } from '@/lib/helpers';
import { pageIcon } from '../sidebar/pageIcon';
import type { AnchorRect } from '../comments/InlineCommentOverlay';

interface PageBodyRendererProps {
  page: Block;
  comments: InlineComment[];
  isSmallText: boolean;
  onHighlightClick: (blockId: string, anchor: string, rect: AnchorRect) => void;
}

function getRect(element: Element): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width };
}

/** Pure modifier → <span> render (mirrors @votion/editor's renderer semantics). */
function renderModifierText(text: string, modifiers: TextModifier[] = []): ReactNode {
  let node: ReactNode = text;
  let link: string | undefined;
  let code = false;
  let bold = false;
  let italic = false;
  let strike = false;
  let underline = false;

  for (const modifier of modifiers) {
    const [tag, argument] = modifier;
    switch (tag) {
      case 'b':
        bold = true;
        break;
      case 'i':
        italic = true;
        break;
      case 's':
        strike = true;
        break;
      case '_':
        underline = true;
        break;
      case 'c':
        code = true;
        break;
      case 'a':
        link = typeof argument === 'string' ? argument : undefined;
        break;
      default:
        break;
    }
  }

  if (code) {
    node = <code className="rounded bg-notion-hover px-1 py-0.5 font-mono text-[0.85em]">{node}</code>;
  }
  if (bold) node = <strong className="font-semibold">{node}</strong>;
  if (italic) node = <em>{node}</em>;
  if (strike) node = <s>{node}</s>;
  if (underline) node = <u>{node}</u>;
  if (link) node = <a href={link} className="text-notion-accent underline">{node}</a>;

  return node;
}

/** Renders one rich text segment, wrapping comment anchors in <mark>. */
function renderSegment(
  segment: RichTextSegment,
  index: number,
  opts: {
    blockId: string;
    comments: InlineComment[];
    onHighlightClick: PageBodyRendererProps['onHighlightClick'];
  },
): ReactNode {
  const [text, modifiers = []] = segment;
  const highlighted = modifiers.some(([tag]) => tag === 'h');

  if (!highlighted || text.trim().length === 0) {
    return <span key={index}>{renderModifierText(text, modifiers)}</span>;
  }

  // Anchor identity: any highlighted segment is clickable. Existing comments
  // are matched by substring (anchor ⊂ segment text).
  const existing = opts.comments.find(
    (comment) => comment.blockId === opts.blockId && text.includes(comment.anchor),
  );
  const anchor = existing?.anchor ?? text;

  return (
    <mark
      key={index}
      data-comment-anchor={existing ? existing.id : undefined}
      data-comment-resolved={existing?.resolved ? 'true' : undefined}
      className="comment-anchor"
      title={existing ? `Comment by ${existing.author.name}` : 'Add a comment'}
      onClick={(event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        opts.onHighlightClick(opts.blockId, anchor, getRect(event.currentTarget));
      }}
    >
      {renderModifierText(text, modifiers.filter(([tag]) => tag !== 'h'))}
    </mark>
  );
}

function renderRichText(
  richText: RichText | undefined,
  opts: {
    blockId: string;
    comments: InlineComment[];
    onHighlightClick: PageBodyRendererProps['onHighlightClick'];
  },
): ReactNode {
  if (!richText || richText.length === 0) return ' ';
  return richText.map((segment, index) => renderSegment(segment, index, opts));
}

function SubpageRow({ page }: { page: Block }) {
  const { openPage } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => openPage(page.id)}
      className="group/subpage flex w-full items-center gap-2.5 rounded-shell px-2 py-2 text-left transition-colors hover:bg-notion-hover"
      aria-label={`Open ${pageTitle(page)}`}
    >
      <span className="text-lg" aria-hidden>{pageIcon(page)}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-notion-text">
        {pageTitle(page)}
      </span>
      <ChevronRight
        className="h-4 w-4 text-notion-muted transition-transform group-hover/subpage:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

function BodyBlock({
  block,
  comments,
  isSmallText,
  onHighlightClick,
}: {
  block: Block;
  comments: InlineComment[];
  isSmallText: boolean;
  onHighlightClick: PageBodyRendererProps['onHighlightClick'];
}) {
  const opts = { blockId: block.id, comments, onHighlightClick };
  const content = renderRichText(block.properties.title, opts);

  switch (block.type) {
    case 'heading_1':
      return <h1 className="mt-4 text-2xl font-bold leading-tight text-notion-text">{content}</h1>;
    case 'heading_2':
      return <h2 className="mt-4 text-xl font-semibold leading-snug text-notion-text">{content}</h2>;
    case 'heading_3':
      return <h3 className="mt-3 text-lg font-semibold leading-snug text-notion-text">{content}</h3>;
    case 'quote':
      return (
        <blockquote className="border-l-4 border-notion-border pl-4 text-lg italic leading-7 text-notion-text">
          {content}
        </blockquote>
      );
    case 'callout':
      return (
        <div className="flex items-start gap-2.5 rounded-shell border border-notion-border bg-amber-50 px-4 py-3">
          <span aria-hidden>💡</span>
          <div className="min-w-0 flex-1">{content}</div>
        </div>
      );
    case 'divider':
      return <hr className="my-2 border-notion-border" />;
    case 'to_do':
      return <ToDoLine block={block} content={content} />;
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-shell border border-notion-border bg-notion-hover/60 p-3 font-mono text-[13px] leading-6 text-notion-text">
          {pageTitle(block)}
        </pre>
      );
    default:
      return (
        <p className={`${isSmallText ? 'text-sm' : 'text-[15px]'} leading-7 text-notion-text`}>{content}</p>
      );
  }
}

function ToDoLine({ block, content }: { block: Block; content: ReactNode }) {
  const checked = block.properties.checked?.[0]?.[0] === 'yes';

  const toggle = () => {
    const store = getRecordStore();
    const current = store.getState().blocks[block.id];
    if (!current) return;
    store.getState().updateRecord('block', block.id, {
      properties: {
        ...current.properties,
        checked: [[checked ? 'no' : 'yes']],
      },
    });
  };

  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-shell px-2 py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={toggle}
        aria-label={`Toggle ${pageTitle(block)}`}
        className="mt-1 h-4 w-4 shrink-0 accent-notion-accent"
      />
      <span className={checked ? 'text-notion-muted line-through' : 'text-notion-text'}>{content}</span>
    </label>
  );
}

/**
 * Renders the page body from the normalized record store. Subpages render as
 * clickable rows; rich text renders inline-comment anchors (<mark>).
 */
export function PageBodyRenderer({ page, comments, isSmallText, onHighlightClick }: PageBodyRendererProps) {
  const blocks = useRecordStore((state) => state.blocks) as Record<UUID, Block>;

  const children = page.content
    .map((id) => blocks[id])
    .filter((child): child is Block => child !== undefined && child.alive);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {children.map((child) => {
        if (isPageLike(child)) {
          return <SubpageRow key={child.id} page={child} />;
        }
        return (
          <BodyBlock
            key={child.id}
            block={child}
            comments={comments}
            isSmallText={isSmallText}
            onHighlightClick={onHighlightClick}
          />
        );
      })}
    </div>
  );
}
